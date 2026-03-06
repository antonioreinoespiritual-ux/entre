const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export const interviewsApi = {
  listAudiences: (campaignId) => request(`/api/campaigns/${campaignId}/audiences`).then((r) => r.data || []),

  listClients: (projectId, campaignId, audienceId = '') => {
    const qs = audienceId ? `?audience_id=${encodeURIComponent(audienceId)}` : '';
    return request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients${qs}`).then((r) => r.data || []);
  },
  createClient: (projectId, campaignId, payload) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  updateClient: (id, payload) => request(`/api/interview-clients/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  deleteClient: (id) => request(`/api/interview-clients/${id}`, { method: 'DELETE' }),

  listInterviewHypotheses: (projectId, campaignId) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/hypotheses`).then((r) => r.data || []),
  createInterviewHypothesis: (projectId, campaignId, payload) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/hypotheses`, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  updateInterviewHypothesis: (id, payload) => request(`/api/interview-hypotheses/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  deleteInterviewHypothesis: (id) => request(`/api/interview-hypotheses/${id}`, { method: 'DELETE' }),

  listForms: (projectId, campaignId) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/forms`).then((r) => r.data || []),
  createForm: (projectId, campaignId, payload) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/forms`, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  updateForm: (id, payload) => request(`/api/interview-forms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  deleteForm: (id) => request(`/api/interview-forms/${id}`, { method: 'DELETE' }),

  listInterviewSessions: (projectId, campaignId) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`).then((r) => r.data || []),
  createSession: (projectId, campaignId, payload) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  readSession: (id) => request(`/api/interview-sessions/${id}`).then((r) => r.data),
  updateSession: (id, payload) => request(`/api/interview-sessions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  deleteSession: (id) => request(`/api/interview-sessions/${id}`, { method: 'DELETE' }),

  listInterviewCloudOverview: (projectId, campaignId) => request(`/api/projects/${projectId}/campaigns/${campaignId}/interviews/cloud`).then((r) => r.data || null),
  listInterviewCloudNodes: (projectId, parentId) => {
    const qs = new URLSearchParams({ projectId, ...(parentId ? { parentId } : {}) });
    return request(`/api/cloud/list?${qs.toString()}`).then((r) => r.data || []);
  },

  readInterviewCloudDocument: (nodeId) => request(`/api/interviews/cloud/document?nodeId=${encodeURIComponent(nodeId)}`).then((r) => r.data || null),
  listInterviewDocumentFragments: (documentNodeId) => request(`/api/interviews/fragments?documentNodeId=${encodeURIComponent(documentNodeId)}`).then((r) => r.data || []),
  createInterviewDocumentFragment: (payload) => request('/api/interviews/fragments', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data || null),

};
