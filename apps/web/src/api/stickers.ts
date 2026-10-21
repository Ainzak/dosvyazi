import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';
import type { MessageOptions } from './navigation';
export type Pack = components['schemas']['StickerPackDto'];
export type Asset = components['schemas']['StickerAssetDto'];
export type Selection = { id: string; label: string; pack: string };
const root = '/api/v1/sticker-packs';
export const stickerKeys = (user: string) => ['private', user, 'stickers'] as const;
export const library = (signal: AbortSignal) => callApi(root, { signal }).then(readJson<Pack[]>);
export const pack = (name: string, signal: AbortSignal) => callApi(`${root}/${encodeURIComponent(name)}`, { signal }).then(readJson<components['schemas']['StickerPackDetail']>);
export const create = (clientRequestId: string, name: string, title: string) => mutateApi<Pack>(root, 'POST', { clientRequestId, name, title });
export const save = (name: string, saved: boolean) => mutateApi<Pack>(`${root}/${encodeURIComponent(name)}/saved`, 'PUT', { saved });
export const retire = (name: string) => mutateApi<boolean>(`${root}/${encodeURIComponent(name)}/retire`, 'POST');
export const remove = (name: string, id: string) => mutateApi<boolean>(`${root}/${encodeURIComponent(name)}/stickers/${id}/remove`, 'POST');
export const assetUrl = (name: string, id: string) => `${root}/${encodeURIComponent(name)}/stickers/${id}`;
export async function upload(name: string, id: string, label: string, file: File) {
  const token = await callApi('/api/v1/account/csrf').then(readJson<components['schemas']['CsrfResponse']>);
  const body = new FormData(); body.append('clientRequestId', id); body.append('label', label); body.append('file', file);
  return callApi(`${root}/${encodeURIComponent(name)}/stickers`, { method: 'POST', body, headers: { 'X-CSRF-TOKEN': token.requestToken } }, 30000).then(readJson<Asset>);
}
export const sendChannel = (community: string, channel: string, clientMessageId: string, stickerId: string, content: string, options: MessageOptions = {}) => mutateApi<components['schemas']['MessageDto']>(`/api/v1/communities/${community}/channels/${channel}/stickers`, 'POST', { clientMessageId, stickerId, content, ...options });
export const sendDirect = (conversation: string, clientMessageId: string, stickerId: string, content: string, options: MessageOptions = {}) => mutateApi<components['schemas']['DirectMessageDto']>(`/api/v1/direct-messages/${conversation}/stickers`, 'POST', { clientMessageId, stickerId, content, ...options });
