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

export const accountIntegrationsApi = {
  getAiConfig: () => request('/api/integrations/ai/config').then((r) => r.data || {}),
  saveAiSettings: (payload) => request('/api/integrations/ai/settings', { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data || {}),
  getOpenClawConfig: () => request('/api/integrations/openclaw/config').then((r) => r.data || {}),
  saveOpenClawSettings: (payload) => request('/api/integrations/openclaw/settings', { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data || {}),
};
