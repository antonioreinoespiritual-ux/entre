import { interviewsApi } from '@/services/interviewsApi';
import { createStableId } from '@/lib/stableId';

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

export const interviewsModuleApi = {
  listAudiences: interviewsApi.listAudiences,

  listClients: interviewsApi.listClients,
  createClient: interviewsApi.createClient,
  updateClient: interviewsApi.updateClient,
  deleteClient: interviewsApi.deleteClient,

  listHypotheses: interviewsApi.listInterviewHypotheses,
  createHypothesis: interviewsApi.createInterviewHypothesis,
  updateHypothesis: interviewsApi.updateInterviewHypothesis,
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
