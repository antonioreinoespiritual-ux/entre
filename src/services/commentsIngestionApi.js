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

export const commentsIngestionApi = {
  runIngestion: (payload) => request('/api/comment-base/ingest', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || {}),
  listTable: ({ projectId, campaignId, limit = 100, offset = 0, q = '' }) => request(`/api/comment-base/table?${new URLSearchParams({ projectId, campaignId, limit: String(limit), offset: String(offset), q }).toString()}`).then((r) => r.data || { items: [], total: 0 }),
  listRuns: ({ projectId, campaignId }) => request(`/api/comment-base/runs?${new URLSearchParams({ projectId, campaignId }).toString()}`).then((r) => r.data || { items: [] }),
};
