import {
  buildCrossModeSyncStorageKey,
  listCrossModeSyncStores,
  loadCrossModeSyncStoreByKey,
  persistCrossModeSyncStoreByKey,
} from './evolutionLinkStore.js';
import { MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS, buildNodeKey } from './crossModeGraphCore.js';
import { collectLegacyEvolutionLinks } from '../../../../shared/hypothesisLegacyCompat.js';
import {
  IDENTITY_RECORD_FIELD,
  createCrossModeIdentityRegistry,
  createIdentityNodeRef,
  resolveConceptualHypothesisIdentity,
  listIdentityNodes,
  areHypothesesConceptuallyEquivalent,
} from './crossModeIdentity.js';

const toArray = (value) => (Array.isArray(value) ? value : []);
const stableStringify = (value) => JSON.stringify(value, null, 2);

const collectLegacyLinks = (syncStores = []) => syncStores.flatMap(({ storageKey, store }) => collectLegacyEvolutionLinks(store, { storageKey })
  .filter((link) => !link?.deleted_at));

const collectModeNodeRefs = ({ syncStores = [], videoRows = [], interviewRows = [] } = {}) => ({
  [MODE_COMMENTS]: syncStores.flatMap(({ storageKey, store }) => toArray(store?.hypotheses).map((hypothesis) => createIdentityNodeRef(MODE_COMMENTS, hypothesis?.id, { storageKey }))).filter(Boolean),
  [MODE_VIDEO]: toArray(videoRows).map((row) => createIdentityNodeRef(MODE_VIDEO, row?.id)).filter(Boolean),
  [MODE_INTERVIEWS]: toArray(interviewRows).map((row) => createIdentityNodeRef(MODE_INTERVIEWS, row?.id)).filter(Boolean),
});

const persistCentralIdentityRecords = async ({ projectId = '', campaignId = '', records = [] } = {}) => {
  const storageKey = buildCrossModeSyncStorageKey(projectId, campaignId);
  if (!storageKey) return;
  const currentStore = await loadCrossModeSyncStoreByKey(storageKey) || {};
  const currentRecords = toArray(currentStore?.[IDENTITY_RECORD_FIELD]);
  if (stableStringify(currentRecords) === stableStringify(records)) return;
  await persistCrossModeSyncStoreByKey(storageKey, {
    ...currentStore,
    [IDENTITY_RECORD_FIELD]: records,
  });
};

const loadCrossModeIdentityRegistry = async ({ projectId = '', campaignId = '', videoRows = [], interviewRows = [] } = {}) => {
  const syncStores = await listCrossModeSyncStores({ projectId, campaignId });
  const centralStorageKey = buildCrossModeSyncStorageKey(projectId, campaignId);
  const centralStore = (await loadCrossModeSyncStoreByKey(centralStorageKey)) || {};
  const explicitIdentityRecords = toArray(centralStore?.[IDENTITY_RECORD_FIELD]);
  const registry = createCrossModeIdentityRegistry({
    explicitIdentityRecords,
    legacyLinks: collectLegacyLinks(syncStores),
    modeNodeRefs: collectModeNodeRefs({ syncStores, videoRows, interviewRows }),
  });

  await persistCentralIdentityRecords({ projectId, campaignId, records: registry.records });

  return {
    ...registry,
    syncStores,
    centralStorageKey,
  };
};

const attachIdentityToGraphNodes = (graph, registry) => {
  graph.identities = registry.identities;
  graph.nodeToIdentity = registry.nodeToIdentity;
  graph.nodes.forEach((node, nodeKey) => {
    const identityId = registry.nodeToIdentity.get(nodeKey) || null;
    graph.nodes.set(nodeKey, { ...node, identityId });
  });
};

const connectEquivalentNodesFromIdentityRegistry = (graph, addEquivalentEdge) => {
  graph.identities?.forEach((identity) => {
    const [anchorNode, ...restNodes] = toArray(identity?.nodes);
    if (!anchorNode) return;
    restNodes.forEach((node) => {
      addEquivalentEdge(graph, buildNodeKey(anchorNode.mode, anchorNode.hypothesisId), buildNodeKey(node.mode, node.hypothesisId));
    });
  });
};

export {
  IDENTITY_RECORD_FIELD,
  loadCrossModeIdentityRegistry,
  attachIdentityToGraphNodes,
  connectEquivalentNodesFromIdentityRegistry,
  resolveConceptualHypothesisIdentity,
  listIdentityNodes,
  areHypothesesConceptuallyEquivalent,
};
