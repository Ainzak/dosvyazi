import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';

export type Message = components['schemas']['MessageDto'];
export type MessageSnapshot = components['schemas']['MessageSnapshot'];
export type CatchUpPage = components['schemas']['CatchUpPage'];
const root = (community: string, channel: string) => `/api/v1/communities/${community}/channels/${channel}`;
export const history = (community: string, channel: string, signal: AbortSignal, before?: string) =>
  callApi(`${root(community, channel)}/messages${before === undefined ? '' : `?before=${encodeURIComponent(before)}`}`, { signal }).then(readJson<MessageSnapshot>);
export const catchUp = (community: string, channel: string, after: string, signal: AbortSignal) =>
  callApi(`${root(community, channel)}/events?after=${encodeURIComponent(after)}`, { signal }).then(readJson<CatchUpPage>);
export const sendMessage = (community: string, channel: string, clientMessageId: string, content: string) =>
  mutateApi<Message>(`${root(community, channel)}/messages`, 'POST', { clientMessageId, content });

export function mergeMessages(existing: Message[], incoming: Message[]) {
  const byId = new Map(existing.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
}
