import { HYPOTHESIS_MODES, HYPOTHESIS_STATE, buildModeStatePatch, normalizeHypothesisState, readHypothesisStateForMode } from '../../../../shared/hypothesisState.js';

const VALIDATION_STATE_VALID = HYPOTHESIS_STATE.VALIDATED;
const VALIDATION_STATE_INVALID = HYPOTHESIS_STATE.INVALIDATED;
const VALIDATION_STATE_INCONCLUSIVE = HYPOTHESIS_STATE.INCONCLUSIVE;

const MODE_COMMENTS = HYPOTHESIS_MODES.COMMENTS;
const MODE_VIDEO = HYPOTHESIS_MODES.VIDEO;
const MODE_INTERVIEWS = HYPOTHESIS_MODES.INTERVIEWS;

const normalizeValidationState = normalizeHypothesisState;
const toCommentsValidationState = (state = '') => buildModeStatePatch(MODE_COMMENTS, state).validation_status;
const toVideoValidationState = (state = '') => buildModeStatePatch(MODE_VIDEO, state).validation_status;
const toInterviewValidationState = (state = '') => buildModeStatePatch(MODE_INTERVIEWS, state).validation_result;
const getValidationStateFromNode = (mode = '', node = {}) => readHypothesisStateForMode(mode, node?.hypothesis || node?.row || {});

const normalizeId = (value = '') => String(value || '').trim();
const buildNodeKey = (mode = '', id = '') => `${String(mode || '').trim()}:${normalizeId(id)}`;
const parseNodeKey = (nodeKey = '') => {
  const [mode = '', ...rest] = String(nodeKey || '').split(':');
  return { mode, id: rest.join(':') };
};

const ensureSetMapEntry = (map, key) => {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
};

const addEquivalentEdge = (graph, leftKey, rightKey) => {
  if (!leftKey || !rightKey || leftKey === rightKey) return;
  ensureSetMapEntry(graph.equivalentAdjacency, leftKey).add(rightKey);
  ensureSetMapEntry(graph.equivalentAdjacency, rightKey).add(leftKey);
};

const addChildEdge = (graph, parentKey, childKey) => {
  if (!parentKey || !childKey || parentKey === childKey) return;
  ensureSetMapEntry(graph.childrenAdjacency, parentKey).add(childKey);
};

const createUnifiedGraph = () => ({
  nodes: new Map(),
  equivalentAdjacency: new Map(),
  childrenAdjacency: new Map(),
  modeStores: new Map(),
});

const getEquivalentClosureAcrossModes = (graph, nodeId = '', mode = '') => {
  const startKey = buildNodeKey(mode, nodeId);
  const pending = [startKey];
  const visited = new Set();

  while (pending.length) {
    const currentKey = pending.shift();
    if (!currentKey || visited.has(currentKey)) continue;
    visited.add(currentKey);

    const equivalentNeighbors = graph.equivalentAdjacency.get(currentKey) || new Set();
    equivalentNeighbors.forEach((neighborKey) => {
      if (!visited.has(neighborKey)) pending.push(neighborKey);
    });
  }

  return visited;
};

const getDescendantsAcrossUnifiedGraph = (graph, nodeKeys = []) => {
  const pending = [...new Set((nodeKeys || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const visited = new Set();

  while (pending.length) {
    const currentKey = pending.shift();
    if (!currentKey || visited.has(currentKey)) continue;
    visited.add(currentKey);

    const equivalentNeighbors = graph.equivalentAdjacency.get(currentKey) || new Set();
    equivalentNeighbors.forEach((neighborKey) => {
      if (!visited.has(neighborKey)) pending.push(neighborKey);
    });

    const childNeighbors = graph.childrenAdjacency.get(currentKey) || new Set();
    childNeighbors.forEach((childKey) => {
      if (!visited.has(childKey)) pending.push(childKey);
    });
  }

  return visited;
};

const groupAffectedIdsByMode = (nodeKeys = []) => {
  const grouped = {
    [MODE_COMMENTS]: new Set(),
    [MODE_VIDEO]: new Set(),
    [MODE_INTERVIEWS]: new Set(),
  };
  (nodeKeys || []).forEach((nodeKey) => {
    const { mode, id } = parseNodeKey(nodeKey);
    if (!grouped[mode] || !id) return;
    grouped[mode].add(id);
  });
  return grouped;
};

const shouldSyncVideoStateTransition = ({ previousState = '', nextState = '' } = {}) => {
  const normalizedPrevious = normalizeValidationState(previousState);
  const normalizedNext = normalizeValidationState(nextState);
  if (normalizedNext === VALIDATION_STATE_INCONCLUSIVE) return false;
  return normalizedPrevious !== normalizedNext;
};

export {
  VALIDATION_STATE_VALID,
  VALIDATION_STATE_INVALID,
  VALIDATION_STATE_INCONCLUSIVE,
  MODE_COMMENTS,
  MODE_VIDEO,
  MODE_INTERVIEWS,
  normalizeValidationState,
  toCommentsValidationState,
  toVideoValidationState,
  toInterviewValidationState,
  getValidationStateFromNode,
  normalizeId,
  buildNodeKey,
  parseNodeKey,
  addEquivalentEdge,
  addChildEdge,
  createUnifiedGraph,
  getEquivalentClosureAcrossModes,
  getDescendantsAcrossUnifiedGraph,
  groupAffectedIdsByMode,
  shouldSyncVideoStateTransition,
};
