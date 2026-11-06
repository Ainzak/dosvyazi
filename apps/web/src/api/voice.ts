import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';

export type VoiceState = components['schemas']['VoiceStateDto'];
export type VoiceJoin = components['schemas']['VoiceJoinDto'];
export const voiceHref = (id: string, channel = id) => `/communities/${id}/voice${channel === id ? '' : `/${channel}`}`;
const root = (id: string, channel = id) => `/api/v1/communities/${id}/voice${channel === id ? '' : `/channels/${channel}`}`;
export const getVoice = async (id: string, signal?: AbortSignal, leaseId?: string, channel = id) => readJson<VoiceState>(await callApi(root(id, channel) + (leaseId ? `?leaseId=${encodeURIComponent(leaseId)}` : ''), signal ? { signal } : {}));
export const joinVoice = (id: string, clientRequestId: string, channel = id) => mutateApi<VoiceJoin>(`${root(id, channel)}/join`, 'POST', { clientRequestId });
export const endVoice = (id: string, leaseId: string, channel = id) => mutateApi<VoiceState>(`${root(id, channel)}/leave`, 'POST', { leaseId });
export const heartbeatVoice = (id: string, leaseId: string, channel = id) => mutateApi<boolean>(`${root(id, channel)}/heartbeat`, 'POST', { leaseId });
export const disconnectVoice = (id: string, leaseId: string, channel = id) => mutateApi<boolean>(`${root(id, channel)}/disconnect`, 'POST', { leaseId });
