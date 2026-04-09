const DB_NAME = 'entre-comments-mode-db';
const STORE_NAME = 'states';
const DB_VERSION = 1;
const configuredApiBaseUrl = (import.meta.env && import.meta.env.VITE_BACKEND_URL) || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';
const commentsModeBroadcastPrefix = 'comments-mode:sync:';
const commentsModeStorageEventPrefix = 'comments-mode:event:';
const idbOpenTimeoutMs = Number(import.meta.env?.VITE_COMMENTS_IDB_OPEN_TIMEOUT_MS || 2500);
const idbRequestTimeoutMs = Number(import.meta.env?.VITE_COMMENTS_IDB_REQUEST_TIMEOUT_MS || 2500);
const commentsBackendRequestTimeoutMs = Number(import.meta.env?.VITE_COMMENTS_BACKEND_TIMEOUT_MS || 8000);

const createEmptyCommentsStore = () => ({
  fragments: [],
  codes: [],
  codeProposals: [],
  hypotheses: [],
  hypothesisEvolutionLinks: [],
  hypothesisCrossModeIdentities: [],
  hypothesisTopology: [],
  codeMapLayoutsByHypothesis: {},
  codeMapAnalysisSessions: {},
  codeMapVisualProfilesByScope: {},
  hypothesisMapLayout: {},
});

const normalizeCommentsModeStorePayload = (payload = {}) => {
  const safe = payload && typeof payload === 'object' ? payload : {};
  return {
    fragments: Array.isArray(safe.fragments) ? safe.fragments : [],
    codes: Array.isArray(safe.codes) ? safe.codes : [],
    codeProposals: Array.isArray(safe.codeProposals) ? safe.codeProposals : [],
    hypotheses: Array.isArray(safe.hypotheses) ? safe.hypotheses : [],
    hypothesisEvolutionLinks: Array.isArray(safe.hypothesisEvolutionLinks) ? safe.hypothesisEvolutionLinks : [],
    hypothesisCrossModeIdentities: Array.isArray(safe.hypothesisCrossModeIdentities) ? safe.hypothesisCrossModeIdentities : [],
    hypothesisTopology: Array.isArray(safe.hypothesisTopology) ? safe.hypothesisTopology : [],
    codeMapLayoutsByHypothesis: safe.codeMapLayoutsByHypothesis && typeof safe.codeMapLayoutsByHypothesis === 'object'
      ? safe.codeMapLayoutsByHypothesis
      : {},
    codeMapAnalysisSessions: safe.codeMapAnalysisSessions && typeof safe.codeMapAnalysisSessions === 'object'
      ? safe.codeMapAnalysisSessions
      : {},
    codeMapVisualProfilesByScope: safe.codeMapVisualProfilesByScope && typeof safe.codeMapVisualProfilesByScope === 'object'
      ? safe.codeMapVisualProfilesByScope
      : {},
    hypothesisMapLayout: safe.hypothesisMapLayout && typeof safe.hypothesisMapLayout === 'object'
      ? safe.hypothesisMapLayout
      : {},
  };
};

