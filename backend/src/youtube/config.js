import process from 'node:process';

const defaultScopes = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

export function getYouTubeConfig() {
  const scopes = (process.env.YOUTUBE_SCOPES || defaultScopes.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    apiBaseUrl: 'https://www.googleapis.com/youtube/v3',
    oauthAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauthTokenUrl: 'https://oauth2.googleapis.com/token',
    oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
    apiKey: process.env.YOUTUBE_API_KEY || '',
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || '',
    scopes,
    frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:3000',
  };
}

export function isYouTubeOAuthConfigured(config = getYouTubeConfig()) {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function isYouTubeApiKeyConfigured(config = getYouTubeConfig()) {
  return Boolean(config.apiKey);
}
