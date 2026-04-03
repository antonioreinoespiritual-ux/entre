import { listCrossModeSyncStores, persistCrossModeSyncStoreByKey } from '../evolutionLinkStore.js';
import { MODE_COMMENTS, buildNodeKey, normalizeId, normalizeValidationState } from '../crossModeGraphCore.js';
import { buildModeStatePatch, readHypothesisStateForMode } from '../../../../../shared/hypothesisState.js';

export const createCommentsHypothesisAdapter = ({
  listStores = listCrossModeSyncStores,
  persistStore = persistCrossModeSyncStoreByKey,
} = {}) => ({
  mode: MODE_COMMENTS,

  async listNodes({ projectId = '', campaignId = '' } = {}) {
    const stores = await listStores({ projectId, campaignId });
    return stores.flatMap(({ storageKey, store }) => (Array.isArray(store?.hypotheses) ? store.hypotheses : []).map((hypothesis) => ({
      id: normalizeId(hypothesis?.id),
      mode: MODE_COMMENTS,
      storageKey,
      record: hypothesis,
      sourceStore: store,
      validationState: readHypothesisStateForMode(MODE_COMMENTS, hypothesis),
    }))).filter((node) => node.id);
  },

  async updateCanonicalState({ graph, hypothesisIds = [], nextState = '' } = {}) {
    const targetIds = [...new Set((hypothesisIds || []).map(normalizeId).filter(Boolean))];
    if (!targetIds.length) return [];

    const timestamp = new Date().toISOString();
    const updatedIds = [];
    const storesByKey = new Map();

    targetIds.forEach((hypothesisId) => {
      const node = graph?.nodes?.get(buildNodeKey(MODE_COMMENTS, hypothesisId));
      if (!node?.storageKey) return;
      if (!storesByKey.has(node.storageKey)) storesByKey.set(node.storageKey, []);
      storesByKey.get(node.storageKey).push(hypothesisId);
    });

    for (const [storageKey, commentIds] of storesByKey.entries()) {
      const modeStoreKey = `${MODE_COMMENTS}:${storageKey}`;
      const entry = graph?.modeStores?.get(modeStoreKey);
      const store = entry?.store;
      const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
      if (!hypotheses.length) continue;

      const commentIdsSet = new Set(commentIds);
      let touched = false;
      const nextHypotheses = hypotheses.map((item) => {
        const itemId = normalizeId(item?.id);
        if (!commentIdsSet.has(itemId)) return item;
        const currentState = normalizeValidationState(item?.validation_status);
        const nextCanonicalState = normalizeValidationState(nextState);
        const nextItem = {
          ...item,
          ...buildModeStatePatch(MODE_COMMENTS, nextCanonicalState, { updated_at: timestamp }),
        };
        delete nextItem.invalidated_at;
        delete nextItem.invalidated_from_hypothesis_id;
        if (currentState === nextCanonicalState) return nextItem;
        touched = true;
        updatedIds.push(itemId);
        const nodeKey = buildNodeKey(MODE_COMMENTS, itemId);
        const currentNode = graph?.nodes?.get(nodeKey);
        if (currentNode) graph.nodes.set(nodeKey, { ...currentNode, hypothesis: nextItem, validationState: nextCanonicalState });
        return nextItem;
      });

      if (!touched) continue;
      const nextStore = { ...store, hypotheses: nextHypotheses };
      if (graph?.modeStores) graph.modeStores.set(modeStoreKey, { ...entry, store: nextStore });
      await persistStore(storageKey, nextStore);
    }

    return [...new Set(updatedIds)];
  },
});

export const commentsHypothesisAdapter = createCommentsHypothesisAdapter();
