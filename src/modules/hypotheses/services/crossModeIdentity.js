import { buildNodeKey, normalizeId, MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS } from './crossModeGraphCore.js';

const IDENTITY_RECORD_FIELD = 'hypothesisCrossModeIdentities';
const IDENTITY_PREFIX = 'hypothesis_lineage_';
const MODE_ORDER = [MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS];

const toArray = (value) => (Array.isArray(value) ? value : []);

const createIdentityNodeRef = (mode = '', hypothesisId = '', extra = {}) => {
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

const normalizeIdentityNodeRecord = (node = {}) => createIdentityNodeRef(node?.mode, node?.hypothesis_id || node?.hypothesisId, {
  storageKey: String(node?.storage_key || node?.storageKey || '').trim() || undefined,
  origin: Boolean(node?.origin),
});

const createUnionFind = () => {
  const parents = new Map();

  const add = (value) => {
    if (!value || parents.has(value)) return;
    parents.set(value, value);
  };

  const find = (value) => {
    if (!parents.has(value)) add(value);
    const parent = parents.get(value);
    if (parent === value) return value;
    const root = find(parent);
    parents.set(value, root);
    return root;
  };

  const union = (left, right) => {
    if (!left || !right) return;
    add(left);
    add(right);
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
  };

  return { parents, add, find, union };
};

const createDeterministicIdentityId = (nodeKeys = []) => {
  const fingerprint = [...new Set(toArray(nodeKeys).map((value) => String(value || '').trim()).filter(Boolean))].sort().join('|');
  let hash = 5381;
  for (const character of fingerprint) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  }
  return `${IDENTITY_PREFIX}${Math.abs(hash >>> 0).toString(36)}`;
};

const sortIdentityNodes = (nodes = []) => [...nodes].sort((left, right) => {
  const leftModeIndex = MODE_ORDER.indexOf(left.mode);
  const rightModeIndex = MODE_ORDER.indexOf(right.mode);
  if (leftModeIndex !== rightModeIndex) return leftModeIndex - rightModeIndex;
  return left.hypothesisId.localeCompare(right.hypothesisId);
});

const normalizeIdentityRecord = (record = {}) => {
  const nodes = sortIdentityNodes(toArray(record?.nodes).map((node) => normalizeIdentityNodeRecord(node)).filter(Boolean));
  const originNode = normalizeIdentityNodeRecord(record?.origin_node || record?.originNode || {});
  const identityId = String(record?.identity_id || record?.identityId || '').trim() || createDeterministicIdentityId(nodes.map((node) => node.nodeKey));
  return {
    identity_id: identityId,
    nodes: nodes.map((node) => ({
      mode: node.mode,
      hypothesis_id: node.hypothesisId,
      storage_key: node.storageKey,
      origin: Boolean(originNode && originNode.nodeKey === node.nodeKey),
    })),
    origin_node: originNode ? {
      mode: originNode.mode,
      hypothesis_id: originNode.hypothesisId,
      storage_key: originNode.storageKey,
    } : (nodes[0] ? {
      mode: nodes[0].mode,
      hypothesis_id: nodes[0].hypothesisId,
      storage_key: nodes[0].storageKey,
    } : null),
  };
};

