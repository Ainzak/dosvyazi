import type { components } from './schema';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function callApi(path: string, options: RequestInit = {}, timeout = 8_000): Promise<Response> {
  try {
    return await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  } catch (error) {
    // Query cancellation is deliberate, not a failed connection. Preserve the
    // abort reason so canceled navigation/account changes cannot show an alert.
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new ApiError(0, 'Cannot reach Dosvyazi. Check your connection and try again.');
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem: { title?: string; code?: string; errors?: Record<string, string[]> } = await response.json().catch(() => ({}));
    const validation = Object.values(problem.errors ?? {}).flat()[0];
    throw new ApiError(response.status, validation ?? (response.status === 400
      ? 'Your session may have changed. Check the form and try again.' : problem.title ?? 'The request could not be completed. Try again.'), problem.code);
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
