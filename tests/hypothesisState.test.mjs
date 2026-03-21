import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYPOTHESIS_MODES,
  HYPOTHESIS_STATE,
  buildModeStatePatch,
  normalizeHypothesisState,
  readHypothesisStateForMode,
  withCanonicalHypothesisState,
} from '../shared/hypothesisState.js';

test('normalizes legacy aliases into canonical hypothesis states', () => {
  assert.equal(normalizeHypothesisState('Validada'), HYPOTHESIS_STATE.VALIDATED);
  assert.equal(normalizeHypothesisState('No validada'), HYPOTHESIS_STATE.INVALIDATED);
  assert.equal(normalizeHypothesisState('refutada'), HYPOTHESIS_STATE.INVALIDATED);
  assert.equal(normalizeHypothesisState('pendiente'), HYPOTHESIS_STATE.INCONCLUSIVE);
  assert.equal(normalizeHypothesisState('señal fuerte'), HYPOTHESIS_STATE.VALIDATED);
  assert.equal(normalizeHypothesisState('señal moderada'), HYPOTHESIS_STATE.INCONCLUSIVE);
});

test('builds persisted patches using the mode-specific field names and canonical values', () => {
  assert.deepEqual(buildModeStatePatch(HYPOTHESIS_MODES.COMMENTS, 'pendiente'), { validation_status: HYPOTHESIS_STATE.INCONCLUSIVE });
  assert.deepEqual(buildModeStatePatch(HYPOTHESIS_MODES.VIDEO, 'No validada'), { validation_status: HYPOTHESIS_STATE.INVALIDATED });
  assert.deepEqual(buildModeStatePatch(HYPOTHESIS_MODES.INTERVIEWS, 'no evaluada'), { validation_result: HYPOTHESIS_STATE.INCONCLUSIVE });
});

test('reads canonical states across comments, video and interviews without ambiguity', () => {
  assert.equal(readHypothesisStateForMode(HYPOTHESIS_MODES.COMMENTS, { validation_status: 'refutada' }), HYPOTHESIS_STATE.INVALIDATED);
  assert.equal(readHypothesisStateForMode(HYPOTHESIS_MODES.VIDEO, { validation_status: 'Validada' }), HYPOTHESIS_STATE.VALIDATED);
  assert.equal(readHypothesisStateForMode(HYPOTHESIS_MODES.INTERVIEWS, { validation_result: 'no evaluada' }), HYPOTHESIS_STATE.INCONCLUSIVE);
});

test('decorates records with a canonical hypothesis_state field while preserving legacy fields', () => {
  const record = withCanonicalHypothesisState({ validation_result: 'señal fuerte', title: 'x' }, HYPOTHESIS_MODES.INTERVIEWS);
  assert.equal(record.validation_result, 'señal fuerte');
  assert.equal(record.hypothesis_state, HYPOTHESIS_STATE.VALIDATED);
  assert.equal(record.title, 'x');
});
