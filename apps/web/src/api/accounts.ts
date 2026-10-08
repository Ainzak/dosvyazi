import type { components } from './schema';

export type UserProfile = components['schemas']['UserProfile'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type LoginRequest = components['schemas']['LoginRequest'];
type UpdateProfileRequest = components['schemas']['UpdateProfileRequest'];
export const sessionKey = ['account-session'] as const;

export class AccountApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call(path: string, options: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/account/${path}`, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
  } catch { throw new AccountApiError(0, 'Cannot reach Dosvyazi. Check your connection and try again.'); }
  return response;
}

async function failure(response: Response): Promise<never> {
  const problem: { title?: string; errors?: Record<string, string[]> } = await response.json().catch(() => ({}));
  const validation = Object.values(problem.errors ?? {}).flat()[0];
  throw new AccountApiError(response.status, validation ?? (response.status === 400
    ? 'Your session may have changed. Check the form and try again.' : problem.title ?? 'The request could not be completed. Try again.'));
}

export async function getProfile(signal: AbortSignal): Promise<UserProfile | null> {
  const response = await call('me', { signal });
  if (response.status === 401) return null;
  if (!response.ok) return failure(response);
  return response.json();
}

async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  // Request tokens are identity-bound. Fetch a fresh one before every mutation, including after a tab changes accounts.
  const csrf = await call('csrf');
  if (!csrf.ok) return failure(csrf);
  const token: components['schemas']['CsrfResponse'] = await csrf.json();
  const response = await call(path, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token.requestToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) return failure(response);
  return response.status === 204 ? undefined as T : response.json();
}

export const register = (request: RegisterRequest) => mutate<UserProfile>('register', 'POST', request);
export const login = (request: LoginRequest) => mutate<UserProfile>('login', 'POST', request);
export const updateProfile = (request: UpdateProfileRequest) => mutate<UserProfile>('me', 'PUT', request);
export const logout = () => mutate<void>('logout', 'POST');
