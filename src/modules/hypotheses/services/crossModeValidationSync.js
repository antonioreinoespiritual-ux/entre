import { supabase } from '@/lib/customSupabaseClient';
import { listEvolutionStores, persistEvolutionStoreByKey } from '@/modules/comments/services/hypothesisEvolutionService';
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

const extractJsonMetadataBlock = (value = '', tag = '') => {
  const match = String(value || '').match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  if (!match) return {};
  try {
    return JSON.parse(match[1]) || {};
  } catch {
    return {};
  }
};

const extractVideoParentHypothesisId = (hypothesis = {}) => normalizeId(extractJsonMetadataBlock(hypothesis?.contexto_cualitativo || '', 'hierarchy_meta')?.parent_hypothesis_id);
const extractInterviewParentHypothesisId = (hypothesis = {}) => normalizeId(extractJsonMetadataBlock(hypothesis?.observations || '', 'interview_hierarchy')?.parent_hypothesis_id);

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
  commentsStores: new Map(),
});

const registerCommentNode = (graph, storageKey, hypothesis) => {
  const id = normalizeId(hypothesis?.id);
  if (!storageKey || !id) return;
  const nodeKey = buildNodeKey(MODE_COMMENTS, id);
  graph.nodes.set(nodeKey, { mode: MODE_COMMENTS, id, storageKey, hypothesis, validationState: getValidationStateFromNode(MODE_COMMENTS, { hypothesis }) });
  const storeEntry = graph.commentsStores.get(storageKey) || { hypotheses: new Map(), store: null };
  storeEntry.hypotheses.set(id, hypothesis);
  graph.commentsStores.set(storageKey, storeEntry);
};

const registerModeNode = (graph, mode, row) => {
  const id = normalizeId(row?.id);
  if (!id) return;
  graph.nodes.set(buildNodeKey(mode, id), { mode, id, row, validationState: getValidationStateFromNode(mode, { row }) });
};

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

