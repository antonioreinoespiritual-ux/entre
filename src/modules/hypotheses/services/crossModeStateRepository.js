import { MODE_COMMENTS, MODE_VIDEO, MODE_INTERVIEWS } from './crossModeGraph.js';
import { getModeHypothesisAdapter } from './adapters/modeHypothesisAdapters.js';

const updateModeStatuses = async ({ graph, mode = '', hypothesisIds = [], nextState = '' } = {}) => {
  const adapter = getModeHypothesisAdapter(mode);
  if (!adapter) return [];
  return adapter.updateCanonicalState({ graph, hypothesisIds, nextState });
};

const updateCommentStatuses = async ({ graph, affectedCommentIds = [], nextState = '' }) => updateModeStatuses({
  graph,
  mode: MODE_COMMENTS,
  hypothesisIds: affectedCommentIds,
  nextState,
});

const updateVideoStatuses = async ({ affectedVideoIds = [], nextState = '' }) => updateModeStatuses({
  mode: MODE_VIDEO,
  hypothesisIds: affectedVideoIds,
  nextState,
});

const updateInterviewStatuses = async ({ affectedInterviewIds = [], nextState = '' }) => updateModeStatuses({
  mode: MODE_INTERVIEWS,
  hypothesisIds: affectedInterviewIds,
  nextState,
});

export {
  updateModeStatuses,
  updateCommentStatuses,
  updateVideoStatuses,
  updateInterviewStatuses,
};
