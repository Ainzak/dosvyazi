import type { components } from './schema';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callApi(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000) });
  } catch { throw new ApiError(0, 'Cannot reach Dosvyazi. Check your connection and try again.'); }
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem: { title?: string; errors?: Record<string, string[]> } = await response.json().catch(() => ({}));
    const validation = Object.values(problem.errors ?? {}).flat()[0];
    throw new ApiError(response.status, validation ?? (response.status === 400
      ? 'Your session may have changed. Check the form and try again.' : problem.title ?? 'The request could not be completed. Try again.'));
  }
  return response.status === 204 ? undefined as T : response.json();
}

export async function mutateApi<T>(path: string, method: string, body?: unknown): Promise<T> {
  // Antiforgery request tokens are identity-bound; do not reuse tokens after account changes.
  const token = await readJson<components['schemas']['CsrfResponse']>(await callApi('/api/v1/account/csrf'));
  return readJson<T>(await callApi(path, { method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token.requestToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
