import { getYouTubeConfig } from './config.js';

export function buildYouTubeConsentUrl({ state, config = getYouTubeConfig() }) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    scope: config.scopes.join(' '),
    state,
  });
  return `${config.oauthAuthUrl}?${params.toString()}`;
}

async function postForm(url, form) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error_description || payload?.error || 'OAuth request failed');
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function exchangeYouTubeCodeForTokens({ code, config = getYouTubeConfig() }) {
  return postForm(config.oauthTokenUrl, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
}

export async function refreshYouTubeAccessToken({ refreshToken, config = getYouTubeConfig() }) {
  return postForm(config.oauthTokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

export async function revokeYouTubeToken({ token, config = getYouTubeConfig() }) {
  const response = await fetch(config.oauthRevokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}
