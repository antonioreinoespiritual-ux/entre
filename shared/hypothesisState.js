export const HYPOTHESIS_STATE = Object.freeze({
  VALIDATED: 'validada',
  INVALIDATED: 'invalidada',
  INCONCLUSIVE: 'inconclusa',
});

export const HYPOTHESIS_MODES = Object.freeze({
  COMMENTS: 'comments',
  VIDEO: 'video',
  INTERVIEWS: 'interviews',
});

const INVALID_ALIASES = new Set([
  HYPOTHESIS_STATE.INVALIDATED,
  'no validada',
  'no_validada',
  'invalid',
  'invalidated',
  'refutada',
  'refutada parcialmente',
  'rejected',
  'failed',
]);

const INCONCLUSIVE_ALIASES = new Set([
  HYPOTHESIS_STATE.INCONCLUSIVE,
  'pendiente',
  'pending',
  'no evaluada',
  'no_evaluada',
  'sin evaluar',
  'unknown',
  'exploracion',
  'exploración',
  'en prueba',
  'señal débil',
  'señal debil',
  'señal moderada',
  'senal debil',
  'senal moderada'
]);

const VALID_ALIASES = new Set([
  HYPOTHESIS_STATE.VALIDATED,
  'validated',
  'valid',
  'aprobada',
  'approved',
  'passed',
  'señal fuerte',
  'senal fuerte'
]);

export function normalizeHypothesisState(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return HYPOTHESIS_STATE.INCONCLUSIVE;
  if (VALID_ALIASES.has(normalized)) return HYPOTHESIS_STATE.VALIDATED;
  if (INVALID_ALIASES.has(normalized)) return HYPOTHESIS_STATE.INVALIDATED;
  if (INCONCLUSIVE_ALIASES.has(normalized)) return HYPOTHESIS_STATE.INCONCLUSIVE;
  return HYPOTHESIS_STATE.INCONCLUSIVE;
}

export function toModePersistedHypothesisState(mode = '', state = '') {
  const canonical = normalizeHypothesisState(state);
  if (mode === HYPOTHESIS_MODES.COMMENTS) return canonical;
  if (mode === HYPOTHESIS_MODES.VIDEO) return canonical;
  if (mode === HYPOTHESIS_MODES.INTERVIEWS) return canonical;
  return canonical;
}

export function getModeStateField(mode = '') {
  if (mode === HYPOTHESIS_MODES.INTERVIEWS) return 'validation_result';
  return 'validation_status';
}

export function readHypothesisStateForMode(mode = '', source = {}) {
  if (!source || typeof source !== 'object') return HYPOTHESIS_STATE.INCONCLUSIVE;
  const field = getModeStateField(mode);
  if (field && source[field] != null) return normalizeHypothesisState(source[field]);
  return normalizeHypothesisState(
    source.validation_status
    ?? source.validation_result
    ?? source.hypothesis_state
    ?? source.status
    ?? source.state
    ?? source.outcome,
  );
}

export function withCanonicalHypothesisState(record = {}, mode = '') {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    hypothesis_state: readHypothesisStateForMode(mode, record),
  };
}

export function buildModeStatePatch(mode = '', state = '', extra = {}) {
  const field = getModeStateField(mode);
  return {
    ...extra,
    ...(field ? { [field]: toModePersistedHypothesisState(mode, state) } : {}),
  };
}
