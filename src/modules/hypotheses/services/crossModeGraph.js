import { supabase } from '../../../lib/customSupabaseClient.js';
import { listCrossModeSyncStores } from './evolutionLinkStore.js';
import {
  MODE_COMMENTS,
  MODE_VIDEO,
  MODE_INTERVIEWS,
  buildNodeKey,
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
  getValidationStateFromNode,
  normalizeId,
} from './crossModeGraphCore.js';

export * from './crossModeGraphCore.js';

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

const ensureModeStoreEntry = (graph, mode, storageKey, store = null) => {
  const modeKey = `${String(mode || '').trim()}:${String(storageKey || '').trim()}`;
  const currentEntry = graph.modeStores.get(modeKey) || { mode, storageKey, store, hypotheses: new Map() };
  if (store) currentEntry.store = store;
  graph.modeStores.set(modeKey, currentEntry);
  return currentEntry;
};

const registerCommentNode = (graph, storageKey, hypothesis) => {
  const id = normalizeId(hypothesis?.id);
  if (!storageKey || !id) return;
  const nodeKey = buildNodeKey(MODE_COMMENTS, id);
  graph.nodes.set(nodeKey, { mode: MODE_COMMENTS, id, storageKey, hypothesis, validationState: getValidationStateFromNode(MODE_COMMENTS, { hypothesis }) });
  const storeEntry = ensureModeStoreEntry(graph, MODE_COMMENTS, storageKey);
  storeEntry.hypotheses.set(id, hypothesis);
};

const registerModeNode = (graph, mode, row) => {
  const id = normalizeId(row?.id);
  if (!id) return;
  graph.nodes.set(buildNodeKey(mode, id), { mode, id, row, validationState: getValidationStateFromNode(mode, { row }) });
};

const loadUnifiedCrossModeGraph = async ({ projectId = '', campaignId = '' } = {}) => {
  const graph = createUnifiedGraph();
  const syncStores = await listCrossModeSyncStores({ projectId, campaignId });

  syncStores.forEach(({ storageKey, store }) => {
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    ensureModeStoreEntry(graph, MODE_COMMENTS, storageKey, store);
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

  syncStores.forEach(({ storageKey, store }) => {
    const links = Array.isArray(store?.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks.filter((link) => !link?.deleted_at) : [];
    const commentsStoreEntry = ensureModeStoreEntry(graph, MODE_COMMENTS, storageKey, store);
    links.forEach((link) => {
      const sourceId = normalizeId(link?.source_hypothesis_id);
      const destinationMode = normalizeId(link?.destination_mode);
      const destinationId = normalizeId(link?.destination_hypothesis_id);
      if (!sourceId || !destinationMode || !destinationId) return;
      const sourceKey = buildNodeKey(MODE_COMMENTS, sourceId);
      const destinationKey = buildNodeKey(destinationMode, destinationId);
      if (!graph.nodes.has(sourceKey) && commentsStoreEntry?.hypotheses?.has(sourceId)) {
        registerCommentNode(graph, storageKey, commentsStoreEntry.hypotheses.get(sourceId));
      }
      addEquivalentEdge(graph, sourceKey, destinationKey);
    });
  });

  graph.modeStores.forEach(({ mode, hypotheses }) => {
    if (mode !== MODE_COMMENTS) return;
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

export { loadUnifiedCrossModeGraph };
