import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';

export type Message = components['schemas']['MessageDto'];
export type MessageSnapshot = components['schemas']['MessageSnapshot'] & { deletedVersions?: Record<string, string> };
export type CatchUpPage = components['schemas']['CatchUpPage'];
const root = (community: string, channel: string) => `/api/v1/communities/${community}/channels/${channel}`;
export const history = (community: string, channel: string, signal: AbortSignal, before?: string) =>
  callApi(`${root(community, channel)}/messages${before === undefined ? '' : `?before=${encodeURIComponent(before)}`}`, { signal }).then(readJson<MessageSnapshot>);
export const catchUp = (community: string, channel: string, after: string, signal: AbortSignal) =>
  callApi(`${root(community, channel)}/events?after=${encodeURIComponent(after)}`, { signal }).then(readJson<CatchUpPage>);
export const sendMessage = (community: string, channel: string, clientMessageId: string, content: string) =>
  mutateApi<Message>(`${root(community, channel)}/messages`, 'POST', { clientMessageId, content });
export const editMessage = (community: string, channel: string, id: string, clientRequestId: string, expectedVersion: string, content: string) =>
  mutateApi<components['schemas']['MessageCommandResult']>(`${root(community, channel)}/messages/${id}`, 'PUT', { clientRequestId, expectedVersion, content });
export const deleteMessage = (community: string, channel: string, id: string, clientRequestId: string, expectedVersion: string) =>
  mutateApi<components['schemas']['MessageCommandResult']>(`${root(community, channel)}/messages/${id}/delete`, 'POST', { clientRequestId, expectedVersion });

export function mergeMessages(existing: Message[], incoming: Message[], deleted: Record<string, string> = {}) {
  const byId = new Map(existing.map(message => [message.id, message]));
  for (const message of incoming) {
    if (deleted[message.id] || message.deleted) { byId.delete(message.id); continue; }
    if (!byId.has(message.id) || BigInt(message.version) >= BigInt(byId.get(message.id)!.version)) byId.set(message.id, message);
  }
  return [...byId.values()].filter(m => !deleted[m.id] && !m.deleted).sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
}

export class RecoveryRequired extends Error {}
export function applyEvents(snapshot: MessageSnapshot, page: CatchUpPage): MessageSnapshot {
  let cursor = BigInt(snapshot.watermark);
  let messages = snapshot.messages;
  const deleted = { ...snapshot.deletedVersions };
  for (const event of page.events) {
    const sequence = BigInt(event.sequence);
    if (sequence <= cursor) continue;
    if (sequence !== cursor + 1n || Number(event.schemaVersion) !== 1 || !['message.created', 'message.edited', 'message.deleted'].includes(event.kind)) throw new RecoveryRequired('Reload channel history.');
    if (event.kind === 'message.deleted') {
      deleted[event.messageId] = event.version;
      messages = messages.filter(m => m.id !== event.messageId);
    } else if (event.payload) messages = mergeMessages(messages, [event.payload], deleted);
    else throw new RecoveryRequired('Reload channel history.');
    cursor = sequence;
  }
  if (page.hasMore && cursor === BigInt(snapshot.watermark)) throw new RecoveryRequired('Reload channel history.');
  return { ...snapshot, messages, deletedVersions: deleted, watermark: cursor.toString() };
}