const normalizeTimestamp = (value) => {
  if (value == null || value === '') return 0;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeEntityId = (entity = {}, fallbackPrefix = 'entity') => {
  if (fallbackPrefix === 'evolution-link') {
    const sourceId = String(entity?.source_hypothesis_id || '').trim();
    const destinationMode = String(entity?.destination_mode || '').trim();
    const destinationId = String(entity?.destination_hypothesis_id || '').trim();
    if (sourceId || destinationMode || destinationId) return `${sourceId}|${destinationMode}|${destinationId}`;
  }
  if (fallbackPrefix === 'topology') {
    const parentId = String(entity?.parent?.hypothesis_id || entity?.parent_hypothesis_id || '').trim();
    const childId = String(entity?.child?.hypothesis_id || entity?.hypothesis_id || entity?.id || '').trim();
    if (parentId || childId) return `${parentId}|${childId}`;
  }
  if (fallbackPrefix === 'identity') {
    const identityId = String(entity?.identity_id || '').trim();
    if (identityId) return identityId;
    const nodes = Array.isArray(entity?.nodes) ? entity.nodes : [];
    if (nodes.length) return nodes.map((node) => `${node?.mode || ''}:${node?.hypothesis_id || ''}`).sort().join('|');
  }
  return String(
    entity?.id
    ?? entity?.hypothesis_id
    ?? entity?.identity_id
    ?? entity?.link_id
    ?? entity?.slug
    ?? entity?.code
    ?? entity?.profile_id
    ?? entity?.comment_id
    ?? entity?.source_comment_id
    ?? `${fallbackPrefix}:${JSON.stringify(entity)}`,
  ).trim();
};

const pickLatestEntity = (current, candidate) => {
  if (!current) return candidate;
  const currentTimestamp = Math.max(
    normalizeTimestamp(current?.updated_at),
    normalizeTimestamp(current?.created_at),
  );
  const candidateTimestamp = Math.max(
    normalizeTimestamp(candidate?.updated_at),
    normalizeTimestamp(candidate?.created_at),
  );
  if (candidateTimestamp > currentTimestamp) return candidate;
  if (candidateTimestamp < currentTimestamp) return current;
  return { ...current, ...candidate };
};

const mergeEntityArrays = (baseItems = [], incomingItems = [], fallbackPrefix = 'entity') => {
  const merged = new Map();
  [...baseItems, ...incomingItems].forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = normalizeEntityId(item, fallbackPrefix);
    if (!key) return;
    merged.set(key, pickLatestEntity(merged.get(key), item));
  });
  return [...merged.values()];
};

const mergeObjectMaps = (baseValue = {}, incomingValue = {}) => {
  const base = baseValue && typeof baseValue === 'object' ? baseValue : {};
  const incoming = incomingValue && typeof incomingValue === 'object' ? incomingValue : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(incoming)]);
  const result = {};
  keys.forEach((key) => {
    const baseEntry = base[key];
    const incomingEntry = incoming[key];
    if (
      baseEntry && typeof baseEntry === 'object' && !Array.isArray(baseEntry)
      && incomingEntry && typeof incomingEntry === 'object' && !Array.isArray(incomingEntry)
    ) {
      result[key] = { ...baseEntry, ...incomingEntry };
      return;
    }
    result[key] = incomingEntry === undefined ? baseEntry : incomingEntry;
  });
  return result;
};

const withTimeout = (promise, timeoutMs, label = 'operation') => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
  promise
    .then((value) => {
      clearTimeout(timer);
      resolve(value);
    })
    .catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
});

export const mergeCommentsModeStorePayloads = (basePayload = {}, incomingPayload = {}) => {
  const base = normalizeCommentsModeStorePayload(basePayload);
  const incoming = normalizeCommentsModeStorePayload(incomingPayload);
  return {
    fragments: mergeEntityArrays(base.fragments, incoming.fragments, 'fragment'),
    codes: mergeEntityArrays(base.codes, incoming.codes, 'code'),
    codeProposals: mergeEntityArrays(base.codeProposals, incoming.codeProposals, 'proposal'),
    hypotheses: mergeEntityArrays(base.hypotheses, incoming.hypotheses, 'hypothesis'),
    hypothesisEvolutionLinks: mergeEntityArrays(base.hypothesisEvolutionLinks, incoming.hypothesisEvolutionLinks, 'evolution-link'),
    hypothesisCrossModeIdentities: mergeEntityArrays(base.hypothesisCrossModeIdentities, incoming.hypothesisCrossModeIdentities, 'identity'),
    hypothesisTopology: mergeEntityArrays(base.hypothesisTopology, incoming.hypothesisTopology, 'topology'),
    codeMapLayoutsByHypothesis: mergeObjectMaps(base.codeMapLayoutsByHypothesis, incoming.codeMapLayoutsByHypothesis),
    codeMapAnalysisSessions: mergeObjectMaps(base.codeMapAnalysisSessions, incoming.codeMapAnalysisSessions),
    codeMapVisualProfilesByScope: mergeObjectMaps(base.codeMapVisualProfilesByScope, incoming.codeMapVisualProfilesByScope),
    hypothesisMapLayout: mergeObjectMaps(base.hypothesisMapLayout, incoming.hypothesisMapLayout),
  };
};

