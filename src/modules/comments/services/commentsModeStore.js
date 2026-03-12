const DB_NAME = 'entre-comments-mode-db';
const STORE_NAME = 'states';
const DB_VERSION = 1;

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

export const loadCommentsModeStore = async (storageKey) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return null;
  const db = await openCommentsModeDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const value = await runIdbRequest(store.get(storageKey));
  db.close();
  return value || null;
};

export const saveCommentsModeStore = async (storageKey, payload) => {
  if (!storageKey || typeof window === 'undefined' || !window.indexedDB) return;
  const db = await openCommentsModeDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await runIdbRequest(store.put(payload, storageKey));
  db.close();
};

