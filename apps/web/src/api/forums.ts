import { callApi, mutateApi, readJson } from './http';
import { communityKeys } from './communities';
import type { components } from './schema';
export type ForumTopic = components['schemas']['ForumTopicDto'];
export type ForumTopicPage = components['schemas']['ForumTopicPage'];
export const forumHref = (community: string, forum: string, topic?: string) => `/communities/${community}/forums/${forum}${topic ? `/topics/${topic}` : ''}`;
const root = (community: string, forum: string) => `/api/v1/communities/${community}/forums/${forum}/topics`;
export const forumKeys = (user: string, community: string, forum: string) => [...communityKeys(user, community), 'forum', forum] as const;
export const listForumTopics = async (community: string, forum: string, signal: AbortSignal, options: { before?: string; archived?: boolean; query?: string } = {}) => {
  const search = new URLSearchParams(); for (const [key, value] of Object.entries(options)) if (value !== undefined) search.set(key, String(value));
  return readJson<ForumTopicPage>(await callApi(`${root(community, forum)}?${search}`, { signal }));
};
export const getForumTopic = async (community: string, forum: string, topic: string, signal: AbortSignal) => readJson<ForumTopic>(await callApi(`${root(community, forum)}/${topic}`, { signal }));
export const createForumTopic = (community: string, forum: string, clientRequestId: string, title: string, content: string) => mutateApi<ForumTopic>(root(community, forum), 'POST', { clientRequestId, title, content });
export const changeForumTopic = (community: string, forum: string, topic: string, clientRequestId: string, expectedVersion: string, title: string, archived: boolean) => mutateApi<ForumTopic>(`${root(community, forum)}/${topic}`, 'PUT', { clientRequestId, expectedVersion, title, archived });
