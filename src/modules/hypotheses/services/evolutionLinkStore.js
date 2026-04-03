import { listCommentsModeStores, loadCommentsModeStore, migrateLocalCommentsModeStoreToBackend, saveCommentsModeStore } from '../../comments/services/commentsModeStore.js';

export const buildCrossModeSyncStorageKey = (projectId = '', campaignId = '') => `comments-mode:${projectId}:${campaignId}`;
const buildStoragePrefix = (projectId = '', campaignId = '') => `${buildCrossModeSyncStorageKey(projectId, campaignId)}`;

const readLocalStorageStore = (storageKey = '') => {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeLocalStorageStore = (storageKey = '', payload = null) => {
  if (!storageKey || typeof window === 'undefined' || !payload) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // noop
  }
};

const listCandidateStorageKeys = (projectId = '', campaignId = '') => {
  const prefix = buildStoragePrefix(projectId, campaignId);
  if (!prefix || typeof window === 'undefined') return [];
  const keys = new Set([prefix]);
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.add(key);
    }
  } catch {
    // noop
  }
  return [...keys];
};

export const listCrossModeSyncStores = async ({ projectId = '', campaignId = '' } = {}) => {
  if (!projectId || !campaignId) return [];

  const storesByKey = new Map();
  try {
    const backendStores = await listCommentsModeStores({ projectId, campaignId });
    backendStores.forEach((entry) => {
      const storageKey = String(entry?.storage_key || entry?.storageKey || '').trim();
      const store = entry?.payload || entry?.store || null;
      if (!storageKey || !store || typeof store !== 'object') return;
      storesByKey.set(storageKey, { storageKey, store });
    });
  } catch {
    // fallback to local discovery below
  }

  const storageKeys = listCandidateStorageKeys(projectId, campaignId);
  for (const storageKey of storageKeys) {
    if (storesByKey.has(storageKey)) continue;
    const store = await loadCrossModeSyncStoreByKey(storageKey);
    if (!store || typeof store !== 'object') continue;
    storesByKey.set(storageKey, { storageKey, store });
  }

  return [...storesByKey.values()];
};

export const loadCrossModeSyncStoreByKey = async (storageKey = '') => {
  try {
    const backendValue = await loadCommentsModeStore(storageKey);
    if (backendValue && typeof backendValue === 'object') return backendValue;
  } catch {
    // fallback below
  }

  const localValue = readLocalStorageStore(storageKey);
  if (localValue && typeof localValue === 'object') {
    try {
      await migrateLocalCommentsModeStoreToBackend(storageKey);
    } catch {
      // noop
    }
    return localValue;
  }

  return null;
};

export const persistCrossModeSyncStoreByKey = async (storageKey = '', payload = null) => {
  if (!storageKey || !payload || typeof payload !== 'object') return;
  writeLocalStorageStore(storageKey, payload);
  try {
    await saveCommentsModeStore(storageKey, payload);
  } catch {
    // noop
  }
};

export const listEvolutionStores = listCrossModeSyncStores;
export const loadEvolutionStoreByKey = loadCrossModeSyncStoreByKey;
export const persistEvolutionStoreByKey = persistCrossModeSyncStoreByKey;

export const listEvolutionLinksByDestination = async ({ projectId = '', campaignId = '', destinationMode = '', destinationHypothesisId = '' } = {}) => {
  const normalizedMode = String(destinationMode || '').trim();
  const normalizedDestinationId = String(destinationHypothesisId || '').trim();
  if (!projectId || !campaignId || !normalizedMode || !normalizedDestinationId) return [];

  const matches = [];
  const stores = await listCrossModeSyncStores({ projectId, campaignId });
  for (const { storageKey, store } of stores) {
    const links = Array.isArray(store?.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks : [];
    links.forEach((link, index) => {
      if (link?.deleted_at) return;
      if (String(link?.destination_mode || '').trim() !== normalizedMode) return;
      if (String(link?.destination_hypothesis_id || '').trim() !== normalizedDestinationId) return;
      matches.push({ storageKey, store, index, link });
    });
  }
  return matches;
};

export const markHypothesisEvolutionLinksDeleted = async ({ projectId = '', campaignId = '', destinationMode = '', destinationHypothesisIds = [], deletionContext = {} } = {}) => {
  const normalizedMode = String(destinationMode || '').trim();
  const targetIds = new Set((Array.isArray(destinationHypothesisIds) ? destinationHypothesisIds : []).map((value) => String(value || '').trim()).filter(Boolean));
  if (!projectId || !campaignId || !normalizedMode || !targetIds.size) return [];

  const stores = await listCrossModeSyncStores({ projectId, campaignId });
  const updatedLinks = [];
  for (const { storageKey, store } of stores) {
    const links = Array.isArray(store.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks : [];
    let touched = false;
    const nextLinks = links.map((link) => {
      const destinationId = String(link?.destination_hypothesis_id || '').trim();
      if (String(link?.destination_mode || '').trim() !== normalizedMode) return link;
      if (!targetIds.has(destinationId)) return link;
      touched = true;
      const nextLink = {
        ...link,
        deleted_at: new Date().toISOString(),
        deletion_context: {
          ...link?.deletion_context,
          ...deletionContext,
        },
      };
      updatedLinks.push(nextLink);
      return nextLink;
    });
    if (!touched) continue;
    await persistCrossModeSyncStoreByKey(storageKey, { ...store, hypothesisEvolutionLinks: nextLinks });
  }
  return updatedLinks;
};

export const listActiveEvolutionLinksForDestinationMode = async ({ projectId = '', campaignId = '', destinationMode = '' } = {}) => {
  const normalizedMode = String(destinationMode || '').trim();
  if (!projectId || !campaignId || !normalizedMode) return [];

  const matches = [];
  const stores = await listCrossModeSyncStores({ projectId, campaignId });
  for (const { storageKey, store } of stores) {
    const links = Array.isArray(store?.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks : [];
    links.forEach((link, index) => {
      if (link?.deleted_at) return;
      if (String(link?.destination_mode || '').trim() !== normalizedMode) return;
      matches.push({ storageKey, store, index, link });
    });
  }
  return matches;
};