const openCommentsModeDb = () => new Promise((resolve, reject) => {
  try {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onblocked = () => reject(new Error('IndexedDB blocked by another tab/process.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        try { db.close(); } catch {}
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
  } catch (error) {
    reject(error);
  }
});

const runIdbRequest = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Error en operación IndexedDB'));
});

const resetCommentsModeIndexedDb = async () => {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  await new Promise((resolve) => {
    try {
      const request = window.indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
};

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), commentsBackendRequestTimeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers, signal: controller.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
      clearTimeout(timeout);
      return json;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'No se pudo conectar al backend del modo comentarios.');
};

const isIdbStructuralError = (error) => {
  // Only reset the DB for schema/version errors where the DB itself is
  // unrecoverable.  Timeouts and transient errors must NOT destroy data.
  if (!error) return false;
  const name = error?.name || '';
  const msg = String(error?.message || '');
  return (
    name === 'VersionError' ||
    name === 'InvalidStateError' ||
    msg.includes('VersionError') ||
    msg.includes('upgrade needed') ||
    msg.includes('object store was deleted')
  );
};

const readCachedCommentsModeStore = async (storageKey) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return null;
  try {
    const db = await withTimeout(openCommentsModeDb(), idbOpenTimeoutMs, 'IndexedDB open');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const value = await withTimeout(runIdbRequest(store.get(storageKey)), idbRequestTimeoutMs, 'IndexedDB read');
    db.close();
    return value || null;
  } catch (error) {
    if (isIdbStructuralError(error)) {
      console.warn('[IDB] Structural schema error — resetting database:', error?.message);
      await resetCommentsModeIndexedDb();
    } else {
      // Timeouts, blocked connections, transient errors: log but keep data intact.
      console.warn('[IDB] Transient read error (no data destroyed):', error?.message);
    }
    return null;
  }
};

const writeCachedCommentsModeStore = async (storageKey, payload) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return normalizeCommentsModeStorePayload(payload);
  const normalizedPayload = normalizeCommentsModeStorePayload(payload);
  const existing = await readCachedCommentsModeStore(storageKey);
  const mergedPayload = mergeCommentsModeStorePayloads(existing || createEmptyCommentsStore(), normalizedPayload);
  try {
    const db = await withTimeout(openCommentsModeDb(), idbOpenTimeoutMs, 'IndexedDB open');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await withTimeout(runIdbRequest(store.put(mergedPayload, storageKey)), idbRequestTimeoutMs, 'IndexedDB write');
    db.close();
  } catch (error) {
    if (isIdbStructuralError(error)) {
      console.warn('[IDB] Structural schema error on write — resetting database:', error?.message);
      await resetCommentsModeIndexedDb();
    } else {
      console.warn('[IDB] Transient write error (no data destroyed):', error?.message);
    }
  }
  return mergedPayload;
};

const broadcastCommentsModeStoreUpdate = (storageKey, payload) => {
  if (!storageKey || typeof window === 'undefined') return;
  const normalizedPayload = normalizeCommentsModeStorePayload(payload);
  try {
    if (typeof window.BroadcastChannel === 'function') {
      const channel = new window.BroadcastChannel(`${commentsModeBroadcastPrefix}${storageKey}`);
      channel.postMessage({ storageKey, payload: normalizedPayload, emitted_at: new Date().toISOString() });
      channel.close();
    }
  } catch {}

  try {
    localStorage.setItem(`${commentsModeStorageEventPrefix}${storageKey}`, JSON.stringify({
      storageKey,
      payload: normalizedPayload,
      emitted_at: new Date().toISOString(),
    }));
  } catch {}
};

