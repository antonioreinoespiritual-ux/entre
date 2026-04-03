import { HYPOTHESIS_MODES } from '../../../../../shared/hypothesisState.js';
import { commentsHypothesisAdapter } from './commentsHypothesisAdapter.js';
import { videoHypothesisAdapter } from './videoHypothesisAdapter.js';
import { interviewsHypothesisAdapter } from './interviewsHypothesisAdapter.js';

const modeHypothesisAdapters = {
  [HYPOTHESIS_MODES.COMMENTS]: commentsHypothesisAdapter,
  [HYPOTHESIS_MODES.VIDEO]: videoHypothesisAdapter,
  [HYPOTHESIS_MODES.INTERVIEWS]: interviewsHypothesisAdapter,
};

export const getModeHypothesisAdapter = (mode = '') => modeHypothesisAdapters[String(mode || '').trim()] || null;
export const listModeHypothesisAdapters = () => Object.values(modeHypothesisAdapters);
