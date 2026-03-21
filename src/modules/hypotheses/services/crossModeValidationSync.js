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

const resolveTransitionAction = (nextState = '') => {
  if (nextState === VALIDATION_STATE_INVALID) return STATE_TRANSITION_ACTIONS.INVALIDATE;
  if (nextState === VALIDATION_STATE_VALID) return STATE_TRANSITION_ACTIONS.VALIDATE;
  return '';
};

export const syncCrossModeHypothesisStateTransition = async ({
  projectId = '',
  campaignId = '',
  mode = '',
  hypothesisId = '',
  previousState = '',
  nextState = '',
  origin = 'unknown',
} = {}) => {
  const normalizedHypothesisId = normalizeId(hypothesisId);
  const normalizedPreviousState = normalizeValidationState(previousState);
  const normalizedNextState = normalizeValidationState(nextState);
  if (!projectId || !campaignId || !mode || !normalizedHypothesisId) return { synced: false, skipped: true, reason: 'missing_context' };
  if (normalizedNextState === VALIDATION_STATE_INCONCLUSIVE) return { synced: false, skipped: true, reason: 'inconclusive_target_state' };
  if (normalizedPreviousState === normalizedNextState) return { synced: false, skipped: true, reason: 'no_state_change' };

  const graph = await loadUnifiedCrossModeGraph({ projectId, campaignId });
  const resolverContext = createResolverContextFromGraph(graph);
  const transitionPlan = buildStateTransitionPlan(resolverContext, {
    mode,
    hypothesisId: normalizedHypothesisId,
    action: resolveTransitionAction(normalizedNextState),
  });
  const affectedIdsByMode = groupAffectedIdsByMode(transitionPlan.affectedNodeKeys);

  const updatedVideoIds = await updateVideoStatuses({
    affectedVideoIds: [...affectedIdsByMode.video],
    nextState: normalizedNextState,
  });
  [...affectedIdsByMode.video].forEach((videoId) => {
    const nodeKey = buildNodeKey(MODE_VIDEO, videoId);
    const currentNode = graph.nodes.get(nodeKey);
    if (!currentNode) return;
    graph.nodes.set(nodeKey, { ...currentNode, validationState: normalizedNextState });
  });

  const updatedCommentIds = await updateCommentStatuses({
    graph,
    affectedCommentIds: [...affectedIdsByMode.comments],
    nextState: normalizedNextState,
  });
  const updatedInterviewIds = await updateInterviewStatuses({
    affectedInterviewIds: [...affectedIdsByMode.interviews],
    nextState: normalizedNextState,
  });

  const trace = {
    origin,
    source: { mode, hypothesisId: normalizedHypothesisId },
    action: transitionPlan.action,
    strategy: transitionPlan.strategy,
    state: normalizedNextState,
    affectedNodeKeys: transitionPlan.affectedNodeKeys,
    updatedByMode: {
      comments: updatedCommentIds,
      video: updatedVideoIds,
      interviews: updatedInterviewIds,
    },
  };
  console.info('[cross-mode-validation-sync]', trace);

  return {
    synced: updatedCommentIds.length > 0 || updatedVideoIds.length > 0 || updatedInterviewIds.length > 0,
    ...trace,
  };
};

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
  return syncCrossModeHypothesisStateTransition({
    projectId,
    campaignId,
    mode: MODE_VIDEO,
    hypothesisId: videoHypothesisId,
    previousState: previousVideoStatus,
    nextState: nextVideoStatus,
    origin: 'video',
  });
};

export const syncVideoHypothesisValidationAcrossModes = async ({ projectId = '', campaignId = '', videoHypothesisId = '', nextVideoStatus = '' } = {}) => syncCrossModeHypothesisStateTransition({
  projectId,
  campaignId,
  mode: MODE_VIDEO,
  hypothesisId: videoHypothesisId,
  previousState: '',
  nextState: nextVideoStatus,
  origin: 'video',
});

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
  resolveTransitionAction,
};
