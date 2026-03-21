import { supabase } from '../../../lib/customSupabaseClient.js';
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
import {
  loadCrossModeIdentityRegistry,
  attachIdentityToGraphNodes,
  connectEquivalentNodesFromIdentityRegistry,
} from './crossModeIdentityStore.js';
import {
  loadCrossModeTopologyRegistry,
  attachTopologyToGraph,
  connectParentChildTopologyToGraph,
} from './crossModeTopologyStore.js';

export * from './crossModeGraphCore.js';
export {
  resolveConceptualHypothesisIdentity,
  listIdentityNodes,
  areHypothesesConceptuallyEquivalent,
} from './crossModeIdentityStore.js';
export {
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
} from './crossModeTopologyStore.js';

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

  const identityRegistry = await loadCrossModeIdentityRegistry({
    projectId,
    campaignId,
    videoRows,
    interviewRows,
  });
  const topologyRegistry = await loadCrossModeTopologyRegistry({
    projectId,
    campaignId,
    videoRows,
    interviewRows,
  });

  identityRegistry.syncStores.forEach(({ storageKey, store }) => {
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    ensureModeStoreEntry(graph, MODE_COMMENTS, storageKey, store);
    hypotheses.forEach((hypothesis) => registerCommentNode(graph, storageKey, hypothesis));
  });

  attachIdentityToGraphNodes(graph, identityRegistry);
  connectEquivalentNodesFromIdentityRegistry(graph, addEquivalentEdge);
  attachTopologyToGraph(graph, topologyRegistry);
  connectParentChildTopologyToGraph(graph, addChildEdge);

  return graph;
};

export { loadUnifiedCrossModeGraph };
