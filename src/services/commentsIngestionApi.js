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
  saveInput: (payload) => request('/api/comment-base/inputs', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || {}),
  listInputs: ({ projectId, campaignId }) => request(`/api/comment-base/inputs?${new URLSearchParams({ projectId, campaignId }).toString()}`).then((r) => r.data || { items: [] }),
  runIngestion: (payload) => request('/api/comment-base/ingest', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || {}),
  listTable: ({ projectId, campaignId, limit = 100, offset = 0, q = '' }) => request(`/api/comment-base/table?${new URLSearchParams({ projectId, campaignId, limit: String(limit), offset: String(offset), q }).toString()}`).then((r) => r.data || { items: [], total: 0 }),
  listRuns: ({ projectId, campaignId }) => request(`/api/comment-base/runs?${new URLSearchParams({ projectId, campaignId }).toString()}`).then((r) => r.data || { items: [] }),
  deleteRun: ({ runId, projectId, campaignId }) => request(`/api/comment-base/runs/${encodeURIComponent(runId)}?${new URLSearchParams({ projectId, campaignId }).toString()}`, { method: 'DELETE' }).then((r) => r.data || {}),
  enrichFragments: (payload) => request('/api/comment-base/fragments/enrich', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || { items: [], meta: {} }),
  runCodeSelectionAgent: (payload) => request('/api/comment-base/code-selection-agent', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || { selected_fragments: [], clusters_internal: [], final_code_proposals: [], metrics: {} }),
  runCodeGenerationAgent: (payload) => request('/api/comment-base/code-generation-agent', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || { proposals: [], metrics: {}, meta: {} }),
  saveCodeProposalReview: (payload) => request('/api/comment-base/code-proposal-reviews', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || {}),
  listCodeProposalReviews: ({ projectId, campaignId, limit = 500 }) => request(`/api/comment-base/code-proposal-reviews?${new URLSearchParams({ projectId, campaignId, limit: String(limit) }).toString()}`).then((r) => r.data || { items: [] }),
  extractSemanticFragments: ({ comment_id, source_id, texto_completo_del_comentario, comments, existing_codes = [] }) => request('/api/comment-base/semantic-fragment-agent', {
    method: 'POST',
    body: JSON.stringify({ comment_id, source_id, texto_completo_del_comentario, comments, existing_codes }),
  }).then((r) => r.data || { comment_id, fragments: [] }),
};