const createCrossModeIdentityRegistry = ({ explicitIdentityRecords = [], legacyLinks = [], modeNodeRefs = {} } = {}) => {
  const unionFind = createUnionFind();
  const nodeRefsByKey = new Map();
  const explicitIdentityIdByNodeKey = new Map();
  const originNodeByNodeKey = new Map();

  Object.values(modeNodeRefs || {}).forEach((nodeRefs) => {
    toArray(nodeRefs).forEach((node) => {
      const normalizedNode = createIdentityNodeRef(node?.mode, node?.hypothesisId || node?.id, { storageKey: node?.storageKey });
      if (!normalizedNode) return;
      unionFind.add(normalizedNode.nodeKey);
      nodeRefsByKey.set(normalizedNode.nodeKey, normalizedNode);
    });
  });

  toArray(explicitIdentityRecords).forEach((record) => {
    const normalizedRecord = normalizeIdentityRecord(record);
    const normalizedNodes = normalizedRecord.nodes.map((node) => normalizeIdentityNodeRecord(node)).filter(Boolean);
    if (!normalizedNodes.length) return;
    normalizedNodes.forEach((node) => {
      unionFind.add(node.nodeKey);
      if (!nodeRefsByKey.has(node.nodeKey)) nodeRefsByKey.set(node.nodeKey, node);
      explicitIdentityIdByNodeKey.set(node.nodeKey, normalizedRecord.identity_id);
    });
    const [firstNode, ...restNodes] = normalizedNodes;
    restNodes.forEach((node) => unionFind.union(firstNode.nodeKey, node.nodeKey));
    const originNode = normalizeIdentityNodeRecord(normalizedRecord.origin_node || {});
    if (originNode?.nodeKey) originNodeByNodeKey.set(originNode.nodeKey, originNode);
  });

  toArray(legacyLinks).forEach((link) => {
    const sourceNode = createIdentityNodeRef(MODE_COMMENTS, link?.source_hypothesis_id, { storageKey: link?.storage_key || link?.storageKey });
    const destinationNode = createIdentityNodeRef(link?.destination_mode, link?.destination_hypothesis_id, { storageKey: link?.storage_key || link?.storageKey });
    if (!sourceNode || !destinationNode) return;
    unionFind.add(sourceNode.nodeKey);
    unionFind.add(destinationNode.nodeKey);
    if (!nodeRefsByKey.has(sourceNode.nodeKey)) nodeRefsByKey.set(sourceNode.nodeKey, sourceNode);
    if (!nodeRefsByKey.has(destinationNode.nodeKey)) nodeRefsByKey.set(destinationNode.nodeKey, destinationNode);
    unionFind.union(sourceNode.nodeKey, destinationNode.nodeKey);
    if (!originNodeByNodeKey.size || !originNodeByNodeKey.has(sourceNode.nodeKey)) {
      originNodeByNodeKey.set(sourceNode.nodeKey, { ...sourceNode, origin: true });
    }
  });

  const groups = new Map();
  [...unionFind.parents.keys()].forEach((nodeKey) => {
    const rootKey = unionFind.find(nodeKey);
    if (!groups.has(rootKey)) groups.set(rootKey, []);
    const nodeRef = nodeRefsByKey.get(nodeKey);
    if (nodeRef) groups.get(rootKey).push(nodeRef);
  });

  const identities = new Map();
  const nodeToIdentity = new Map();

  groups.forEach((groupNodes) => {
    const normalizedNodes = sortIdentityNodes(groupNodes.map((node) => createIdentityNodeRef(node.mode, node.hypothesisId, { storageKey: node.storageKey })).filter(Boolean));
    if (!normalizedNodes.length) return;

    const explicitIdentityId = normalizedNodes
      .map((node) => explicitIdentityIdByNodeKey.get(node.nodeKey))
      .find(Boolean);
    const originNode = normalizedNodes.find((node) => originNodeByNodeKey.has(node.nodeKey))
      || normalizedNodes.find((node) => node.mode === MODE_COMMENTS)
      || normalizedNodes[0];
    const identityId = explicitIdentityId || createDeterministicIdentityId(normalizedNodes.map((node) => node.nodeKey));

    const nodesByMode = {
      [MODE_COMMENTS]: [],
      [MODE_VIDEO]: [],
      [MODE_INTERVIEWS]: [],
    };
    normalizedNodes.forEach((node) => {
      if (!nodesByMode[node.mode]) nodesByMode[node.mode] = [];
      nodesByMode[node.mode].push(node);
      nodeToIdentity.set(node.nodeKey, identityId);
    });

    identities.set(identityId, {
      identityId,
      originNode,
      nodes: normalizedNodes,
      nodesByMode,
    });
  });

  const records = [...identities.values()].map((identity) => normalizeIdentityRecord({
    identity_id: identity.identityId,
    nodes: identity.nodes,
    origin_node: identity.originNode,
  }));

  return {
    identities,
    nodeToIdentity,
    records,
  };
};

const resolveConceptualHypothesisIdentity = (registry, { mode = '', hypothesisId = '' } = {}) => {
  const nodeKey = buildNodeKey(mode, hypothesisId);
  const identityId = registry?.nodeToIdentity?.get(nodeKey);
  return identityId ? registry.identities.get(identityId) || null : null;
};

const listIdentityNodes = (registry, identityId = '') => registry?.identities?.get(String(identityId || '').trim())?.nodes || [];

const areHypothesesConceptuallyEquivalent = (registry, left = {}, right = {}) => {
  const leftIdentity = resolveConceptualHypothesisIdentity(registry, left);
  const rightIdentity = resolveConceptualHypothesisIdentity(registry, right);
  return Boolean(leftIdentity?.identityId && leftIdentity.identityId === rightIdentity?.identityId);
};

export {
  IDENTITY_RECORD_FIELD,
  createIdentityNodeRef,
  normalizeIdentityRecord,
  createCrossModeIdentityRegistry,
  resolveConceptualHypothesisIdentity,
  listIdentityNodes,
  areHypothesesConceptuallyEquivalent,
};
