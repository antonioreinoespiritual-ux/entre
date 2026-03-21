const DB_NAME = 'entre-comments-mode-db';
const STORE_NAME = 'states';
const DB_VERSION = 1;
const configuredApiBaseUrl = (import.meta.env && import.meta.env.VITE_BACKEND_URL) || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

const openCommentsModeDb = () => new Promise((resolve, reject) => {
  try {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
  } catch (error) {
    reject(error);
  }
});

const runIdbRequest = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Error en operación IndexedDB'));
});

const getStoredSession = () => {
  try {
    const raw = localStorage.getItem(sessionStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const candidateApiBaseUrls = () => {
  const candidates = [configuredApiBaseUrl];

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const fallbackProtocol = protocol === 'https:' ? 'https:' : 'http:';
    candidates.push(`${fallbackProtocol}//${hostname}:4000`);
    candidates.push('http://127.0.0.1:4000');
    candidates.push('http://localhost:4000');
  }

  return [...new Set(candidates.filter(Boolean))];
};

const requestBackend = async (path, options = {}) => {
  const session = getStoredSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  let lastError = null;
  for (const baseUrl of candidateApiBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
      return json;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'No se pudo conectar al backend del modo comentarios.');
};

const readCachedCommentsModeStore = async (storageKey) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return null;
  const db = await openCommentsModeDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const value = await runIdbRequest(store.get(storageKey));
  db.close();
  return value || null;
};

const writeCachedCommentsModeStore = async (storageKey, payload) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return;
  const db = await openCommentsModeDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await runIdbRequest(store.put(payload, storageKey));
  db.close();
};

export const listCommentsModeStores = async ({ projectId = '', campaignId = '' } = {}) => {
  if (!projectId || !campaignId) return [];
  const response = await requestBackend(`/api/comment-mode/states?${new URLSearchParams({ projectId, campaignId }).toString()}`, { method: 'GET' });
  return Array.isArray(response?.data?.items) ? response.data.items : [];
};

export const loadCommentsModeStore = async (storageKey) => {
  if (!storageKey) return null;
  try {
    const response = await requestBackend(`/api/comment-mode/state?${new URLSearchParams({ storageKey }).toString()}`, { method: 'GET' });
    const payload = response?.data?.payload || null;
    if (payload) {
      await writeCachedCommentsModeStore(storageKey, payload);
      return payload;
    }
  } catch {
    // fallback to cached state below
  }

  return readCachedCommentsModeStore(storageKey);
};

export const saveCommentsModeStore = async (storageKey, payload) => {
  if (!storageKey) return;
  await writeCachedCommentsModeStore(storageKey, payload);
  await requestBackend('/api/comment-mode/state', {
    method: 'POST',
    body: JSON.stringify({ storageKey, payload }),
  });
};

export const updateCommentHypothesisManualState = async ({ storageKey = '', hypothesisId = '', nextState = '' } = {}) => {
  if (!storageKey || !hypothesisId) throw new Error('storageKey y hypothesisId son obligatorios.');
  const response = await requestBackend('/api/comment-mode/hypotheses/manual-state', {
    method: 'POST',
    body: JSON.stringify({ storageKey, hypothesisId, nextState }),
  });
  const payload = response?.data?.payload || null;
  if (payload) await writeCachedCommentsModeStore(storageKey, payload);
  return response?.data || null;
};

export const migrateLocalCommentsModeStoreToBackend = async (storageKey) => {
  const cached = await readCachedCommentsModeStore(storageKey);
  if (!cached) return null;
  await saveCommentsModeStore(storageKey, cached);
  return cached;
};
