import {
  buildCrossModeSyncStorageKey,
  listCrossModeSyncStores,
  loadCrossModeSyncStoreByKey,
  persistCrossModeSyncStoreByKey,
} from './evolutionLinkStore.js';
import { buildNodeKey } from './crossModeGraphCore.js';
import { buildLegacyTopologyRecords } from '../../../../shared/hypothesisLegacyCompat.js';
import {
  TOPOLOGY_RECORD_FIELD,
  createCrossModeTopologyRegistry,
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
} from './crossModeTopology.js';

const toArray = (value) => (Array.isArray(value) ? value : []);
const stableStringify = (value) => JSON.stringify(value, null, 2);

const collectLegacyTopologyRecords = ({ syncStores = [], videoRows = [], interviewRows = [] } = {}) => [
  ...syncStores.flatMap(({ storageKey, store }) => buildLegacyTopologyRecords({
    hypotheses: toArray(store?.hypotheses),
    storageKey,
  })),
  ...buildLegacyTopologyRecords({ videoRows, interviewRows }),
];

const persistCentralTopologyRecords = async ({ projectId = '', campaignId = '', records = [] } = {}) => {
  const storageKey = buildCrossModeSyncStorageKey(projectId, campaignId);
  if (!storageKey) return;
  const currentStore = await loadCrossModeSyncStoreByKey(storageKey) || {};
  const currentRecords = toArray(currentStore?.[TOPOLOGY_RECORD_FIELD]);
  if (stableStringify(currentRecords) === stableStringify(records)) return;
  await persistCrossModeSyncStoreByKey(storageKey, {
    ...currentStore,
    [TOPOLOGY_RECORD_FIELD]: records,
  });
};

const loadCrossModeTopologyRegistry = async ({ projectId = '', campaignId = '', videoRows = [], interviewRows = [] } = {}) => {
  const syncStores = await listCrossModeSyncStores({ projectId, campaignId });
  const centralStorageKey = buildCrossModeSyncStorageKey(projectId, campaignId);
  const centralStore = (await loadCrossModeSyncStoreByKey(centralStorageKey)) || {};
  const explicitTopologyRecords = toArray(centralStore?.[TOPOLOGY_RECORD_FIELD]);

  const registry = createCrossModeTopologyRegistry({
    explicitTopologyRecords,
    legacyTopologyRecords: collectLegacyTopologyRecords({ syncStores, videoRows, interviewRows }),
  });

  await persistCentralTopologyRecords({ projectId, campaignId, records: registry.records });

  return {
    ...registry,
    syncStores,
    centralStorageKey,
  };
};

const attachTopologyToGraph = (graph, registry) => {
  graph.topology = registry;
  graph.parentByNodeKey = registry.parentByNodeKey;
  graph.childrenByNodeKey = registry.childrenByNodeKey;
};

const connectParentChildTopologyToGraph = (graph, addChildEdge) => {
  graph.topology?.records?.forEach((record) => {
    addChildEdge(
      graph,
      buildNodeKey(record.parent.mode, record.parent.hypothesis_id),
      buildNodeKey(record.child.mode, record.child.hypothesis_id),
    );
  });
};

export {
  TOPOLOGY_RECORD_FIELD,
  loadCrossModeTopologyRegistry,
  attachTopologyToGraph,
  connectParentChildTopologyToGraph,
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
};
