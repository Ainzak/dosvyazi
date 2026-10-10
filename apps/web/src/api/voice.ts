import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';

export type VoiceState = components['schemas']['VoiceStateDto'];
export type VoiceJoin = components['schemas']['VoiceJoinDto'];
const root = (id: string) => `/api/v1/communities/${id}/voice`;
export const getVoice = async (id: string, signal?: AbortSignal) => readJson<VoiceState>(await callApi(root(id), signal ? { signal } : {}));
export const joinVoice = (id: string, clientRequestId: string) => mutateApi<VoiceJoin>(`${root(id)}/join`, 'POST', { clientRequestId });
export const endVoice = (id: string, leaseId: string) => mutateApi<VoiceState>(`${root(id)}/leave`, 'POST', { leaseId });
export const heartbeatVoice = (id: string, leaseId: string) => mutateApi<boolean>(`${root(id)}/heartbeat`, 'POST', { leaseId });
