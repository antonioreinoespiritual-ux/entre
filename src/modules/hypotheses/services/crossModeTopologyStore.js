import {
  buildCrossModeSyncStorageKey,
  listCrossModeSyncStores,
  loadCrossModeSyncStoreByKey,
  persistCrossModeSyncStoreByKey,
} from './evolutionLinkStore.js';
import { MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS, buildNodeKey, normalizeId } from './crossModeGraphCore.js';
import {
  TOPOLOGY_RECORD_FIELD,
  createCrossModeTopologyRegistry,
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
} from './crossModeTopology.js';

const toArray = (value) => (Array.isArray(value) ? value : []);
const stableStringify = (value) => JSON.stringify(value, null, 2);

const extractJsonMetadataBlock = (value = '', tag = '') => {
  const match = String(value || '').match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  if (!match) return {};
  try {
    return JSON.parse(match[1]) || {};
  } catch {
    return {};
  }
};

const collectLegacyCommentTopology = (syncStores = []) => syncStores.flatMap(({ storageKey, store }) => toArray(store?.hypotheses)
  .map((hypothesis) => {
    const parentHypothesisId = normalizeId(hypothesis?.parent_hypothesis_id);
    if (!parentHypothesisId) return null;
    return {
      parent: { mode: MODE_COMMENTS, hypothesis_id: parentHypothesisId, storage_key: storageKey },
      child: { mode: MODE_COMMENTS, hypothesis_id: normalizeId(hypothesis?.id), storage_key: storageKey },
      source: 'legacy_comments_parent_field',
    };
  })
  .filter(Boolean));

const collectLegacyVideoTopology = (videoRows = []) => toArray(videoRows).map((row) => {
  const parentHypothesisId = normalizeId(extractJsonMetadataBlock(row?.contexto_cualitativo || '', 'hierarchy_meta')?.parent_hypothesis_id);
  if (!parentHypothesisId) return null;
  return {
    parent: { mode: MODE_VIDEO, hypothesis_id: parentHypothesisId },
    child: { mode: MODE_VIDEO, hypothesis_id: normalizeId(row?.id) },
    source: 'legacy_video_hierarchy_metadata',
  };
}).filter(Boolean);

const collectLegacyInterviewTopology = (interviewRows = []) => toArray(interviewRows).map((row) => {
  const parentHypothesisId = normalizeId(extractJsonMetadataBlock(row?.observations || '', 'interview_hierarchy')?.parent_hypothesis_id);
  if (!parentHypothesisId) return null;
  return {
    parent: { mode: MODE_INTERVIEWS, hypothesis_id: parentHypothesisId },
    child: { mode: MODE_INTERVIEWS, hypothesis_id: normalizeId(row?.id) },
    source: 'legacy_interview_hierarchy_metadata',
  };
}).filter(Boolean);

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
    legacyTopologyRecords: [
      ...collectLegacyCommentTopology(syncStores),
      ...collectLegacyVideoTopology(videoRows),
      ...collectLegacyInterviewTopology(interviewRows),
    ],
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
