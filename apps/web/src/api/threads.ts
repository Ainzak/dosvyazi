import { callApi, mutateApi, readJson } from './http';
import { communityKeys } from './communities';
import type { components } from './schema';
export type Thread = components['schemas']['ThreadDto'];
export type ThreadPage = components['schemas']['ThreadPage'];
export const threadHref = (community: string, parent: string, thread?: string) => `/communities/${community}/channels/${parent}/threads${thread ? `/${thread}` : ''}`;
const root = (community: string, parent: string) => `/api/v1/communities/${community}/channels/${parent}/threads`;
export const threadKeys = (user: string, community: string, parent: string) => [...communityKeys(user, community), 'channel', parent, 'threads'] as const;
export const listThreads = async (community: string, parent: string, signal: AbortSignal, options: { roots?: string; before?: string; archived?: boolean; query?: string } = {}) => {
  const search = new URLSearchParams(); for (const [key, value] of Object.entries(options)) if (value !== undefined) search.set(key, String(value));
  return readJson<ThreadPage>(await callApi(`${root(community, parent)}?${search}`, { signal }));
};
export const getThread = async (community: string, parent: string, thread: string, signal: AbortSignal) => readJson<Thread>(await callApi(`${root(community, parent)}/${thread}`, { signal }));
export const createThread = (community: string, parent: string, clientRequestId: string, rootMessageId: string, title: string) => mutateApi<Thread>(root(community, parent), 'POST', { clientRequestId, rootMessageId, title });
export const changeThread = (community: string, parent: string, thread: string, clientRequestId: string, expectedVersion: string, title: string, archived: boolean) => mutateApi<Thread>(`${root(community, parent)}/${thread}`, 'PUT', { clientRequestId, expectedVersion, title, archived });
