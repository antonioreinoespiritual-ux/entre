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

export const projectChatApi = {
  getHistory: ({ projectId }) => request(`/api/projects/chat/history?${new URLSearchParams({ projectId }).toString()}`).then((r) => r.data || { items: [] }),
  sendMessage: ({ projectId, message }) => request('/api/projects/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ projectId, message }),
  }).then((r) => r.data || {}),
};
