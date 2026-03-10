const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try {
    return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || '';
  } catch {
    return '';
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed: ${response.status}`);
  return payload;
}

export const youtubeApi = {
  getConfig: () => request('/api/youtube/config').then((r) => r.data || {}),
  startOAuth: (redirectPath = '/projects') => request('/api/youtube/auth/start', {
    method: 'POST',
    body: JSON.stringify({ redirect_path: redirectPath }),
  }).then((r) => r.data || {}),
  disconnect: () => request('/api/youtube/auth/disconnect', { method: 'POST' }),
  listChannels: (query = {}) => request(`/api/youtube/channels?${new URLSearchParams(query).toString()}`).then((r) => r.data || { items: [] }),
};
