import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';
const root = (community: string, channel: string) => `/api/v1/communities/${community}/channels/${channel}`;
export const reactions = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
export const react = (community: string, channel: string, message: string, clientRequestId: string, emoji: string, active: boolean) => mutateApi<components['schemas']['MessageDto']>(`${root(community, channel)}/messages/${message}/reaction`, 'PUT', { clientRequestId, emoji, active });
export const search = (community: string, channel: string, query: string, before?: string, signal?: AbortSignal) => callApi(`${root(community, channel)}/search?query=${encodeURIComponent(query)}${before ? `&before=${before}` : ''}`, { signal: signal ?? null }).then(readJson<components['schemas']['SearchPage']>);
export const getRead = (community: string, channel: string, signal: AbortSignal) => callApi(`${root(community, channel)}/read-state`, { signal }).then(readJson<components['schemas']['ReadStateDto']>);
export const markRead = (community: string, channel: string, sequence: string) => mutateApi<components['schemas']['ReadStateDto']>(`${root(community, channel)}/read-state`, 'PUT', { sequence });
export const listEmoji = (community: string, signal: AbortSignal) => callApi(`/api/v1/communities/${community}/emoji`, { signal }).then(readJson<components['schemas']['EmojiDto'][]>);
export const emojiImage = (community: string, id: string) => `/api/v1/communities/${community}/emoji/${id}/image`;
export const removeEmoji = (community: string, id: string) => mutateApi<void>(`/api/v1/communities/${community}/emoji/${id}/delete`, 'POST');
export async function createEmoji(community: string, clientRequestId: string, name: string, file: File) {
  const token = await readJson<components['schemas']['CsrfResponse']>(await callApi('/api/v1/account/csrf'));
  const body = new FormData(); body.append('clientRequestId', clientRequestId); body.append('name', name); body.append('file', file);
  return readJson<components['schemas']['EmojiDto']>(await callApi(`/api/v1/communities/${community}/emoji`, { method: 'POST', body, headers: { 'X-CSRF-TOKEN': token.requestToken } }, 30_000));
}
export const profile = (id: string, signal: AbortSignal) => callApi(`/api/v1/profiles/${id}`, { signal }).then(readJson<components['schemas']['PublicProfileDto']>);
export const saveProfileDetails = (details: components['schemas']['ProfileDetailsRequest']) => mutateApi<components['schemas']['PublicProfileDto']>('/api/v1/profiles/me', 'PUT', details);
