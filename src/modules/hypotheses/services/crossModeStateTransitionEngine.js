import { HYPOTHESIS_STATE } from '../../../../shared/hypothesisState.js';
import {
  createResolverContext,
  createResolverContextFromGraph,
  resolveCrossModeBranchNodeKeys,
  resolveEquivalentNodeKeys,
} from './crossModeBranchResolver.js';

const STATE_TRANSITION_ACTIONS = {
  VALIDATE: 'validate',
  INVALIDATE: 'invalidate',
};

const normalizeTransitionAction = (action = '') => {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === STATE_TRANSITION_ACTIONS.VALIDATE) return STATE_TRANSITION_ACTIONS.VALIDATE;
  if (normalized === STATE_TRANSITION_ACTIONS.INVALIDATE) return STATE_TRANSITION_ACTIONS.INVALIDATE;
  return '';
};

const resolveCanonicalStateForAction = (action = '') => {
  const normalizedAction = normalizeTransitionAction(action);
  if (normalizedAction === STATE_TRANSITION_ACTIONS.VALIDATE) return HYPOTHESIS_STATE.VALIDATED;
  if (normalizedAction === STATE_TRANSITION_ACTIONS.INVALIDATE) return HYPOTHESIS_STATE.INVALIDATED;
  return HYPOTHESIS_STATE.INCONCLUSIVE;
};

const resolveAffectedNodeKeysForAction = (context, target = {}, action = '') => {
  const resolverContext = createResolverContext(context);
  const normalizedAction = normalizeTransitionAction(action);
  if (normalizedAction === STATE_TRANSITION_ACTIONS.VALIDATE) {
    return resolveEquivalentNodeKeys(resolverContext, target, { includeSelf: true });
  }
  if (normalizedAction === STATE_TRANSITION_ACTIONS.INVALIDATE) {
    return resolveCrossModeBranchNodeKeys(resolverContext, target, { includeRoot: true });
  }
  return [];
};

const buildStateTransitionPlan = (context, { mode = '', hypothesisId = '', id = '', nodeKey = '', action = '' } = {}) => {
  const normalizedAction = normalizeTransitionAction(action);
  const targetState = resolveCanonicalStateForAction(normalizedAction);
  const affectedNodeKeys = resolveAffectedNodeKeysForAction(context, { mode, hypothesisId: hypothesisId || id, nodeKey }, normalizedAction);

  return {
    action: normalizedAction,
    targetState,
    affectedNodeKeys,
    strategy: normalizedAction === STATE_TRANSITION_ACTIONS.INVALIDATE ? 'branch_with_descendants' : 'direct_equivalents_only',
  };
};

export {
  STATE_TRANSITION_ACTIONS,
  normalizeTransitionAction,
  resolveCanonicalStateForAction,
  resolveAffectedNodeKeysForAction,
  buildStateTransitionPlan,
  createResolverContext,
  createResolverContextFromGraph,
};
