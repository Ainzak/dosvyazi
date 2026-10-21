import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';
export type Scope = { kind: 'channel' | 'direct'; container: string; user: string };
export type Source = components['schemas']['SourceDto'];
export type Bookmark = components['schemas']['BookmarkDto'];
export type Member = components['schemas']['MentionMember'];
export type MessageOptions = { replyToId?: string | null; mentionUserIds?: string[] };
export const navigationKeys = (user: string) => ['private', user, 'navigation'] as const;
const root = '/api/v1/navigation';
const scopePath = (scope: Scope) => `${root}/${scope.kind}/${scope.container}`;
export const source = (scope: Scope, message: string, signal: AbortSignal) => callApi(`${scopePath(scope)}/messages/${encodeURIComponent(message)}`, { signal }).then(readJson<Source>);
export const bookmarkInfo = (scope: Scope, message: string) => callApi(`${scopePath(scope)}/bookmarks/${message}`).then(readJson<Bookmark | null>);
export const members = (scope: Scope, query: string, signal: AbortSignal) => callApi(`${scopePath(scope)}/members?query=${encodeURIComponent(query)}`, { signal }).then(readJson<Member[]>);
export const preference = (scope: Scope, signal: AbortSignal) => callApi(`${scopePath(scope)}/preference`, { signal }).then(readJson<components['schemas']['PreferenceDto']>);
export const setPreference = (scope: Scope, mode: string, clientRequestId: string) => mutateApi<components['schemas']['PreferenceDto']>(`${scopePath(scope)}/preference`, 'PUT', { mode, clientRequestId });
export const saveBookmark = (scope: Scope, message: string, note: string, tags: string[], removed: boolean, clientRequestId: string) => mutateApi<boolean>(`${root}/bookmarks`, 'PUT', { kind: scope.kind, containerId: scope.container, messageId: message, note, tags, removed, clientRequestId });
export const bookmarks = (signal: AbortSignal, tag = '', query = '', before = '') => callApi(`${root}/bookmarks?${new URLSearchParams({ ...(tag ? { tag } : {}), ...(query ? { query } : {}), ...(before ? { before } : {}) })}`, { signal }).then(readJson<components['schemas']['BookmarkPage']>);
export const notices = (signal: AbortSignal, before = '') => callApi(`${root}/notices${before ? `?before=${encodeURIComponent(before)}` : ''}`, { signal }).then(readJson<components['schemas']['NoticePage']>);
export const readNotice = (id: string, clientRequestId: string) => mutateApi<boolean>(`${root}/notices/${id}`, 'PUT', { clientRequestId, read: true });
export function appendOptions(form: FormData, options: MessageOptions) {
  if (options.replyToId) form.append('replyToId', options.replyToId);
  for (const id of options.mentionUserIds ?? []) form.append('mentionUserIds', id);
}
