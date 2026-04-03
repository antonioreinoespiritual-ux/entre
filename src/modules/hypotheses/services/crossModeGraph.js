import {
  MODE_COMMENTS,
  MODE_VIDEO,
  MODE_INTERVIEWS,
  buildNodeKey,
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
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
import { getModeHypothesisAdapter } from './adapters/modeHypothesisAdapters.js';

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

const registerCommentNode = (graph, node) => {
  const id = normalizeId(node?.id);
  const storageKey = String(node?.storageKey || '').trim();
  if (!storageKey || !id) return;
  const hypothesis = node?.record || {};
  const nodeKey = buildNodeKey(MODE_COMMENTS, id);
  graph.nodes.set(nodeKey, { mode: MODE_COMMENTS, id, storageKey, hypothesis, validationState: node?.validationState });
  const storeEntry = ensureModeStoreEntry(graph, MODE_COMMENTS, storageKey, node?.sourceStore || null);
  storeEntry.hypotheses.set(id, hypothesis);
};

const registerModeNode = (graph, node) => {
  const id = normalizeId(node?.id);
  const mode = String(node?.mode || '').trim();
  if (!id || !mode) return;
  graph.nodes.set(buildNodeKey(mode, id), { mode, id, row: node?.record || {}, validationState: node?.validationState });
};

const loadUnifiedCrossModeGraph = async ({ projectId = '', campaignId = '' } = {}) => {
  const graph = createUnifiedGraph();

  const videoNodes = await getModeHypothesisAdapter(MODE_VIDEO).listNodes({ campaignId });
  videoNodes.forEach((node) => registerModeNode(graph, node));

  const interviewNodes = await getModeHypothesisAdapter(MODE_INTERVIEWS).listNodes({ campaignId });
  interviewNodes.forEach((node) => registerModeNode(graph, node));

  const identityRegistry = await loadCrossModeIdentityRegistry({
    projectId,
    campaignId,
    videoRows: videoNodes.map((node) => node.record),
    interviewRows: interviewNodes.map((node) => node.record),
  });
  const topologyRegistry = await loadCrossModeTopologyRegistry({
    projectId,
    campaignId,
    videoRows: videoNodes.map((node) => node.record),
    interviewRows: interviewNodes.map((node) => node.record),
  });

  const commentNodes = await getModeHypothesisAdapter(MODE_COMMENTS).listNodes({ projectId, campaignId });
  commentNodes.forEach((node) => registerCommentNode(graph, node));

  attachIdentityToGraphNodes(graph, identityRegistry);
  connectEquivalentNodesFromIdentityRegistry(graph, addEquivalentEdge);
  attachTopologyToGraph(graph, topologyRegistry);
  connectParentChildTopologyToGraph(graph, addChildEdge);

  return graph;
};

export { loadUnifiedCrossModeGraph };
