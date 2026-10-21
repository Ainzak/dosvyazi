import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';
import { appendOptions } from './navigation';
import type { MessageOptions } from './navigation';
import { preparePreview } from '../features/messages/imagePreparation';

export type Conversation = components['schemas']['DirectConversationDto'];
export type DirectMessage = components['schemas']['DirectMessageDto'];
export type DirectSnapshot = components['schemas']['DirectSnapshot'] & { deletedVersions?: Record<string, string> };
export type DirectInbox = components['schemas']['DirectInbox'];
const root = '/api/v1/direct-messages';
export const directKeys = (user: string) => ['private', user, 'direct'] as const;
export const inbox = (signal: AbortSignal, before?: string) => callApi(root + (before ? `?before=${encodeURIComponent(before)}` : ''), { signal }).then(readJson<DirectInbox>);
export const conversation = (id: string, signal: AbortSignal) => callApi(`${root}/${id}`, { signal }).then(readJson<Conversation>);
export const startConversation = (id: string, clientRequestId: string) => mutateApi<Conversation>(root, 'POST', { userId: id, clientRequestId });
export const history = (id: string, signal: AbortSignal, before?: string) => callApi(`${root}/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, { signal }).then(readJson<DirectSnapshot>);
export const events = (id: string, after: string, signal: AbortSignal) => callApi(`${root}/${id}/events?after=${encodeURIComponent(after)}`, { signal }).then(readJson<components['schemas']['DirectCatchUp']>);
export const send = (id: string, clientMessageId: string, content: string, options: MessageOptions = {}) => mutateApi<DirectMessage>(`${root}/${id}/messages`, 'POST', { clientMessageId, content, ...options });
export async function sendFile(id: string, clientMessageId: string, content: string, file: File, voice: boolean, options: MessageOptions = {}) {
  const token = await callApi('/api/v1/account/csrf').then(readJson<components['schemas']['CsrfResponse']>);
  const body = new FormData(); body.append('clientMessageId', clientMessageId); body.append('content', content); body.append('file', file);
  if (!voice) { const preview = await preparePreview(file); if (preview) body.append('preview', preview, 'preview.image'); }
  appendOptions(body, options);
  return callApi(`${root}/${id}/${voice ? 'voice-messages' : 'attachments'}`, { method: 'POST', body, headers: { 'X-CSRF-TOKEN': token.requestToken } }, 30000).then(readJson<DirectMessage>);
}
export const attachmentUrl = (id: string, attachment: string) => `${root}/${id}/attachments/${attachment}`;
export const markRead = (id: string, sequence: string) => mutateApi<Conversation>(`${root}/${id}/read`, 'PUT', { sequence });
export const block = (id: string, clientRequestId: string, blocked: boolean) => mutateApi<Conversation>(`${root}/${id}/block`, 'PUT', { clientRequestId, blocked });
export const edit = (id: string, message: string, clientRequestId: string, expectedVersion: string, content: string) => mutateApi<DirectMessage>(`${root}/${id}/messages/${message}`, 'PUT', { clientRequestId, expectedVersion, content });
export const remove = (id: string, message: string, clientRequestId: string, expectedVersion: string) => mutateApi<DirectMessage>(`${root}/${id}/messages/${message}/delete`, 'POST', { clientRequestId, expectedVersion });

export function mergeDirect(current: DirectMessage[], incoming: DirectMessage[], deleted: Record<string, string> = {}) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) {
    if (message.deleted || deleted[message.id]) { byId.delete(message.id); continue; }
    if (!byId.has(message.id) || BigInt(message.version) >= BigInt(byId.get(message.id)!.version)) byId.set(message.id, message);
  }
  return [...byId.values()].filter(message => !deleted[message.id] && !message.deleted).sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1);
}
export function applyDirect(snapshot: DirectSnapshot, page: components['schemas']['DirectCatchUp']) {
  let cursor = BigInt(snapshot.watermark); let messages = snapshot.messages; const deleted = { ...snapshot.deletedVersions };
  for (const event of page.events) {
    if (BigInt(event.sequence) <= cursor) continue;
    if (BigInt(event.sequence) !== cursor + 1n || !['message.created', 'message.edited', 'message.deleted', 'contact.changed'].includes(event.kind)) throw new Error('Reload conversation history.');
    if (event.message?.deleted) { deleted[event.message.id] = event.message.version; messages = messages.filter(message => message.id !== event.message!.id); }
    else if (event.message) messages = mergeDirect(messages, [event.message], deleted);
    cursor = BigInt(event.sequence);
  }
  if (page.hasMore && cursor === BigInt(snapshot.watermark)) throw new Error('Reload conversation history.');
  if (!page.hasMore && cursor !== BigInt(page.watermark)) throw new Error('Reload conversation history.');
  return { ...snapshot, messages, deletedVersions: deleted, watermark: page.hasMore ? page.nextSequence : page.watermark };
}
