import type { components } from './schema';
import { callApi, mutateApi, readJson } from './http';

export type UserProfile = components['schemas']['UserProfile'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type LoginRequest = components['schemas']['LoginRequest'];
type UpdateProfileRequest = components['schemas']['UpdateProfileRequest'];
export const sessionKey = ['account-session'] as const;

export async function getProfile(signal: AbortSignal): Promise<UserProfile | null> {
  const response = await callApi('/api/v1/account/me', { signal });
  if (response.status === 401) return null;
  return readJson<UserProfile>(response);
}
export const register = (request: RegisterRequest) => mutateApi<UserProfile>('/api/v1/account/register', 'POST', request);
export const login = (request: LoginRequest) => mutateApi<UserProfile>('/api/v1/account/login', 'POST', request);
export const updateProfile = (request: UpdateProfileRequest) => mutateApi<UserProfile>('/api/v1/account/me', 'PUT', request);
export const logout = () => mutateApi<void>('/api/v1/account/logout', 'POST');
