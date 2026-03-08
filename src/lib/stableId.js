export const createStableId = (prefix = 'id_') => {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${String(prefix)}${String(random).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
};
