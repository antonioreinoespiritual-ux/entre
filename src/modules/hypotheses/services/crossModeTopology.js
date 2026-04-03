import { buildNodeKey, normalizeId, MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS } from './crossModeGraphCore.js';

const TOPOLOGY_RECORD_FIELD = 'hypothesisTopology';
const RELATION_TYPE_PARENT_CHILD = 'parent_child';

const toArray = (value) => (Array.isArray(value) ? value : []);

const createTopologyNodeRef = (mode = '', hypothesisId = '', extra = {}) => {
  const normalizedMode = String(mode || '').trim();
  const normalizedHypothesisId = normalizeId(hypothesisId);
  if (!normalizedMode || !normalizedHypothesisId) return null;
  return {
    mode: normalizedMode,
    hypothesisId: normalizedHypothesisId,
    nodeKey: buildNodeKey(normalizedMode, normalizedHypothesisId),
    ...extra,
  };
};

const normalizeTopologyRecord = (record = {}) => {
  const parentNode = createTopologyNodeRef(record?.parent?.mode || record?.parent_mode, record?.parent?.hypothesis_id || record?.parent?.hypothesisId || record?.parent_hypothesis_id, {
    storageKey: String(record?.parent?.storage_key || record?.parent?.storageKey || record?.parent_storage_key || '').trim() || undefined,
  });
  const childNode = createTopologyNodeRef(record?.child?.mode || record?.child_mode, record?.child?.hypothesis_id || record?.child?.hypothesisId || record?.child_hypothesis_id, {
    storageKey: String(record?.child?.storage_key || record?.child?.storageKey || record?.child_storage_key || '').trim() || undefined,
  });
  if (!parentNode || !childNode) return null;
  return {
    relation_type: RELATION_TYPE_PARENT_CHILD,
    parent: {
      mode: parentNode.mode,
      hypothesis_id: parentNode.hypothesisId,
      storage_key: parentNode.storageKey,
    },
    child: {
      mode: childNode.mode,
      hypothesis_id: childNode.hypothesisId,
      storage_key: childNode.storageKey,
    },
    source: String(record?.source || 'explicit').trim() || 'explicit',
  };
};

const createCrossModeTopologyRegistry = ({ explicitTopologyRecords = [], legacyTopologyRecords = [] } = {}) => {
  const relationByChildKey = new Map();
  const childrenByParentKey = new Map();
  const normalizedRecords = [];

  [...toArray(explicitTopologyRecords), ...toArray(legacyTopologyRecords)]
    .map((record) => normalizeTopologyRecord(record))
    .filter(Boolean)
    .forEach((record) => {
      const childKey = buildNodeKey(record.child.mode, record.child.hypothesis_id);
      const parentKey = buildNodeKey(record.parent.mode, record.parent.hypothesis_id);
      if (!relationByChildKey.has(childKey) || record.source === 'explicit') {
        relationByChildKey.set(childKey, record);
      }
      if (!childrenByParentKey.has(parentKey)) childrenByParentKey.set(parentKey, new Map());
      childrenByParentKey.get(parentKey).set(childKey, record);
    });

  relationByChildKey.forEach((record) => {
    normalizedRecords.push(record);
  });

  const parentByNodeKey = new Map();
  const childrenByNodeKey = new Map();
  normalizedRecords.forEach((record) => {
    const childKey = buildNodeKey(record.child.mode, record.child.hypothesis_id);
    const parentKey = buildNodeKey(record.parent.mode, record.parent.hypothesis_id);
    parentByNodeKey.set(childKey, createTopologyNodeRef(record.parent.mode, record.parent.hypothesis_id, { storageKey: record.parent.storage_key }));
    if (!childrenByNodeKey.has(parentKey)) childrenByNodeKey.set(parentKey, []);
    childrenByNodeKey.get(parentKey).push(createTopologyNodeRef(record.child.mode, record.child.hypothesis_id, { storageKey: record.child.storage_key }));
  });

  return {
    records: normalizedRecords.sort((left, right) => {
      const leftKey = `${left.parent.mode}:${left.parent.hypothesis_id}:${left.child.mode}:${left.child.hypothesis_id}`;
      const rightKey = `${right.parent.mode}:${right.parent.hypothesis_id}:${right.child.mode}:${right.child.hypothesis_id}`;
      return leftKey.localeCompare(rightKey);
    }),
    parentByNodeKey,
    childrenByNodeKey,
  };
};

const resolveStructuralParent = (registry, { mode = '', hypothesisId = '' } = {}) => registry?.parentByNodeKey?.get(buildNodeKey(mode, hypothesisId)) || null;

const listStructuralChildren = (registry, { mode = '', hypothesisId = '' } = {}) => registry?.childrenByNodeKey?.get(buildNodeKey(mode, hypothesisId)) || [];

const listStructuralDescendants = (registry, { mode = '', hypothesisId = '' } = {}) => {
  const startKey = buildNodeKey(mode, hypothesisId);
  const pending = [...(registry?.childrenByNodeKey?.get(startKey) || [])];
  const descendants = [];
  const visited = new Set();

  while (pending.length) {
    const currentNode = pending.shift();
    if (!currentNode?.nodeKey || visited.has(currentNode.nodeKey)) continue;
    visited.add(currentNode.nodeKey);
    descendants.push(currentNode);
    (registry?.childrenByNodeKey?.get(currentNode.nodeKey) || []).forEach((childNode) => pending.push(childNode));
  }

  return descendants;
};

export {
  TOPOLOGY_RECORD_FIELD,
  RELATION_TYPE_PARENT_CHILD,
  createTopologyNodeRef,
  normalizeTopologyRecord,
  createCrossModeTopologyRegistry,
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
};
