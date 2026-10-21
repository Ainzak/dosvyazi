import { ApiError, callApi, mutateApi, readJson } from './http';
import type { components } from './schema';
export type RightsExplanation = components['schemas']['RightsExplanation'];
export type CommunityConfiguration = components['schemas']['CommunityConfiguration'];
const root = '/api/v1/communities';
export const explainRights = async (id: string, kind: string, channel: string, user: string, signal: AbortSignal) => readJson<RightsExplanation>(await callApi(`${root}/${id}/rights?${new URLSearchParams({ kind, ...(channel ? { channelId: channel } : {}), ...(user ? { userId: user } : {}) })}`, { signal }));
export const exportConfiguration = async (id: string) => readJson<CommunityConfiguration>(await callApi(`${root}/${id}/configuration`));
export const previewConfiguration = async (configuration: unknown) => {
  try { return await mutateApi<CommunityConfiguration>(`${root}/configuration/preview`, 'POST', { configuration }); }
  catch (error) { if (error instanceof ApiError && error.status === 400) throw new ApiError(400, 'Invalid configuration file. Use an unmodified version 1 export.'); throw error; }
};
export const restoreConfiguration = (clientRequestId: string, name: string, configuration: CommunityConfiguration) => mutateApi<components['schemas']['ConfigurationRestored']>(`${root}/configuration/restore`, 'POST', { clientRequestId, name, configuration });