export const subscribeCommentsModeStore = (storageKey, onChange) => {
  if (!storageKey || typeof window === 'undefined' || typeof onChange !== 'function') return () => {};

  let isDisposed = false;
  let channel = null;

  const notify = async (payload) => {
    if (isDisposed) return;
    const latestCached = await readCachedCommentsModeStore(storageKey);
    const mergedPayload = mergeCommentsModeStorePayloads(latestCached || createEmptyCommentsStore(), payload || {});
    onChange(mergedPayload);
  };

  const handleStorage = (event) => {
    if (event.key !== `${commentsModeStorageEventPrefix}${storageKey}` || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      notify(parsed?.payload || {});
    } catch {}
  };

  window.addEventListener('storage', handleStorage);

  try {
    if (typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(`${commentsModeBroadcastPrefix}${storageKey}`);
      channel.onmessage = (event) => {
        notify(event?.data?.payload || {});
      };
    }
  } catch {}

  return () => {
    isDisposed = true;
    window.removeEventListener('storage', handleStorage);
    if (channel) channel.close();
  };
};

export const listCommentsModeStores = async ({ projectId = '', campaignId = '' } = {}) => {
  if (!projectId || !campaignId) return [];
  const response = await requestBackend(`/api/comment-mode/states?${new URLSearchParams({ projectId, campaignId }).toString()}`, { method: 'GET' });
  return Array.isArray(response?.data?.items) ? response.data.items : [];
};

export const loadCommentsModeStore = async (storageKey) => {
  if (!storageKey) return null;
  const cached = await readCachedCommentsModeStore(storageKey);
  try {
    const response = await requestBackend(`/api/comment-mode/state?${new URLSearchParams({ storageKey }).toString()}`, { method: 'GET' });
    const payload = response?.data?.payload || null;
    if (payload) {
      const mergedPayload = mergeCommentsModeStorePayloads(cached || createEmptyCommentsStore(), payload);
      await writeCachedCommentsModeStore(storageKey, mergedPayload);
      return mergedPayload;
    }
  } catch {
    // fallback to cached state below
  }

  return cached;
};

export const saveCommentsModeStore = async (storageKey, payload) => {
  if (!storageKey) return normalizeCommentsModeStorePayload(payload);
  const mergedLocalPayload = await writeCachedCommentsModeStore(storageKey, payload);
  const response = await requestBackend('/api/comment-mode/state', {
    method: 'POST',
    body: JSON.stringify({ storageKey, payload: mergedLocalPayload }),
  });
  const mergedRemotePayload = mergeCommentsModeStorePayloads(mergedLocalPayload, response?.data?.payload || {});
  await writeCachedCommentsModeStore(storageKey, mergedRemotePayload);
  broadcastCommentsModeStoreUpdate(storageKey, mergedRemotePayload);
  return mergedRemotePayload;
};

export const updateCommentHypothesisManualState = async ({ storageKey = '', hypothesisId = '', nextState = '' } = {}) => {
  if (!storageKey || !hypothesisId) throw new Error('storageKey y hypothesisId son obligatorios.');
  const response = await requestBackend('/api/comment-mode/hypotheses/manual-state', {
    method: 'POST',
    body: JSON.stringify({ storageKey, hypothesisId, nextState }),
  });
  const payload = response?.data?.payload || null;
  if (payload) {
    const mergedPayload = await writeCachedCommentsModeStore(storageKey, payload);
    broadcastCommentsModeStoreUpdate(storageKey, mergedPayload);
  }
  return response?.data || null;
};

export const migrateLocalCommentsModeStoreToBackend = async (storageKey) => {
  const cached = await readCachedCommentsModeStore(storageKey);
  if (!cached) return null;
  await saveCommentsModeStore(storageKey, cached);
  return cached;
};

export { createEmptyCommentsStore, normalizeCommentsModeStorePayload };
