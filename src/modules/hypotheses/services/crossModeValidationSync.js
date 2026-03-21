import {
  VALIDATION_STATE_VALID,
  VALIDATION_STATE_INVALID,
  VALIDATION_STATE_INCONCLUSIVE,
  MODE_VIDEO,
  buildNodeKey,
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
  groupAffectedIdsByMode,
  normalizeValidationState,
  toCommentsValidationState,
  toVideoValidationState,
  toInterviewValidationState,
  getValidationStateFromNode,
  shouldSyncVideoStateTransition,
  normalizeId,
  loadUnifiedCrossModeGraph,
} from './crossModeGraph.js';
import { buildStateTransitionPlan, STATE_TRANSITION_ACTIONS, createResolverContextFromGraph } from './crossModeStateTransitionEngine.js';
import { updateCommentStatuses, updateInterviewStatuses, updateVideoStatuses } from './crossModeStateRepository.js';

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
  const resolverContext = createResolverContextFromGraph(graph);
  const transitionPlan = buildStateTransitionPlan(resolverContext, {
    mode: MODE_VIDEO,
    hypothesisId: normalizedVideoId,
    action: nextState === VALIDATION_STATE_INVALID ? STATE_TRANSITION_ACTIONS.INVALIDATE : STATE_TRANSITION_ACTIONS.VALIDATE,
  });
  const affectedNodeKeys = transitionPlan.affectedNodeKeys;

  const affectedIdsByMode = groupAffectedIdsByMode([...affectedNodeKeys]);
  const updatedVideoIds = await updateVideoStatuses({
    affectedVideoIds: [...affectedIdsByMode.video],
    nextState,
  });
  [...affectedIdsByMode.video].forEach((videoId) => {
    const nodeKey = buildNodeKey(MODE_VIDEO, videoId);
    const currentNode = graph.nodes.get(nodeKey);
    if (!currentNode) return;
    graph.nodes.set(nodeKey, { ...currentNode, validationState: nextState });
  });

  const updatedCommentIds = await updateCommentStatuses({
    graph,
    affectedCommentIds: [...affectedIdsByMode.comments],
    nextState,
  });
  const updatedInterviewIds = await updateInterviewStatuses({
    affectedInterviewIds: [...affectedIdsByMode.interviews],
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
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
  groupAffectedIdsByMode,
  normalizeValidationState,
  toCommentsValidationState,
  toVideoValidationState,
  toInterviewValidationState,
  getValidationStateFromNode,
  shouldSyncVideoStateTransition,
};
