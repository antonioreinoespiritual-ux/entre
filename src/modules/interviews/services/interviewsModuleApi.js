import { interviewsApi } from '@/services/interviewsApi';
import { createStableId } from '@/lib/stableId';
import { syncCrossModeHypothesisStateTransition } from '@/modules/hypotheses/services/crossModeValidationSync';
import { HYPOTHESIS_MODES, buildModeStatePatch, withCanonicalHypothesisState } from '../../../../shared/hypothesisState.js';

const createId = () => createStableId('q_');

export const QUESTION_TYPES = ['short_text', 'long_text', 'single_choice', 'multi_choice', 'scale_1_5'];

export const normalizeQuestion = (question, index = 0) => ({
  ...question,
  id: String(question?.id || createId()),
  type: QUESTION_TYPES.includes(question?.type) ? question.type : 'short_text',
  title: String(question?.title || question?.label || `Pregunta ${index + 1}`),
  required: Boolean(question?.required),
  options: Array.isArray(question?.options) ? question.options.map((option) => String(option)) : [],
  description: String(question?.description || ''),
  scale_min_label: String(question?.scale_min_label || ''),
  scale_max_label: String(question?.scale_max_label || ''),
  order: Number(question?.order || index + 1),
});

export const buildFormPayload = (payload = {}) => {
  const normalizedQuestions = (payload.questions || payload.questions_json || []).map(normalizeQuestion);
  return {
    ...payload,
    questions: normalizedQuestions,
    questions_json: normalizedQuestions,
  };
};

export const normalizeForm = (form) => ({
  ...form,
  questions: (Array.isArray(form?.questions_json) ? form.questions_json : form?.questions || []).map(normalizeQuestion),
});


const normalizeInterviewHypothesis = (hypothesis) => withCanonicalHypothesisState(hypothesis, HYPOTHESIS_MODES.INTERVIEWS);
const buildInterviewHypothesisPayload = (payload = {}) => ({
  ...payload,
  ...buildModeStatePatch(HYPOTHESIS_MODES.INTERVIEWS, payload.validation_result ?? payload.validation_status ?? payload.hypothesis_state ?? payload.status),
});

const maybeSyncInterviewStateTransition = async ({ previousState = '', record = null, origin = 'interviews' } = {}) => {
  const normalizedRecord = record ? normalizeInterviewHypothesis(record) : null;
  const nextState = normalizedRecord?.validation_result || normalizedRecord?.hypothesis_state || '';
  if (!normalizedRecord?.project_id || !normalizedRecord?.campaign_id || !normalizedRecord?.id) return normalizedRecord;
  await syncCrossModeHypothesisStateTransition({
    projectId: normalizedRecord.project_id,
    campaignId: normalizedRecord.campaign_id,
    mode: HYPOTHESIS_MODES.INTERVIEWS,
    hypothesisId: normalizedRecord.id,
    previousState,
    nextState,
    origin,
  });
  return normalizedRecord;
};

export const interviewsModuleApi = {
  listAudiences: interviewsApi.listAudiences,

  listClients: interviewsApi.listClients,
  createClient: interviewsApi.createClient,
  updateClient: interviewsApi.updateClient,
  deleteClient: interviewsApi.deleteClient,

  listHypotheses: async (projectId, campaignId) => (await interviewsApi.listInterviewHypotheses(projectId, campaignId)).map(normalizeInterviewHypothesis),
  createHypothesis: async (projectId, campaignId, payload) => normalizeInterviewHypothesis(await interviewsApi.createInterviewHypothesis(projectId, campaignId, buildInterviewHypothesisPayload(payload))),
  updateHypothesis: async (id, payload) => {
    const record = await interviewsApi.updateInterviewHypothesis(id, buildInterviewHypothesisPayload(payload));
    const includesStateChange = payload.validation_result != null || payload.validation_status != null || payload.hypothesis_state != null;
    if (!includesStateChange) return normalizeInterviewHypothesis(record);
    return maybeSyncInterviewStateTransition({
      previousState: '',
      record,
      origin: 'interviews_manual_update',
    });
  },
  evaluateHypothesis: async (id) => maybeSyncInterviewStateTransition({
    previousState: '',
    record: await interviewsApi.evaluateInterviewHypothesis(id),
    origin: 'interviews_evaluate',
  }),
  deleteHypothesis: interviewsApi.deleteInterviewHypothesis,

  listForms: async (projectId, campaignId) => {
    const forms = await interviewsApi.listForms(projectId, campaignId);
    return forms.map(normalizeForm);
  },
  createForm: async (projectId, campaignId, payload) => normalizeForm(await interviewsApi.createForm(projectId, campaignId, buildFormPayload(payload))),
  updateForm: async (id, payload) => normalizeForm(await interviewsApi.updateForm(id, buildFormPayload(payload))),
  deleteForm: interviewsApi.deleteForm,

  listSessions: interviewsApi.listInterviewSessions,
  createSession: interviewsApi.createSession,
  readSession: interviewsApi.readSession,
  updateSession: interviewsApi.updateSession,
  deleteSession: interviewsApi.deleteSession,

  listCloudOverview: interviewsApi.listInterviewCloudOverview,
  listCloudNodes: interviewsApi.listInterviewCloudNodes,
  readCloudDocument: interviewsApi.readInterviewCloudDocument,
  listDocumentFragments: interviewsApi.listInterviewDocumentFragments,
  listProjectFragments: interviewsApi.listInterviewProjectFragments,
  createDocumentFragment: interviewsApi.createInterviewDocumentFragment,
};
