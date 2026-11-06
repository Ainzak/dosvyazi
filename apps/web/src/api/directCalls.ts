import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';
import type { VoiceJoin, VoiceState } from './voice';

export type DirectCall = components['schemas']['DirectCallDto'];
const root = '/api/v1/direct-calls';
export const currentCalls = async (signal: AbortSignal) => readJson<DirectCall[]>(await callApi(root, { signal }));
export const startCall = (conversation: string, clientRequestId: string) => mutateApi<DirectCall>(`${root}/conversation/${conversation}`, 'POST', { clientRequestId });
export const acceptCall = (id: string) => mutateApi<DirectCall>(`${root}/${id}/accept`, 'POST');
export const endCall = (id: string) => mutateApi<DirectCall>(`${root}/${id}/end`, 'POST');
export const joinCall = (id: string, clientRequestId: string) => mutateApi<VoiceJoin>(`${root}/${id}/join`, 'POST', { clientRequestId });
export const callState = async (id: string) => readJson<VoiceState>(await callApi(`${root}/${id}/state`));
export const heartbeatCall = (id: string, leaseId: string) => mutateApi<boolean>(`${root}/${id}/heartbeat`, 'POST', { leaseId });
