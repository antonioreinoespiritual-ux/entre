import { supabase } from '@/lib/customSupabaseClient';
import { listEvolutionStores, persistEvolutionStoreByKey } from '@/modules/comments/services/hypothesisEvolutionService';

const COMMENT_VALID = 'validada';
const COMMENT_INVALID = 'invalidada';
const VIDEO_VALID = 'Validada';
const VIDEO_INVALID = 'No validada';
const INTERVIEW_VALID = 'validada';
const INTERVIEW_INVALID = 'invalidada';

const MODE_COMMENTS = 'comments';
const MODE_VIDEO = 'video';
const MODE_INTERVIEWS = 'interviews';

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
  graph.nodes.set(nodeKey, { mode: MODE_COMMENTS, id, storageKey, hypothesis });
  const storeEntry = graph.commentsStores.get(storageKey) || { hypotheses: new Map(), store: null };
  storeEntry.hypotheses.set(id, hypothesis);
  graph.commentsStores.set(storageKey, storeEntry);
};

const registerModeNode = (graph, mode, row) => {
  const id = normalizeId(row?.id);
  if (!id) return;
  graph.nodes.set(buildNodeKey(mode, id), { mode, id, row });
};

const getEquivalentNodesAcrossModes = (graph, nodeId = '', mode = '') => {
  const startKey = buildNodeKey(mode, nodeId);
  const results = new Set([startKey]);
  const directNeighbors = graph.equivalentAdjacency.get(startKey) || new Set();
  directNeighbors.forEach((neighborKey) => results.add(neighborKey));
  return results;
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
    .select('id, campaign_id, contexto_cualitativo')
    .eq('campaign_id', campaignId);
  if (videoError) throw videoError;
  (videoRows || []).forEach((row) => registerModeNode(graph, MODE_VIDEO, row));

  const { data: interviewRows, error: interviewError } = await supabase
    .from('interview_hypotheses')
    .select('id, campaign_id, observations')
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

const updateCommentsStatus = async ({ graph, affectedCommentIds = [], mode, originHypothesisId = '' }) => {
  const targetIds = new Set((affectedCommentIds || []).map(normalizeId).filter(Boolean));
  if (!targetIds.size) return [];

  const timestamp = new Date().toISOString();
  const normalizedOriginId = normalizeId(originHypothesisId);
  const updatedIds = [];

  for (const [storageKey, entry] of graph.commentsStores.entries()) {
    const store = entry?.store;
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    if (!storageKey || !hypotheses.length) continue;

    let touched = false;
    const nextHypotheses = hypotheses.map((item) => {
      const itemId = normalizeId(item?.id);
      if (!targetIds.has(itemId)) return item;
      touched = true;
      updatedIds.push(itemId);
      if (mode === 'valid') {
        const nextItem = {
          ...item,
          validation_status: COMMENT_VALID,
          updated_at: timestamp,
        };
        delete nextItem.invalidated_at;
        delete nextItem.invalidated_from_hypothesis_id;
        return nextItem;
      }
      return {
        ...item,
        validation_status: COMMENT_INVALID,
        updated_at: timestamp,
        invalidated_at: timestamp,
        invalidated_from_hypothesis_id: normalizedOriginId || itemId,
      };
    });

    if (!touched) continue;
    const nextStore = { ...store, hypotheses: nextHypotheses };
    graph.commentsStores.set(storageKey, { ...entry, store: nextStore });
    await persistEvolutionStoreByKey(storageKey, nextStore);
  }

  return [...new Set(updatedIds)];
};

const updateVideoStatuses = async ({ affectedVideoIds = [], mode }) => {
  const targetIds = [...new Set((affectedVideoIds || []).map(normalizeId).filter(Boolean))];
  if (!targetIds.length) return [];
  const timestamp = new Date().toISOString();
  await Promise.all(targetIds.map(async (id) => {
    const { error } = await supabase
      .from('hypotheses')
      .update({ validation_status: mode === 'valid' ? VIDEO_VALID : VIDEO_INVALID, updated_at: timestamp })
      .eq('id', id);
    if (error) throw error;
  }));
  return targetIds;
};

const updateInterviewStatuses = async ({ affectedInterviewIds = [], mode }) => {
  const targetIds = [...new Set((affectedInterviewIds || []).map(normalizeId).filter(Boolean))];
  if (!targetIds.length) return [];
  const timestamp = new Date().toISOString();
  await Promise.all(targetIds.map(async (id) => {
    const { error } = await supabase
      .from('interview_hypotheses')
      .update({ validation_result: mode === 'valid' ? INTERVIEW_VALID : INTERVIEW_INVALID, updated_at: timestamp })
      .eq('id', id);
    if (error) throw error;
  }));
  return targetIds;
};

export const syncVideoHypothesisValidationAcrossModes = async ({ projectId = '', campaignId = '', videoHypothesisId = '', nextVideoStatus = '' } = {}) => {
  const normalizedVideoId = normalizeId(videoHypothesisId);
  const normalizedStatus = normalizeId(nextVideoStatus).toLowerCase();
  if (!projectId || !campaignId || !normalizedVideoId) return { synced: false };

  const mode = normalizedStatus === 'validada' ? 'valid' : normalizedStatus === 'no validada' ? 'invalid' : '';
  if (!mode) return { synced: false };

  const graph = await loadUnifiedCrossModeGraph({ projectId, campaignId });
  const rootSet = getEquivalentNodesAcrossModes(graph, normalizedVideoId, MODE_VIDEO);
  const affectedNodeKeys = mode === 'invalid'
    ? getDescendantsAcrossUnifiedGraph(graph, [...rootSet])
    : rootSet;

  const affectedIdsByMode = groupAffectedIdsByMode([...affectedNodeKeys]);
  const updatedCommentIds = await updateCommentsStatus({
    graph,
    affectedCommentIds: [...affectedIdsByMode[MODE_COMMENTS]],
    mode,
    originHypothesisId: normalizedVideoId,
  });
  const updatedVideoIds = await updateVideoStatuses({
    affectedVideoIds: [...affectedIdsByMode[MODE_VIDEO]],
    mode,
  });
  const updatedInterviewIds = await updateInterviewStatuses({
    affectedInterviewIds: [...affectedIdsByMode[MODE_INTERVIEWS]],
    mode,
  });

  return {
    synced: updatedCommentIds.length > 0 || updatedVideoIds.length > 0 || updatedInterviewIds.length > 0,
    mode,
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
  getEquivalentNodesAcrossModes,
  getDescendantsAcrossUnifiedGraph,
  groupAffectedIdsByMode,
};
