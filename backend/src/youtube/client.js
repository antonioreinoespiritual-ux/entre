import { setTimeout as delay } from 'node:timers/promises';

const retryableReasons = new Set(['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);

function parseErrorPayload(payload = null) {
  if (!payload || typeof payload !== 'object') return null;
  const message = payload?.error?.message || payload?.message || 'YouTube API request failed';
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || null;
  return { message, reason };
}

export async function youtubeApiRequest({
  baseUrl,
  path,
  params = {},
  method = 'GET',
  accessToken,
  apiKey,
  etag,
  body,
  maxRetries = 2,
}) {
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  if (apiKey) url.searchParams.set('key', apiKey);

  const headers = {
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (etag) headers['If-None-Match'] = etag;

  let attempt = 0;
  while (attempt <= maxRetries) {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    if (response.status === 304) {
      return { status: 304, etag: response.headers.get('etag') || null, data: null };
    }

    const payload = await response.json().catch(() => null);

    if (response.ok) {
      return {
        status: response.status,
        etag: response.headers.get('etag') || null,
        data: payload,
      };
    }

    const parsedError = parseErrorPayload(payload);
    const reason = parsedError?.reason;
    const retryable = response.status >= 500 || retryableReasons.has(reason);
    if (retryable && attempt < maxRetries) {
      await delay(300 * (attempt + 1));
      attempt += 1;
      continue;
    }

    const error = new Error(parsedError?.message || `YouTube API request failed (${response.status})`);
    error.statusCode = response.status;
    error.reason = reason;
    error.payload = payload;
    throw error;
  }

  throw new Error('YouTube API request failed after retries');
}