const loadUnifiedCrossModeGraph = async ({ projectId = '', campaignId = '' } = {}) => {
  const graph = createUnifiedGraph();
  const evolutionStores = await listEvolutionStores({ projectId, campaignId });

  evolutionStores.forEach(({ storageKey, store }) => {
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    graph.commentsStores.set(storageKey, { hypotheses: new Map(), store });
    hypotheses.forEach((hypothesis) => registerCommentNode(graph, storageKey, hypothesis));
  });

  const { data: videoRows, error: videoError } = await supabase
    .from('hypotheses')
    .select('id, campaign_id, contexto_cualitativo, validation_status')
    .eq('campaign_id', campaignId);
  if (videoError) throw videoError;
  (videoRows || []).forEach((row) => registerModeNode(graph, MODE_VIDEO, row));

  const { data: interviewRows, error: interviewError } = await supabase
    .from('interview_hypotheses')
    .select('id, campaign_id, observations, validation_result')
    .eq('campaign_id', campaignId);
  if (interviewError) throw interviewError;
  (interviewRows || []).forEach((row) => registerModeNode(graph, MODE_INTERVIEWS, row));

  evolutionStores.forEach(({ storageKey, store }) => {
    const links = Array.isArray(store?.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks.filter((link) => !link?.deleted_at) : [];
    const commentStoreEntry = graph.commentsStores.get(storageKey);
    links.forEach((link) => {
      const sourceId = normalizeId(link?.source_hypothesis_id);
      const destinationMode = normalizeId(link?.destination_mode);
      const destinationId = normalizeId(link?.destination_hypothesis_id);
      if (!sourceId || !destinationMode || !destinationId) return;
      const sourceKey = buildNodeKey(MODE_COMMENTS, sourceId);
      const destinationKey = buildNodeKey(destinationMode, destinationId);
      if (!graph.nodes.has(sourceKey) && commentStoreEntry?.hypotheses?.has(sourceId)) {
        registerCommentNode(graph, storageKey, commentStoreEntry.hypotheses.get(sourceId));
      }
      addEquivalentEdge(graph, sourceKey, destinationKey);
    });
  });

  graph.commentsStores.forEach(({ hypotheses }) => {
    hypotheses.forEach((hypothesis, hypothesisId) => {
      const parentId = normalizeId(hypothesis?.parent_hypothesis_id);
      if (!parentId) return;
      addChildEdge(graph, buildNodeKey(MODE_COMMENTS, parentId), buildNodeKey(MODE_COMMENTS, hypothesisId));
    });
  });

  (videoRows || []).forEach((row) => {
    const parentId = extractVideoParentHypothesisId(row);
    if (!parentId) return;
    addChildEdge(graph, buildNodeKey(MODE_VIDEO, parentId), buildNodeKey(MODE_VIDEO, row.id));
  });

  (interviewRows || []).forEach((row) => {
    const parentId = extractInterviewParentHypothesisId(row);
    if (!parentId) return;
    addChildEdge(graph, buildNodeKey(MODE_INTERVIEWS, parentId), buildNodeKey(MODE_INTERVIEWS, row.id));
  });

  return graph;
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

const COMMENT_STATE_PRIORITY = {
  [VALIDATION_STATE_INVALID]: 3,
  [VALIDATION_STATE_VALID]: 2,
  [VALIDATION_STATE_INCONCLUSIVE]: 1,
};

const assignCommentStateWithPriority = (stateByCommentId, commentId = '', nextState = '') => {
  const normalizedCommentId = normalizeId(commentId);
  if (!normalizedCommentId) return;
  const normalizedNextState = normalizeValidationState(nextState);
  const currentState = stateByCommentId.get(normalizedCommentId) || VALIDATION_STATE_INCONCLUSIVE;
  if ((COMMENT_STATE_PRIORITY[normalizedNextState] || 0) >= (COMMENT_STATE_PRIORITY[currentState] || 0)) {
    stateByCommentId.set(normalizedCommentId, normalizedNextState);
  }
};

const buildCommentsStateRebuildPlanFromVideoGraph = (graph) => {
  const stateByCommentId = new Map();
  graph.commentsStores.forEach(({ hypotheses }) => {
    hypotheses.forEach((_, hypothesisId) => {
      stateByCommentId.set(normalizeId(hypothesisId), VALIDATION_STATE_INCONCLUSIVE);
    });
  });

  graph.nodes.forEach((node) => {
    if (node?.mode !== MODE_VIDEO) return;
    const videoState = normalizeValidationState(node?.validationState);
    if (videoState === VALIDATION_STATE_INCONCLUSIVE) return;

    const rootSet = getEquivalentClosureAcrossModes(graph, node.id, MODE_VIDEO);
    const affectedNodeKeys = videoState === VALIDATION_STATE_INVALID
      ? getDescendantsAcrossUnifiedGraph(graph, [...rootSet])
      : rootSet;
    const affectedIdsByMode = groupAffectedIdsByMode([...affectedNodeKeys]);
    [...affectedIdsByMode[MODE_COMMENTS]].forEach((commentId) => {
      assignCommentStateWithPriority(stateByCommentId, commentId, videoState);
    });
  });

  return stateByCommentId;
};

const rebuildCommentsStatusFromVideo = async ({ graph }) => {
  const timestamp = new Date().toISOString();
  const targetStates = buildCommentsStateRebuildPlanFromVideoGraph(graph);
  const updatedIds = [];

  for (const [storageKey, entry] of graph.commentsStores.entries()) {
    const store = entry?.store;
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    if (!storageKey || !hypotheses.length) continue;

    let touched = false;
    const nextHypotheses = hypotheses.map((item) => {
      const itemId = normalizeId(item?.id);
      const nextState = targetStates.get(itemId) || VALIDATION_STATE_INCONCLUSIVE;
      const nextItem = {
        ...item,
        validation_status: toCommentsValidationState(nextState),
      };
      delete nextItem.invalidated_at;
      delete nextItem.invalidated_from_hypothesis_id;

      const currentState = normalizeValidationState(item?.validation_status);
      if (currentState !== nextState) {
        touched = true;
        updatedIds.push(itemId);
        nextItem.updated_at = timestamp;
      }
      return nextItem;
    });

    if (!touched) continue;
    const nextStore = { ...store, hypotheses: nextHypotheses };
    graph.commentsStores.set(storageKey, { ...entry, store: nextStore });
    await persistEvolutionStoreByKey(storageKey, nextStore);
  }

  return [...new Set(updatedIds)];
};

const updateVideoStatuses = async ({ affectedVideoIds = [], nextState = '' }) => {
  const targetIds = [...new Set((affectedVideoIds || []).map(normalizeId).filter(Boolean))];
  if (!targetIds.length) return [];
  const timestamp = new Date().toISOString();
  await Promise.all(targetIds.map(async (id) => {
    const { error } = await supabase
      .from('hypotheses')
      .update(buildModeStatePatch(MODE_VIDEO, nextState, { updated_at: timestamp }))
      .eq('id', id);
    if (error) throw error;
  }));
  return targetIds;
};

const updateInterviewStatuses = async ({ affectedInterviewIds = [], nextState = '' }) => {
  const targetIds = [...new Set((affectedInterviewIds || []).map(normalizeId).filter(Boolean))];
  if (!targetIds.length) return [];
  const timestamp = new Date().toISOString();
  await Promise.all(targetIds.map(async (id) => {
    const { error } = await supabase
      .from('interview_hypotheses')
      .update(buildModeStatePatch(MODE_INTERVIEWS, nextState, { updated_at: timestamp }))
      .eq('id', id);
    if (error) throw error;
  }));
  return targetIds;
};

export const syncVideoHypothesisStateTransition = async ({
  projectId = '',
  campaignId = '',
  videoHypothesisId = '',
  previousVideoStatus = '',
  nextVideoStatus = '',
} = {}) => {
  if (!shouldSyncVideoStateTransition({ previousState: previousVideoStatus, nextState: nextVideoStatus })) {
    return { synced: false, skipped: true, reason: 'no_state_change' };
  }
  return syncVideoHypothesisValidationAcrossModes({
    projectId,
    campaignId,
    videoHypothesisId,
    nextVideoStatus,
  });
};

export const syncVideoHypothesisValidationAcrossModes = async ({ projectId = '', campaignId = '', videoHypothesisId = '', nextVideoStatus = '' } = {}) => {
  const normalizedVideoId = normalizeId(videoHypothesisId);
  const nextState = normalizeValidationState(nextVideoStatus);
  if (!projectId || !campaignId || !normalizedVideoId) return { synced: false };

  if (nextState === VALIDATION_STATE_INCONCLUSIVE) return { synced: false, skipped: true, reason: 'inconclusive_target_state' };

  const graph = await loadUnifiedCrossModeGraph({ projectId, campaignId });
  const rootSet = getEquivalentClosureAcrossModes(graph, normalizedVideoId, MODE_VIDEO);
  const affectedNodeKeys = nextState === VALIDATION_STATE_INVALID
    ? getDescendantsAcrossUnifiedGraph(graph, [...rootSet])
    : rootSet;

  const affectedIdsByMode = groupAffectedIdsByMode([...affectedNodeKeys]);
  const updatedVideoIds = await updateVideoStatuses({
    affectedVideoIds: [...affectedIdsByMode[MODE_VIDEO]],
    nextState,
  });
  [...affectedIdsByMode[MODE_VIDEO]].forEach((videoId) => {
    const nodeKey = buildNodeKey(MODE_VIDEO, videoId);
    const currentNode = graph.nodes.get(nodeKey);
    if (!currentNode) return;
    graph.nodes.set(nodeKey, { ...currentNode, validationState: nextState });
  });

  const updatedCommentIds = await rebuildCommentsStatusFromVideo({ graph });
  const updatedInterviewIds = await updateInterviewStatuses({
    affectedInterviewIds: [...affectedIdsByMode[MODE_INTERVIEWS]],
    nextState,
  });

  return {
    synced: updatedCommentIds.length > 0 || updatedVideoIds.length > 0 || updatedInterviewIds.length > 0,
    mode: nextState === VALIDATION_STATE_VALID ? 'valid' : 'invalid',
    state: nextState,
    updatedCommentIds,
    updatedVideoIds,
    updatedInterviewIds,
  };
};

export const __crossModeValidationSyncTestUtils = {
  buildNodeKey,
  parseNodeKey,
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
  getEquivalentClosureAcrossModes,
  getDescendantsAcrossUnifiedGraph,
  groupAffectedIdsByMode,
  normalizeValidationState,
  toCommentsValidationState,
  toVideoValidationState,
  toInterviewValidationState,
  getValidationStateFromNode,
  shouldSyncVideoStateTransition,
  buildCommentsStateRebuildPlanFromVideoGraph,
};
