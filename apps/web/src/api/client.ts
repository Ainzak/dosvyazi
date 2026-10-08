import type { components } from './schema';

export type FoundationInfo = components['schemas']['FoundationInfo'];
export type ReadinessResponse = components['schemas']['ReadinessResponse'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request(path: string, signal: AbortSignal, allowUnavailable = false): Promise<unknown> {
  const response = await fetch(path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok && !(allowUnavailable && response.status === 503)) {
    throw new Error('The service could not be reached.');
  }
  const value: unknown = await response.json();
  if (allowUnavailable && response.status === 503 && (!isRecord(value) || value.status !== 'unhealthy')) {
    throw new Error('The service returned an unexpected response.');
  }
  return value;
}

export async function getSystem(signal: AbortSignal): Promise<FoundationInfo> {
  const value = await request('/api/v1/system', signal);
  if (!isRecord(value) || typeof value.product !== 'string' || typeof value.milestone !== 'string') {
    throw new Error('The service returned an unexpected response.');
  }
  return { product: value.product, milestone: value.milestone };
}

export async function getReadiness(signal: AbortSignal): Promise<ReadinessResponse> {
  const value = await request('/health/ready', signal, true);
  if (!isRecord(value) || !['healthy', 'unhealthy'].includes(String(value.status)) ||
      !isRecord(value.checks) || !['healthy', 'unhealthy'].includes(String(value.checks.database)) ||
      value.status !== value.checks.database) {
    throw new Error('The service returned an unexpected response.');
  }
  return { status: String(value.status), checks: { database: String(value.checks.database) } };
}
