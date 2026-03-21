import { supabase } from '../../../lib/customSupabaseClient.js';
import { persistCrossModeSyncStoreByKey } from './evolutionLinkStore.js';
import {
  MODE_COMMENTS,
  MODE_VIDEO,
  MODE_INTERVIEWS,
  VALIDATION_STATE_INCONCLUSIVE,
  buildNodeKey,
  normalizeId,
  normalizeValidationState,
  toCommentsValidationState,
} from './crossModeGraph.js';
import { buildModeStatePatch } from '../../../../shared/hypothesisState.js';

const updateCommentStatuses = async ({ graph, affectedCommentIds = [], nextState = '' }) => {
  const targetIds = new Set((affectedCommentIds || []).map(normalizeId).filter(Boolean));
  if (!targetIds.size) return [];

  const timestamp = new Date().toISOString();
  const updatedIds = [];
  const storesByKey = new Map();

  [...targetIds].forEach((commentId) => {
    const node = graph.nodes.get(buildNodeKey(MODE_COMMENTS, commentId));
    if (!node?.storageKey) return;
    if (!storesByKey.has(node.storageKey)) storesByKey.set(node.storageKey, []);
    storesByKey.get(node.storageKey).push(commentId);
  });

  for (const [storageKey, commentIds] of storesByKey.entries()) {
    const modeStoreKey = `${MODE_COMMENTS}:${storageKey}`;
    const entry = graph.modeStores.get(modeStoreKey);
    const store = entry?.store;
    const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
    if (!storageKey || !hypotheses.length) continue;

    const commentIdsSet = new Set(commentIds);
    let touched = false;
    const nextHypotheses = hypotheses.map((item) => {
      const itemId = normalizeId(item?.id);
      if (!commentIdsSet.has(itemId)) return item;
      const normalizedCurrentState = normalizeValidationState(item?.validation_status);
      const normalizedNextState = normalizeValidationState(nextState) || VALIDATION_STATE_INCONCLUSIVE;
      const nextItem = {
        ...item,
        validation_status: toCommentsValidationState(normalizedNextState),
      };
      delete nextItem.invalidated_at;
      delete nextItem.invalidated_from_hypothesis_id;
      if (normalizedCurrentState === normalizedNextState) return nextItem;
      touched = true;
      updatedIds.push(itemId);
      nextItem.updated_at = timestamp;
      const nodeKey = buildNodeKey(MODE_COMMENTS, itemId);
      const currentNode = graph.nodes.get(nodeKey);
      if (currentNode) graph.nodes.set(nodeKey, { ...currentNode, hypothesis: nextItem, validationState: normalizedNextState });
      return nextItem;
    });

    if (!touched) continue;
    const nextStore = { ...store, hypotheses: nextHypotheses };
    graph.modeStores.set(modeStoreKey, { ...entry, store: nextStore });
    await persistCrossModeSyncStoreByKey(storageKey, nextStore);
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

export {
  updateCommentStatuses,
  updateVideoStatuses,
  updateInterviewStatuses,
};
