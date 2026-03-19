import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Download, FileText, FolderOpen, Headphones } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { FormBuilder, createEmptyFormDraft } from '@/modules/interviews/components/FormBuilder';
import { InterviewRunner } from '@/modules/interviews/components/InterviewRunner';
import { QuantitativeAnalysisLab } from '@/modules/interviews/components/QuantitativeAnalysisLab';
import { SemanticAnalysisLab } from '@/modules/interviews/components/SemanticAnalysisLab';
import { Toolbar } from '@/modules/interviews/components/editor-toolbar/Toolbar';
import { EmptyState, InterviewModuleShell, Modal } from '@/modules/interviews/components/InterviewModuleShell';
import { useInterviewCenterData } from '@/modules/interviews/hooks/useInterviewCenterData';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';
import { getLeanProblemScore, getLeanScore, getLeanSolutionScore } from '@/modules/interviews/components/LeanEvaluationPanel';


const profileMarker = `\n\n---INTERVIEW_PROFILE_JSON---\n`;


const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';
const semanticWorkspaceStorageKey = 'interviews.semantic.lab.workspace.v1';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}


const emptyClientProfile = {
  demographic: { age: '', gender: '', location: '', marital_status: '', education_level: '', employment_status: '', income_range: '' },
  psychographic: { core_values: '', main_fears: '', main_desires: '', frustrations: '', personality_traits: '' },
  behavioral: { problem_frequency: '', previous_attempts: '', tools_used: '', urgency_level: '' },
};

const parseClientNotes = (notes = '') => {
  const source = String(notes || '');
  const idx = source.indexOf(profileMarker);
  if (idx === -1) return { plainNotes: source, profile: emptyClientProfile };

  const plainNotes = source.slice(0, idx).trimEnd();
  const rawProfile = source.slice(idx + profileMarker.length).trim();
  try {
    const parsed = JSON.parse(rawProfile || '{}');
    return {
      plainNotes,
      profile: {
        demographic: { ...emptyClientProfile.demographic, ...(parsed.demographic || {}) },
        psychographic: { ...emptyClientProfile.psychographic, ...(parsed.psychographic || {}) },
        behavioral: { ...emptyClientProfile.behavioral, ...(parsed.behavioral || {}) },
      },
    };
  } catch {
    return { plainNotes: source, profile: emptyClientProfile };
  }
};

const composeClientNotes = (plainNotes = '', profile = emptyClientProfile) => {
  const cleanNotes = String(plainNotes || '').trimEnd();
  const mergedProfile = {
    demographic: { ...emptyClientProfile.demographic, ...(profile?.demographic || {}) },
    psychographic: { ...emptyClientProfile.psychographic, ...(profile?.psychographic || {}) },
    behavioral: { ...emptyClientProfile.behavioral, ...(profile?.behavioral || {}) },
  };
  return `${cleanNotes}${profileMarker}${JSON.stringify(mergedProfile)}`;
};


const getClientScoreTone = (score, type = 'problem') => {
  if (score == null) return 'border-slate-200 bg-slate-50 text-slate-500';
  if (score >= 4) return type === 'problem' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-sky-200 bg-sky-50 text-sky-700';
  if (score >= 3) return type === 'problem' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700';
  if (score >= 2) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const validationToneByResult = {
  'no evaluada': 'border-slate-200 bg-slate-50 text-slate-600',
  'señal débil': 'border-amber-200 bg-amber-50 text-amber-700',
  'señal moderada': 'border-indigo-200 bg-indigo-50 text-indigo-700',
  'señal fuerte': 'border-sky-200 bg-sky-50 text-sky-700',
  validada: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  refutada: 'border-rose-200 bg-rose-50 text-rose-700',
};

const hypothesisMetricOptions = [
  { value: 'problem_score_avg', label: 'Score problema' },
  { value: 'solution_score_avg', label: 'Score solución' },
  { value: 'problem_intensity_avg', label: 'Intensidad problema' },
  { value: 'problem_frequency_avg', label: 'Frecuencia problema' },
  { value: 'problem_urgency_avg', label: 'Urgencia percibida' },
  { value: 'problem_attempts_avg', label: 'Intentos de solución' },
  { value: 'problem_spend_avg', label: 'Gasto previo' },
  { value: 'problem_clarity_avg', label: 'Claridad del problema' },
  { value: 'segment_fit_avg', label: 'Encaje con el segmento' },
  { value: 'emotional_language_avg', label: 'Lenguaje emocional' },
  { value: 'solution_interest_avg', label: 'Interés en la solución' },
  { value: 'solution_clarity_avg', label: 'Claridad de la solución' },
  { value: 'solution_value_avg', label: 'Valor percibido' },
  { value: 'solution_recurrence_avg', label: 'Uso recurrente' },
  { value: 'solution_payment_avg', label: 'Disposición a pagar' },
];
const hypothesisMetricLabelByValue = Object.fromEntries(hypothesisMetricOptions.map((option) => [option.value, option.label]));
const defaultValidationMetricConfig = {
  selected_metrics: ['problem_score_avg'],
  threshold_value: '4',
  comparison_operator: '>=',
  outcome_if_true: 'validada',
  outcome_if_false: 'refutada',
  evaluation_type: 'average_selected_metrics',
};

const evaluateMetricComparison = (actual, threshold, operator) => {
  if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return false;
  if (operator === '>=') return actual >= threshold;
  if (operator === '>') return actual > threshold;
  if (operator === '<=') return actual <= threshold;
  if (operator === '<') return actual < threshold;
  return false;
};

const blankClient = { name: '', contact: '', notes: '', audience_id: '', status: 'active', profile: emptyClientProfile };
const interviewHypothesisTypeOptions = [
  { value: 'problema', label: 'Problema' },
  { value: 'segmento', label: 'Segmento' },
  { value: 'mensajes', label: 'Mensajes' },
  { value: 'solucion', label: 'Solución' },
  { value: 'producto', label: 'Producto' },
];

const interviewParentTypeByChild = {
  problema: '',
  segmento: 'problema',
  mensajes: 'segmento',
  solucion: 'mensajes',
  producto: 'solucion',
};

const interviewChildTypeByParent = {
  problema: 'segmento',
  segmento: 'mensajes',
  mensajes: 'solucion',
  solucion: 'producto',
  producto: '',
};

const normalizeInterviewHypothesisType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return interviewHypothesisTypeOptions.some((option) => option.value === normalized) ? normalized : '';
};

const interviewHypothesisTypeLabel = (value = '') => interviewHypothesisTypeOptions.find((option) => option.value === normalizeInterviewHypothesisType(value))?.label || 'Sin tipo';

const stripInterviewHierarchyMetadata = (value = '') => String(value || '').replace(/\s*\[interview_hierarchy\][\s\S]*?\[\/interview_hierarchy\]\s*/g, '').trim();

const extractInterviewHierarchyMetadata = (value = '') => {
  const match = String(value || '').match(/\[interview_hierarchy\]([\s\S]*?)\[\/interview_hierarchy\]/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
};

const buildInterviewHierarchyObservations = (observations = '', parentHypothesisId = '') => {
  const clean = stripInterviewHierarchyMetadata(observations);
  const normalizedParentId = String(parentHypothesisId || '').trim();
  if (!normalizedParentId) return clean;
  return [clean, `[interview_hierarchy]${JSON.stringify({ parent_hypothesis_id: normalizedParentId })}[/interview_hierarchy]`].filter(Boolean).join('\n\n');
};

const getInterviewParentHypothesisId = (hypothesis = {}) => String(extractInterviewHierarchyMetadata(hypothesis?.observations || '').parent_hypothesis_id || '').trim();

const blankHypothesis = {
  title: '',
  description: '',
  type: 'problema',
  parent_hypothesis_id: '',
  status: 'exploracion',
  audience_id: '',
  segment: '',
  related_client_id: '',
  interview_form_id: '',
  min_interviews: '',
  validation_metric_config: { ...defaultValidationMetricConfig },
  validation_summary: '',
  validation_result: 'no evaluada',
  experiment_notes: '',
  observations: '',
  next_actions: '',
};

const createBlankHypothesisDraft = () => ({
  ...blankHypothesis,
  validation_metric_config: {
    ...defaultValidationMetricConfig,
    selected_metrics: [...defaultValidationMetricConfig.selected_metrics],
  },
});

const defaultFragmentEvolutionCodeOptions = [
  { slug: 'problema_intenso', label: 'Problema intenso' },
  { slug: 'problema_frecuente', label: 'Problema frecuente' },
  { slug: 'frustracion', label: 'Frustración' },
  { slug: 'miedo_perdida', label: 'Miedo a perder' },
  { slug: 'busqueda_activa', label: 'Búsqueda activa de solución' },
  { slug: 'barrera_precio', label: 'Barrera de precio' },
  { slug: 'urgencia_accion', label: 'Urgencia de acción' },
];


const InterviewCenterPage = () => {
  const { projectId, campaignId, nodeId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const center = useInterviewCenterData({ projectId, campaignId, toast });
  const { reload } = center;

  const interviewHypothesisById = useMemo(
    () => new Map((center.hypotheses || []).map((hypothesis) => [String(hypothesis.id), hypothesis])),
    [center.hypotheses],
  );

  const interviewChildHypothesesByParentId = useMemo(() => (center.hypotheses || []).reduce((acc, hypothesis) => {
    const parentId = getInterviewParentHypothesisId(hypothesis);
    if (!parentId) return acc;
    const current = acc.get(parentId) || [];
    current.push(hypothesis);
    acc.set(parentId, current);
    return acc;
  }, new Map()), [center.hypotheses]);

  const [tab, setTab] = useState('dashboard');
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [clientDraft, setClientDraft] = useState(blankClient);
  const [hypDraft, setHypDraft] = useState(createBlankHypothesisDraft());
  const [hypothesisEditModalOpen, setHypothesisEditModalOpen] = useState(false);
  const [hypothesisEditDraft, setHypothesisEditDraft] = useState(createBlankHypothesisDraft());
  const [activeHypothesisId, setActiveHypothesisId] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessionFilter, setSessionFilter] = useState({ audience_id: '', client_id: '', form_id: '', from: '', to: '' });
  const [cloudState, setCloudState] = useState({ loading: false, error: '', rootId: '', parentId: '', breadcrumbs: [], items: [], overview: null });
  const [cloudFilters, setCloudFilters] = useState({ clientId: '', interviewId: '' });
  const [cloudNodeContextById, setCloudNodeContextById] = useState({});
  const [docReader, setDocReader] = useState({ loading: false, error: '', document: null, selectionText: '', selectionRange: null, manualText: '', manualTitle: '', manualClientId: '', manualInterviewId: '', manualCode: '', fragments: [] });
  const [activeFragmentId, setActiveFragmentId] = useState(null);
  const [highlightFragmentId, setHighlightFragmentId] = useState(null);
  const [semanticCloudFragments, setSemanticCloudFragments] = useState([]);
  const [docSelectionMenu, setDocSelectionMenu] = useState({ open: false, x: 0, y: 0 });
  const [manualFragmentModalOpen, setManualFragmentModalOpen] = useState(false);
  const [readerViewMode, setReaderViewMode] = useState('document');
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [fragmentRailPositions, setFragmentRailPositions] = useState({});
  const [documentRailHeight, setDocumentRailHeight] = useState(320);
  const [fragmentDetailModalOpen, setFragmentDetailModalOpen] = useState(false);
  const [fragmentDetailDraft, setFragmentDetailDraft] = useState({ id: null, title: '', description: '', clientId: '', linkedCode: '', interviewId: '', evolvedToCode: false });
  const [fragmentDetailsById, setFragmentDetailsById] = useState({});
  const [fragmentEvolutionCodeOptions, setFragmentEvolutionCodeOptions] = useState(defaultFragmentEvolutionCodeOptions);

  const [formEditorOpen, setFormEditorOpen] = useState(false);
  const [formPreview, setFormPreview] = useState(false);
  const [formDraft, setFormDraft] = useState(createEmptyFormDraft());
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [formSaveStatus, setFormSaveStatus] = useState('saved');
  const [formSaveError, setFormSaveError] = useState('');
  const [formsMenuOpenId, setFormsMenuOpenId] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientAudienceFilter, setClientAudienceFilter] = useState('');
  const [clientSort, setClientSort] = useState('last_interview_desc');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [clientActionsMenuId, setClientActionsMenuId] = useState(null);
  const [runInterviewPrefill, setRunInterviewPrefill] = useState({ clientId: null, audienceId: null });
  const [clientNotesDraft, setClientNotesDraft] = useState('');
  const [clientNotesSaveState, setClientNotesSaveState] = useState('idle');

  const saveTimerRef = useRef(null);
  const autosaveSeqRef = useRef(0);
  const lastSavedRef = useRef('');
  const clientNotesTimerRef = useRef(null);
  const documentReaderRef = useRef(null);
  const fragmentsRailRef = useRef(null);
  const railFragmentRefs = useRef({});
  const documentFragmentRefs = useRef({});

  const hasPositionChanges = useCallback((current, next) => {
    const currentKeys = Object.keys(current);
    const nextKeys = Object.keys(next);
    if (currentKeys.length !== nextKeys.length) return true;
    return nextKeys.some((key) => Math.abs((current[key] || 0) - (next[key] || 0)) > 1);
  }, []);

  const formIsDirty = useMemo(() => JSON.stringify(formDraft) !== lastSavedRef.current, [formDraft]);

  useEffect(() => {
    if (!docSelectionMenu.open) return undefined;
    const closeMenu = () => setDocSelectionMenu((prev) => ({ ...prev, open: false }));
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [docSelectionMenu.open]);

  useEffect(() => {
    if (!formEditorOpen) return undefined;
    const warn = (event) => {
      if (formSaveStatus === 'dirty' || formSaveStatus === 'saving') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [formEditorOpen, formSaveStatus]);

  useEffect(() => {
    if (!formEditorOpen || !formIsDirty) return;
    setFormSaveStatus('dirty');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const saveSeq = ++autosaveSeqRef.current;
      const snapshot = { ...formDraft, questions: formDraft.questions || [] };
      try {
        setFormSaveStatus('saving');
        setFormSaveError('');
        const saved = snapshot.id
          ? await interviewsModuleApi.updateForm(snapshot.id, snapshot)
          : await interviewsModuleApi.createForm(projectId, campaignId, snapshot);

        if (saveSeq !== autosaveSeqRef.current) return;

        const committed = { ...snapshot, id: saved.id, status: saved.status, updated_at: saved.updated_at };
        setFormDraft((prev) => (saveSeq === autosaveSeqRef.current ? { ...prev, id: saved.id, status: saved.status, updated_at: saved.updated_at } : prev));
        lastSavedRef.current = JSON.stringify(committed);
        setFormSaveStatus('saved');
        await reload();
      } catch (error) {
        if (saveSeq !== autosaveSeqRef.current) return;
        setFormSaveStatus('error');
        setFormSaveError(error.message);
        toast({ title: 'Error guardando formulario', description: error.message, variant: 'destructive' });
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [campaignId, formDraft, formEditorOpen, formIsDirty, projectId, reload, toast]);

  const openCreateForm = () => {
    setTab('forms');
    const draft = createEmptyFormDraft();
    setFormDraft(draft);
    autosaveSeqRef.current += 1;
    lastSavedRef.current = JSON.stringify(draft);
    setFormSaveStatus('dirty');
    setFormSaveError('');
    setFormPreview(false);
    setFormEditorOpen(true);
    setActiveQuestionId(draft.questions[0]?.id || null);
  };

  const openEditForm = (form) => {
    setTab('forms');
    setFormDraft(form);
    autosaveSeqRef.current += 1;
    lastSavedRef.current = JSON.stringify(form);
    setFormSaveStatus('saved');
    setFormSaveError('');
    setFormPreview(false);
    setFormEditorOpen(true);
    setActiveQuestionId(form.questions?.[0]?.id || null);
  };

  const createClient = async (payload) => {
    const created = await interviewsModuleApi.createClient(projectId, campaignId, payload);
    toast({ title: 'Cliente creado' });
    await center.reload();
    return created;
  };

  const buildInterviewAllowedParents = useCallback((currentType, editingId = '') => {
    const requiredParentType = interviewParentTypeByChild[normalizeInterviewHypothesisType(currentType)] || '';
    if (!requiredParentType) return [];
    return (center.hypotheses || []).filter((hypothesis) => String(hypothesis.id) !== String(editingId || '') && normalizeInterviewHypothesisType(hypothesis.type) === requiredParentType);
  }, [center.hypotheses]);

  const buildHypothesisPayload = useCallback((draft = {}, options = {}) => {
    const payload = { ...draft };
    const editingId = String(options.editingId || '');
    const normalizedType = normalizeInterviewHypothesisType(payload.type);
    if (!normalizedType) return null;
    const parentHypothesisId = String(payload.parent_hypothesis_id || '').trim();
    const parentHypothesis = parentHypothesisId ? interviewHypothesisById.get(parentHypothesisId) : null;
    const requiredParentType = interviewParentTypeByChild[normalizedType] || '';
    if (normalizedType === 'problema' && parentHypothesisId) return null;
    if (parentHypothesis && normalizeInterviewHypothesisType(parentHypothesis.type) !== requiredParentType) return null;
    const currentChildren = interviewChildHypothesesByParentId.get(editingId) || [];
    const allowedChildType = interviewChildTypeByParent[normalizedType] || '';
    const invalidChildren = currentChildren.some((child) => normalizeInterviewHypothesisType(child.type) !== allowedChildType);
    if ((!allowedChildType && currentChildren.length) || invalidChildren) return null;

    const minInterviews = Number(payload.min_interviews);
    payload.type = normalizedType;
    payload.min_interviews = Number.isFinite(minInterviews) && minInterviews > 0 ? minInterviews : null;

    const currentConfig = payload.validation_metric_config || defaultValidationMetricConfig;
    const selectedMetrics = Array.isArray(currentConfig.selected_metrics)
      ? [...new Set(currentConfig.selected_metrics.map((metric) => String(metric || '').trim()).filter(Boolean))]
      : [];
    const thresholdValue = Number(currentConfig.threshold_value);

    payload.validation_metric_config = {
      selected_metrics: selectedMetrics,
      threshold_value: Number.isFinite(thresholdValue) ? thresholdValue : null,
      comparison_operator: ['>=', '>', '<=', '<'].includes(currentConfig.comparison_operator) ? currentConfig.comparison_operator : '>=',
      outcome_if_true: String(currentConfig.outcome_if_true || 'validada').trim() || 'validada',
      outcome_if_false: String(currentConfig.outcome_if_false || 'refutada').trim() || 'refutada',
      evaluation_type: 'average_selected_metrics',
    };

    payload.observations = buildInterviewHierarchyObservations(payload.observations, parentHypothesisId);

    ['audience_id', 'related_client_id', 'interview_form_id'].forEach((key) => {
      if (!String(payload[key] || '').trim()) payload[key] = null;
    });

    delete payload.parent_hypothesis_id;
    return payload;
  }, [interviewChildHypothesesByParentId, interviewHypothesisById]);

  const normalizeHypothesisForDraft = useCallback((hypothesis = {}) => {
    const config = hypothesis.validation_metric_config || {};
    return {
      ...blankHypothesis,
      ...hypothesis,
      type: normalizeInterviewHypothesisType(hypothesis.type) || 'problema',
      parent_hypothesis_id: getInterviewParentHypothesisId(hypothesis),
      observations: stripInterviewHierarchyMetadata(hypothesis.observations),
      min_interviews: hypothesis.min_interviews ?? '',
      validation_metric_config: {
        ...defaultValidationMetricConfig,
        ...config,
        selected_metrics: Array.isArray(config.selected_metrics) ? config.selected_metrics : defaultValidationMetricConfig.selected_metrics,
        threshold_value: config.threshold_value ?? defaultValidationMetricConfig.threshold_value,
      },
    };
  }, []);

  const openEditHypothesis = useCallback((hypothesis) => {
    if (!hypothesis) return;
    setActiveHypothesisId(String(hypothesis.id || ''));
    setHypothesisEditDraft(normalizeHypothesisForDraft(hypothesis));
    setHypothesisEditModalOpen(true);
  }, [normalizeHypothesisForDraft]);

  const getHypothesisRuleStatus = useCallback((hypothesis) => {
    const config = hypothesis?.validation_metric_config;
    const selectedMetrics = Array.isArray(config?.selected_metrics)
      ? config.selected_metrics.map((metric) => String(metric || '').trim()).filter(Boolean)
      : [];
    const threshold = Number(config?.threshold_value);
    if (!selectedMetrics.length || !Number.isFinite(threshold)) {
      return { configured: false, comparisonValue: null, threshold: null, passed: false, selectedMetrics: [] };
    }
    const values = selectedMetrics
      .map((metricKey) => Number(hypothesis?.[metricKey]))
      .filter((value) => Number.isFinite(value));
    const comparisonValue = values.length ? Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2)) : null;
    const passed = evaluateMetricComparison(comparisonValue, threshold, config.comparison_operator || '>=');
    return { configured: true, comparisonValue, threshold, passed, selectedMetrics };
  }, []);

  const openClientEditor = (client, closeProfile = false) => {
    setClientDraft({
      ...blankClient,
      ...client,
      notes: client.plainNotes || '',
      profile: { ...emptyClientProfile, ...(client.profile || {}) },
    });
    if (closeProfile) setSelectedClientId(null);
    setClientModalOpen(true);
  };

  const filteredSessions = useMemo(() => center.sessions.filter((session) => {
    if (sessionFilter.audience_id && String(session.audience_id || '') !== String(sessionFilter.audience_id)) return false;
    if (sessionFilter.client_id && String(session.client_id || '') !== String(sessionFilter.client_id)) return false;
    if (sessionFilter.form_id && String(session.form_id || '') !== String(sessionFilter.form_id)) return false;
    const time = new Date(session.created_at).getTime();
    if (sessionFilter.from && time < new Date(sessionFilter.from).getTime()) return false;
    if (sessionFilter.to && time > (new Date(sessionFilter.to).getTime() + 86400000)) return false;
    return true;
  }), [center.sessions, sessionFilter]);


  const sessionsByClientId = useMemo(() => Object.fromEntries(center.clients.map((client) => [
    String(client.id),
    center.sessions.filter((session) => String(session.client_id || '') === String(client.id)),
  ])), [center.clients, center.sessions]);

  const fragmentDetailInterviewOptions = useMemo(() => {
    if (!fragmentDetailDraft.clientId) return [];
    return sessionsByClientId[String(fragmentDetailDraft.clientId)] || [];
  }, [fragmentDetailDraft.clientId, sessionsByClientId]);

  const manualInterviewOptions = useMemo(() => {
    if (!docReader.manualClientId) return [];
    return sessionsByClientId[String(docReader.manualClientId)] || [];
  }, [docReader.manualClientId, sessionsByClientId]);


  const cloudSessionsById = useMemo(() => Object.fromEntries(center.sessions.map((session) => [String(session.id), session])), [center.sessions]);

  const cloudInterviewOptions = useMemo(() => {
    if (cloudFilters.clientId) {
      return center.sessions.filter((session) => String(session.client_id || '') === String(cloudFilters.clientId));
    }
    return center.sessions;
  }, [center.sessions, cloudFilters.clientId]);

  const currentCloudParentContext = useMemo(() => {
    if (!cloudState.parentId) return null;
    return cloudNodeContextById[String(cloudState.parentId)] || null;
  }, [cloudNodeContextById, cloudState.parentId]);

  const filteredCloudItems = useMemo(() => {
    const selectedClientId = String(cloudFilters.clientId || '');
    const selectedInterviewId = String(cloudFilters.interviewId || '');

    if (!selectedClientId && !selectedInterviewId) return cloudState.items || [];

    return (cloudState.items || []).filter((item) => {
      const nodeId = String(item.id);
      const directInterviewId = item.targetType === 'interview_session' ? String(item.targetEntityId || '') : '';
      const inheritedContext = cloudNodeContextById[nodeId] || currentCloudParentContext || null;
      const resolvedInterviewId = directInterviewId || String(inheritedContext?.interviewId || '');
      const resolvedClientId = String(
        inheritedContext?.clientId
        || cloudSessionsById[resolvedInterviewId]?.client_id
        || '',
      );

      if (selectedInterviewId && resolvedInterviewId !== selectedInterviewId) return false;
      if (selectedClientId && resolvedClientId !== selectedClientId) return false;
      return true;
    });
  }, [cloudFilters.clientId, cloudFilters.interviewId, cloudNodeContextById, cloudSessionsById, cloudState.items, currentCloudParentContext]);

  const mappedDocumentFragments = useMemo(() => {
    const source = String(docReader.document?.text || '');
    const usedRanges = [];

    const intersects = (start, end) => usedRanges.some((range) => start < range.end && end > range.start);

    return (docReader.fragments || []).map((fragment) => {
      const fragmentText = String(fragment.selected_text || '').trim();
      const rawStart = Number(fragment.start_offset);
      const rawEnd = Number(fragment.end_offset);
      let start = Number.isFinite(rawStart) ? rawStart : null;
      let end = Number.isFinite(rawEnd) ? rawEnd : null;

      const hasValidOffsets = start != null && end != null && start >= 0 && end > start && end <= source.length;

      if (!hasValidOffsets && fragmentText) {
        const candidates = [];
        let searchFrom = 0;
        while (searchFrom < source.length) {
          const foundAt = source.indexOf(fragmentText, searchFrom);
          if (foundAt === -1) break;
          candidates.push({ start: foundAt, end: foundAt + fragmentText.length });
          searchFrom = foundAt + Math.max(fragmentText.length, 1);
        }

        const freeCandidate = candidates.find((candidate) => !intersects(candidate.start, candidate.end));
        if (freeCandidate) {
          start = freeCandidate.start;
          end = freeCandidate.end;
        }
      }

      const hasRange = start != null && end != null && start >= 0 && end > start && end <= source.length;
      if (hasRange) usedRanges.push({ start, end });

      return {
        ...fragment,
        mappedStart: hasRange ? start : null,
        mappedEnd: hasRange ? end : null,
        hasRange,
      };
    });
  }, [docReader.document?.text, docReader.fragments]);

  useEffect(() => {
    if (!mappedDocumentFragments.length) {
      setFragmentRailPositions({});
      return undefined;
    }

    let frameId = null;

    const measurePositions = () => {
      frameId = null;
      const railNode = fragmentsRailRef.current;
      if (!railNode) return;

      const documentNode = documentReaderRef.current;
      if (!documentNode) return;

      const documentRect = documentNode.getBoundingClientRect();
      const documentHeight = Math.max(documentNode.offsetHeight, 320);
      const railHeight = Math.max(documentHeight - 44, 0);
      setDocumentRailHeight(documentHeight);
      const nextPositions = {};

      mappedDocumentFragments.forEach((fragment, index) => {
        const fragmentId = String(fragment.id);
        const fragmentNode = documentFragmentRefs.current[fragmentId];

        if (fragmentNode) {
          const fragmentRect = fragmentNode.getBoundingClientRect();
          const relativeTop = fragmentRect.top - documentRect.top + documentNode.scrollTop;
          nextPositions[fragmentId] = Math.min(Math.max(relativeTop, 0), railHeight);
        } else {
          nextPositions[fragmentId] = Math.min(index * 34, railHeight);
        }
      });

      setFragmentRailPositions((current) => (hasPositionChanges(current, nextPositions) ? nextPositions : current));
    };

    const scheduleMeasure = () => {
      if (frameId != null) return;
      frameId = window.requestAnimationFrame(measurePositions);
    };

    scheduleMeasure();
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      if (documentReaderRef.current) resizeObserver.observe(documentReaderRef.current);
      if (fragmentsRailRef.current) resizeObserver.observe(fragmentsRailRef.current);
      mappedDocumentFragments.forEach((fragment) => {
        const fragmentNode = documentFragmentRefs.current[String(fragment.id)];
        if (fragmentNode) resizeObserver.observe(fragmentNode);
      });
    }

    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [hasPositionChanges, mappedDocumentFragments, readerViewMode]);

  const documentFragmentsSegments = useMemo(() => {
    const source = String(docReader.document?.text || '');
    if (!source) return [];

    const ranged = mappedDocumentFragments
      .filter((fragment) => fragment.hasRange)
      .sort((a, b) => a.mappedStart - b.mappedStart);

    if (!ranged.length) return [{ type: 'text', value: source }];

    let cursor = 0;
    const segments = [];

    ranged.forEach((fragment) => {
      if (fragment.mappedStart > cursor) {
        segments.push({ type: 'text', value: source.slice(cursor, fragment.mappedStart) });
      }
      segments.push({
        type: 'fragment',
        id: String(fragment.id),
        value: source.slice(fragment.mappedStart, fragment.mappedEnd),
        fragment,
      });
      cursor = Math.max(cursor, fragment.mappedEnd);
    });

    if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) });
    return segments;
  }, [docReader.document?.text, mappedDocumentFragments]);

  const fragmentRailCards = useMemo(() => {
    return mappedDocumentFragments.map((fragment, index) => {
      const fragmentId = String(fragment.id);
      const preview = String(fragment.selected_text || '').trim();
      const shortPreview = preview.length > 92 ? `${preview.slice(0, 92)}…` : preview;
      const fallbackTop = index * 34;
      const topPx = Number.isFinite(fragmentRailPositions[fragmentId]) ? fragmentRailPositions[fragmentId] : fallbackTop;

      return {
        id: fragmentId,
        topPx,
        shortPreview: shortPreview || 'Texto enlazado',
        fragment,
      };
    });
  }, [fragmentRailPositions, mappedDocumentFragments]);

  const clientRows = useMemo(() => center.clients.map((client) => {
    const interviews = center.sessions.filter((session) => String(session.client_id) === String(client.id));
    const lastInterview = interviews.length ? interviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] : null;
    const { plainNotes, profile } = parseClientNotes(client.notes || '');

    const evaluatedInterviews = interviews
      .map((session) => session.responses_json?.__lean_evaluation || null)
      .filter(Boolean);

    const problemScores = evaluatedInterviews.map((evaluation) => getLeanProblemScore(evaluation)).filter((score) => score != null);
    const solutionScores = evaluatedInterviews.map((evaluation) => getLeanSolutionScore(evaluation)).filter((score) => score != null);

    const aggregateProblemScore = problemScores.length ? Number((problemScores.reduce((acc, score) => acc + score, 0) / problemScores.length).toFixed(1)) : null;
    const aggregateSolutionScore = solutionScores.length ? Number((solutionScores.reduce((acc, score) => acc + score, 0) / solutionScores.length).toFixed(1)) : null;

    return {
      ...client,
      plainNotes,
      profile,
      interviewsCount: interviews.length,
      lastInterview,
      interviews,
      evaluatedInterviewsCount: Math.max(problemScores.length, solutionScores.length),
      aggregateProblemScore,
      aggregateSolutionScore,
    };
  }), [center.clients, center.sessions]);

  const visibleClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const filtered = clientRows.filter((client) => {
      if (clientAudienceFilter && String(client.audience_id || '') !== String(clientAudienceFilter)) return false;
      if (q && !`${client.name || ''} ${client.contact || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (clientSort === 'last_interview_asc') return new Date(a.lastInterview?.created_at || 0) - new Date(b.lastInterview?.created_at || 0);
      if (clientSort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
      if (clientSort === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''));
      return new Date(b.lastInterview?.created_at || 0) - new Date(a.lastInterview?.created_at || 0);
    });

    return sorted;
  }, [clientRows, clientSearch, clientAudienceFilter, clientSort]);

  const selectedClient = useMemo(() => clientRows.find((client) => String(client.id) === String(selectedClientId)) || null, [clientRows, selectedClientId]);

  useEffect(() => {
    if (!selectedClient) return;
    setClientNotesDraft(selectedClient.plainNotes || '');
    setClientNotesSaveState('idle');
  }, [selectedClient?.id]);

  useEffect(() => {
    if (!selectedClient) return undefined;
    if (clientNotesDraft === (selectedClient.plainNotes || '')) return undefined;

    setClientNotesSaveState('saving');
    if (clientNotesTimerRef.current) clearTimeout(clientNotesTimerRef.current);

    clientNotesTimerRef.current = setTimeout(async () => {
      try {
        await interviewsModuleApi.updateClient(selectedClient.id, { ...selectedClient, notes: composeClientNotes(clientNotesDraft, selectedClient.profile) });
        setClientNotesSaveState('saved');
        await reload();
      } catch {
        setClientNotesSaveState('error');
      }
    }, 600);

    return () => {
      if (clientNotesTimerRef.current) clearTimeout(clientNotesTimerRef.current);
    };
  }, [clientNotesDraft, selectedClient?.id]);

  const selectedClientSummary = useMemo(() => {
    if (!selectedClient) return null;
    const interviews = [...(selectedClient.interviews || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const lastInterview = interviews[0] || null;
    const formsUsed = new Set(interviews.map((session) => String(session.form_id || session.form_title || '')).filter(Boolean)).size;
    return { interviews, total: interviews.length, lastInterview, formsUsed };
  }, [selectedClient]);

  const startInterviewSession = async (payload) => {
    setSaving(true);
    try {
      const created = await interviewsModuleApi.createSession(projectId, campaignId, payload);
      await center.reload();
      return created;
    } finally {
      setSaving(false);
    }
  };

  const autosaveInterviewSession = async (sessionId, payload) => {
    await interviewsModuleApi.updateSession(sessionId, { ...payload, status: 'draft' });
  };

  const completeInterviewSession = async (sessionId, payload) => {
    setSaving(true);
    try {
      const saved = sessionId
        ? await interviewsModuleApi.updateSession(sessionId, { ...payload, status: 'completed' })
        : await interviewsModuleApi.createSession(projectId, campaignId, { ...payload, status: 'completed' });
      toast({ title: 'Entrevista guardada' });
      await center.reload();
      return saved;
    } finally {
      setSaving(false);
    }
  };


  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token()}` }), []);

  const loadInterviewCloudOverview = useCallback(async () => {
    if (!projectId || !campaignId) return;
    setCloudState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await interviewsModuleApi.listCloudOverview(projectId, campaignId);
      const rootId = data?.roots?.cloudRoot?.id || '';
      setCloudState((prev) => ({ ...prev, loading: false, error: '', overview: data, rootId, parentId: prev.parentId || rootId }));
    } catch (error) {
      setCloudState((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar cloud research' }));
    }
  }, [campaignId, projectId]);

  const loadInterviewCloudFolder = useCallback(async (targetParentId) => {
    if (!projectId || !targetParentId) return;
    setCloudState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const url = new URL(`${apiBaseUrl}/api/cloud/list`);
      url.searchParams.set('projectId', projectId);
      url.searchParams.set('parentId', targetParentId);
      const response = await fetch(url.toString(), { headers: authHeader });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'No se pudo listar carpeta');
      const rows = json.data || [];
      setCloudNodeContextById((prev) => {
        const next = { ...prev };
        const parentContext = prev[String(targetParentId)] || null;
        rows.forEach((item) => {
          const nodeId = String(item.id);
          if (item.targetType === 'interview_session') {
            const interviewId = String(item.targetEntityId || '');
            const interview = center.sessions.find((session) => String(session.id) === interviewId);
            next[nodeId] = { interviewId, clientId: String(interview?.client_id || '') };
            return;
          }
          if (parentContext && !next[nodeId]) {
            next[nodeId] = parentContext;
          }
        });
        return next;
      });
      setCloudState((prev) => ({ ...prev, loading: false, parentId: targetParentId, items: rows, breadcrumbs: json.breadcrumbs || [] }));
    } catch (error) {
      setCloudState((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo listar carpeta' }));
    }
  }, [authHeader, center.sessions, projectId]);

  const uploadInterviewCloudFiles = useCallback(async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length || !cloudState.parentId) return;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('projectId', String(projectId));
        fd.append('parentId', String(cloudState.parentId));
        fd.append('file', file);
        const response = await fetch(`${apiBaseUrl}/api/cloud/upload`, { method: 'POST', headers: authHeader, body: fd });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || 'No se pudo subir archivo');
      }
      event.target.value = '';
      await loadInterviewCloudFolder(cloudState.parentId);
      toast({ title: 'Archivo subido', description: 'Se guardó evidencia en el cloud de entrevistas.' });
    } catch (error) {
      toast({ title: 'Error subiendo archivo', description: error.message, variant: 'destructive' });
    }
  }, [authHeader, cloudState.parentId, loadInterviewCloudFolder, projectId, toast]);

  const loadDocumentFragments = useCallback(async (nodeId) => {
    if (!nodeId) return;
    try {
      const fragments = await interviewsModuleApi.listDocumentFragments(nodeId);
      setDocReader((prev) => ({ ...prev, fragments }));
    } catch {
      setDocReader((prev) => ({ ...prev, fragments: [] }));
    }
  }, []);

  const loadSemanticCloudFragments = useCallback(async () => {
    if (!projectId || !campaignId) return;
    try {
      const fragments = await interviewsModuleApi.listProjectFragments(projectId, campaignId);
      setSemanticCloudFragments(fragments || []);
    } catch {
      setSemanticCloudFragments([]);
    }
  }, [campaignId, projectId]);

  const openDocumentReader = useCallback(async (item) => {
    setDocSelectionMenu((prev) => ({ ...prev, open: false }));
    setManualFragmentModalOpen(false);
    setActiveFragmentId(null);
    setHighlightFragmentId(null);
    setDocReader((prev) => ({ ...prev, loading: true, error: '', document: null, selectionText: '', selectionRange: null, manualTitle: '', manualText: '', manualClientId: '', manualInterviewId: '', manualCode: '' }));
    try {
      const document = await interviewsModuleApi.readCloudDocument(item.id);
      setDocReader((prev) => ({ ...prev, loading: false, document, error: '' }));
      await loadDocumentFragments(item.id);
    } catch (error) {
      setDocReader((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo abrir documento', document: null }));
    }
  }, [loadDocumentFragments]);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim()) return;
    const text = selection.toString().trim();
    const docText = String(docReader.document?.text || '');
    const anchor = docText.indexOf(text);
    const range = anchor >= 0 ? { start_offset: anchor, end_offset: anchor + text.length } : null;
    setDocReader((prev) => ({ ...prev, selectionText: text, selectionRange: range }));
  }, [docReader.document?.text]);

  const openSelectionMenu = useCallback((event) => {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim()) return;
    captureSelection();
    event.preventDefault();
    setDocSelectionMenu({ open: true, x: event.clientX, y: event.clientY });
  }, [captureSelection]);

  const createSelectionFragment = useCallback(async () => {
    if (!docReader.document?.node_id || !docReader.selectionText) return;
    const inferredInterviewId = String(docReader.document.interview_id || '').trim();
    const inferredClientId = String(docReader.document.client_id || '').trim() || String(center.sessions.find((session) => String(session.id) === inferredInterviewId)?.client_id || '');
    const payload = {
      document_node_id: docReader.document.node_id,
      interview_session_id: inferredInterviewId || null,
      selected_text: docReader.selectionText,
      start_offset: docReader.selectionRange?.start_offset ?? null,
      end_offset: docReader.selectionRange?.end_offset ?? null,
      source_type: 'selection',
    };
    try {
      const created = await interviewsModuleApi.createDocumentFragment(payload);
      const createdInterviewId = String(created?.interview_session_id || inferredInterviewId || '').trim();
      const createdClientId = String(inferredClientId || center.sessions.find((session) => String(session.id) === createdInterviewId)?.client_id || '');
      if (created?.id && (createdInterviewId || createdClientId)) {
        setFragmentDetailsById((prev) => ({
          ...prev,
          [String(created.id)]: {
            ...(prev[String(created.id)] || {}),
            title: String(prev[String(created.id)]?.title || ''),
            description: String(docReader.selectionText || '').trim(),
            clientId: createdClientId,
            interviewId: createdInterviewId,
            linkedCode: String(prev[String(created.id)]?.linkedCode || '').trim(),
            evolvedToCode: Boolean(prev[String(created.id)]?.evolvedToCode),
          },
        }));
      }
      setDocReader((prev) => ({ ...prev, selectionText: '', selectionRange: null }));
      setDocSelectionMenu((prev) => ({ ...prev, open: false }));
      await loadDocumentFragments(docReader.document.node_id);
      await loadSemanticCloudFragments();
      toast({ title: 'Fragmento creado', description: 'Se guardó desde selección con trazabilidad y contexto de Cloud.' });
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }, [center.sessions, docReader.document, docReader.selectionRange, docReader.selectionText, loadDocumentFragments, loadSemanticCloudFragments, toast]);

  const createManualFragment = useCallback(async () => {
    if (!docReader.document?.node_id || !docReader.manualText.trim() || !docReader.manualClientId || !docReader.manualInterviewId) return;
    const manualText = String(docReader.manualText || '').trim();
    const manualTitle = String(docReader.manualTitle || '').trim();
    const interviewSessionId = docReader.manualInterviewId || null;

    try {
      const created = await interviewsModuleApi.createDocumentFragment({
        document_node_id: docReader.document.node_id,
        interview_session_id: interviewSessionId || null,
        selected_text: manualText,
        source_type: 'manual',
      });

      if (created?.id && (manualTitle || interviewSessionId || docReader.manualClientId || docReader.manualCode)) {
        setFragmentDetailsById((prev) => ({
          ...prev,
          [String(created.id)]: {
            ...(prev[String(created.id)] || {}),
            title: manualTitle,
            description: manualText,
            clientId: docReader.manualClientId ? String(docReader.manualClientId) : '',
            interviewId: interviewSessionId ? String(interviewSessionId) : '',
            linkedCode: String(docReader.manualCode || '').trim(),
            evolvedToCode: Boolean(prev[String(created.id)]?.evolvedToCode),
          },
        }));
      }

      setDocReader((prev) => ({ ...prev, manualTitle: '', manualText: '', manualClientId: '', manualInterviewId: '', manualCode: '' }));
      setManualFragmentModalOpen(false);
      await loadDocumentFragments(docReader.document.node_id);
      await loadSemanticCloudFragments();
      toast({ title: 'Fragmento manual creado' });
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }, [docReader.document, docReader.manualClientId, docReader.manualCode, docReader.manualInterviewId, docReader.manualText, docReader.manualTitle, loadDocumentFragments, loadSemanticCloudFragments, toast]);

  useEffect(() => {
    if (tab !== 'cloud') return;
    loadInterviewCloudOverview();
  }, [loadInterviewCloudOverview, tab]);

  useEffect(() => {
    if (tab !== 'cloud') return;
    if (!cloudState.parentId) return;
    loadInterviewCloudFolder(cloudState.parentId);
  }, [cloudState.parentId, loadInterviewCloudFolder, tab]);

  useEffect(() => {
    if (!nodeId) return;
    setTab('cloud');
    openDocumentReader({ id: nodeId });
  }, [nodeId, openDocumentReader]);

  useEffect(() => {
    if (tab !== 'cloud' || !nodeId) {
      setToolbarCollapsed(false);
      return;
    }
    const onScroll = () => setToolbarCollapsed(window.scrollY > 90);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [nodeId, tab]);

  useEffect(() => {
    if (tab !== 'semantic') return;
    loadSemanticCloudFragments();
  }, [loadSemanticCloudFragments, tab]);

  useEffect(() => {
    if (!highlightFragmentId) return undefined;
    const timer = setTimeout(() => setHighlightFragmentId(null), 1800);
    return () => clearTimeout(timer);
  }, [highlightFragmentId]);

  useEffect(() => {
    const fragmentIds = new Set((docReader.fragments || []).map((fragment) => String(fragment.id)));
    if (activeFragmentId && !fragmentIds.has(String(activeFragmentId))) setActiveFragmentId(null);
  }, [activeFragmentId, docReader.fragments]);

  const focusFragment = useCallback((fragmentId, origin = 'rail') => {
    const normalizedId = String(fragmentId);
    setActiveFragmentId(normalizedId);
    setHighlightFragmentId(normalizedId);

    if (origin === 'rail') {
      const docNode = documentFragmentRefs.current[normalizedId];
      docNode?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (origin === 'document') {
      const railNode = railFragmentRefs.current[normalizedId];
      railNode?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  const buildCodeLabelFromFragment = useCallback((title, description) => {
    const cleanTitle = String(title || '').trim();
    if (cleanTitle) return cleanTitle;

    const cleanDescription = String(description || '').trim().replace(/\s+/g, ' ');
    if (!cleanDescription) return 'Código derivado de fragmento';

    const words = cleanDescription.split(' ').filter(Boolean).slice(0, 6);
    const smartLabel = words.join(' ').trim();
    return smartLabel.length > 56 ? `${smartLabel.slice(0, 56).trimEnd()}…` : smartLabel;
  }, []);

  const buildUniqueCodeSlug = useCallback((label, options = []) => {
    const base = String(label || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_') || 'codigo_fragmento';

    const existing = new Set(options.map((option) => String(option.slug)));
    if (!existing.has(base)) return base;

    let idx = 2;
    while (existing.has(`${base}_${idx}`)) idx += 1;
    return `${base}_${idx}`;
  }, []);

  const openFragmentDetailModal = useCallback((fragmentId, origin = 'rail') => {
    const normalizedId = String(fragmentId);
    focusFragment(normalizedId, origin);

    const sourceFragment = (docReader.fragments || []).find((fragment) => String(fragment.id) === normalizedId);
    if (!sourceFragment) return;

    const persisted = fragmentDetailsById[normalizedId] || {};
    const fallbackInterviewId = String(sourceFragment.interview_session_id || sourceFragment.interview_id || docReader.document?.interview_id || '');
    const fallbackInterview = center.sessions.find((session) => String(session.id) === fallbackInterviewId);
    setFragmentDetailDraft({
      id: normalizedId,
      title: persisted.title || sourceFragment.title || '',
      description: persisted.description || sourceFragment.selected_text || '',
      clientId: String(persisted.clientId || fallbackInterview?.client_id || ''),
      linkedCode: persisted.linkedCode || '',
      interviewId: String(persisted.interviewId || fallbackInterviewId),
      evolvedToCode: Boolean(persisted.evolvedToCode),
    });
    setFragmentDetailModalOpen(true);
  }, [center.sessions, docReader.document?.interview_id, docReader.fragments, focusFragment, fragmentDetailsById]);

  const persistFragmentDetailDraft = useCallback(() => {
    if (!fragmentDetailDraft.id) return;
    const normalizedId = String(fragmentDetailDraft.id);
    setFragmentDetailsById((prev) => ({
      ...prev,
      [normalizedId]: {
        title: String(fragmentDetailDraft.title || '').trim(),
        description: String(fragmentDetailDraft.description || '').trim(),
        clientId: String(fragmentDetailDraft.clientId || '').trim(),
        linkedCode: String(fragmentDetailDraft.linkedCode || '').trim(),
        interviewId: String(fragmentDetailDraft.interviewId || '').trim(),
        evolvedToCode: Boolean(fragmentDetailDraft.evolvedToCode),
      },
    }));
    toast({ title: 'Fragmento actualizado', description: 'Se guardó el detalle del fragmento para su evolución.' });
  }, [fragmentDetailDraft, toast]);

  const evolveFragmentToCode = useCallback(() => {
    if (!fragmentDetailDraft.id) return;

    const normalizedId = String(fragmentDetailDraft.id);
    const previousLinkedCodes = [String(fragmentDetailDraft.linkedCode || '').trim()].filter(Boolean);

    const newCodeLabel = buildCodeLabelFromFragment(fragmentDetailDraft.title, fragmentDetailDraft.description);
    const newCodeSlug = buildUniqueCodeSlug(newCodeLabel, fragmentEvolutionCodeOptions);
    const createdCode = { slug: newCodeSlug, label: newCodeLabel };

    setFragmentEvolutionCodeOptions((prev) => {
      if (prev.some((option) => option.slug === createdCode.slug)) return prev;
      return [...prev, createdCode];
    });

    try {
      const rawWorkspace = window.localStorage.getItem(semanticWorkspaceStorageKey);
      const parsedWorkspace = rawWorkspace ? JSON.parse(rawWorkspace) : {};
      const currentCustomCodebook = Array.isArray(parsedWorkspace.customCodebook) ? parsedWorkspace.customCodebook : [];
      const currentAssignments = parsedWorkspace.codeAssignments && typeof parsedWorkspace.codeAssignments === 'object' ? parsedWorkspace.codeAssignments : {};

      const nextCustomCodebook = currentCustomCodebook.some((code) => String(code.slug) === createdCode.slug)
        ? currentCustomCodebook
        : [...currentCustomCodebook, {
          slug: createdCode.slug,
          name: createdCode.label,
          category: 'interpretacion',
          description: `Código evolucionado desde fragmento ${normalizedId}.`,
        }];

      const nextWorkspace = {
        ...parsedWorkspace,
        customCodebook: nextCustomCodebook,
        codeAssignments: {
          ...currentAssignments,
          [normalizedId]: [createdCode.slug],
        },
      };

      window.localStorage.setItem(semanticWorkspaceStorageKey, JSON.stringify(nextWorkspace));
    } catch {
      // Keep UI flow resilient even if localStorage is unavailable.
    }

    const nextDraft = {
      ...fragmentDetailDraft,
      title: String(fragmentDetailDraft.title || '').trim(),
      description: String(fragmentDetailDraft.description || '').trim(),
      linkedCode: createdCode.slug,
      evolvedToCode: true,
    };

    setFragmentDetailDraft(nextDraft);
    setFragmentDetailsById((prev) => ({
      ...prev,
      [normalizedId]: {
        title: nextDraft.title,
        description: nextDraft.description,
        linkedCode: createdCode.slug,
        evolvedToCode: true,
      },
    }));

    const unlinkNote = previousLinkedCodes.length
      ? ` Se desvincularon ${previousLinkedCodes.length} código(s) previo(s).`
      : '';

    toast({ title: 'Fragmento evolucionado', description: `Se creó el código ${createdCode.label}, se agregó al codebook y quedó como única vinculación.${unlinkNote}` });
  }, [buildCodeLabelFromFragment, buildUniqueCodeSlug, fragmentDetailDraft, fragmentEvolutionCodeOptions, toast]);


  useEffect(() => {
    if (!manualFragmentModalOpen) return;
    setDocReader((prev) => {
      if (prev.manualClientId && prev.manualInterviewId) return prev;
      const fallbackInterviewId = String(prev.document?.interview_id || '');
      const fallbackInterview = center.sessions.find((session) => String(session.id) === fallbackInterviewId);
      return { ...prev, manualClientId: String(fallbackInterview?.client_id || ''), manualInterviewId: fallbackInterviewId };
    });
  }, [center.sessions, manualFragmentModalOpen]);


  useEffect(() => {
    if (!cloudFilters.clientId || !cloudFilters.interviewId) return;
    const isValid = cloudInterviewOptions.some((session) => String(session.id) === String(cloudFilters.interviewId));
    if (!isValid) {
      setCloudFilters((prev) => ({ ...prev, interviewId: '' }));
    }
  }, [cloudFilters.clientId, cloudFilters.interviewId, cloudInterviewOptions]);

  const announcePendingTool = useCallback((label) => {
    toast({ title: label, description: 'Herramienta preparada para próxima fase.' });
  }, [toast]);

  const createSemanticInterviewFragment = useCallback(async ({ interview_id, text, source = 'selection', title = '', linkedCode = '', client_id = '' }) => {
    const trimmed = String(text || '').trim();
    if (!interview_id || !trimmed) return;
    try {
      const created = await interviewsModuleApi.createDocumentFragment({
        interview_session_id: interview_id,
        selected_text: trimmed,
        source_type: source === 'manual' ? 'manual' : 'selection',
      });
      if (created?.id && (title || linkedCode || client_id || interview_id)) {
        setFragmentDetailsById((prev) => ({
          ...prev,
          [String(created.id)]: {
            ...(prev[String(created.id)] || {}),
            title: String(title || '').trim(),
            description: trimmed,
            clientId: String(client_id || ''),
            interviewId: String(interview_id || ''),
            linkedCode: String(linkedCode || '').trim(),
            evolvedToCode: Boolean(prev[String(created.id)]?.evolvedToCode),
          },
        }));
      }
      await loadSemanticCloudFragments();
      toast({ title: 'Fragmento registrado', description: 'Se guardó en la entidad única de fragmentos.' });
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }, [loadSemanticCloudFragments, toast]);

  return (
    <>
      <Helmet><title>Centro de Entrevistas</title></Helmet>
      <InterviewModuleShell
        projectId={projectId}
        campaignId={campaignId}
        activeTab={tab}
        onTabChange={setTab}
        onOpenRun={() => setRunModalOpen(true)}
        onOpenForm={openCreateForm}
        onOpenClient={() => setClientModalOpen(true)}
      >
        {center.loading && <div className="bg-white border rounded-xl p-6">Cargando...</div>}
        {center.error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">{center.error}</div>}

        {!center.loading && !center.error && tab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-4 gap-3">
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Total clientes</p><p className="text-2xl font-bold">{center.kpis.totalClients}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Total entrevistas</p><p className="text-2xl font-bold">{center.kpis.totalSessions}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Formularios activos</p><p className="text-2xl font-bold">{center.kpis.activeForms}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Top audiencias</p>{center.kpis.topAudience.map(([name, count]) => <p key={name} className="text-sm">{name}: {count}</p>)}</div>
            </div>
            <div className="bg-white border rounded-xl p-4 space-y-2">
              <h3 className="font-semibold">Últimas entrevistas</h3>
              {center.kpis.recentSessions.length ? center.kpis.recentSessions.map((session) => <button key={session.id} className="w-full text-left border rounded p-2 hover:bg-slate-50" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>{session.client_name} · {session.form_title}</button>) : <p className="text-sm text-slate-500">Todavía no hay entrevistas.</p>}
            </div>
          </div>
        )}

        {!center.loading && !center.error && tab === 'clients' && (
          <div className="space-y-3">
            <div className="bg-white border rounded-2xl p-3 grid md:grid-cols-4 gap-2">
              <input className="border rounded-xl p-2" placeholder="Buscar cliente" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
              <select className="border rounded-xl p-2" value={clientAudienceFilter} onChange={(e) => setClientAudienceFilter(e.target.value)}>
                <option value="">Todas las audiencias</option>
                {center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}
              </select>
              <select className="border rounded-xl p-2" value={clientSort} onChange={(e) => setClientSort(e.target.value)}>
                <option value="last_interview_desc">Última entrevista (reciente)</option>
                <option value="last_interview_asc">Última entrevista (antigua)</option>
                <option value="name_asc">Nombre (A-Z)</option>
                <option value="name_desc">Nombre (Z-A)</option>
              </select>
              <Button className="bg-indigo-600 text-white" onClick={() => setClientModalOpen(true)}>Crear cliente</Button>
            </div>

            {!visibleClients.length ? <EmptyState title="No hay clientes" description="Crea tu primer cliente para iniciar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={() => setClientModalOpen(true)}>Crear cliente</Button>} /> : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <p className="col-span-4">Cliente</p>
                  <p className="col-span-2">Entrevistas</p>
                  <p className="col-span-2">Score problema</p>
                  <p className="col-span-2">Score solución</p>
                  <p className="col-span-2 text-right">Acciones</p>
                </div>
                {visibleClients.map((client) => (
                  <div
                    key={client.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedClientId(client.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedClientId(client.id); } }}
                    className={`group relative grid grid-cols-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-within:ring-2 focus-within:ring-indigo-200 cursor-pointer ${clientActionsMenuId === client.id ? 'z-20' : ''}`}
                  >
                    <div className="col-span-4 min-w-0">
                      <p className="text-[16px] font-semibold text-slate-900 truncate">{client.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{client.audience_name || 'Sin audiencia'}</span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">{client.contact || 'Sin contacto'}</span>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{client.interviewsCount} entrevistas</span>
                    </div>

                    <div className="col-span-2">
                      <span className={`inline-flex min-w-[92px] justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getClientScoreTone(client.aggregateProblemScore, 'problem')}`}>
                        {client.aggregateProblemScore ?? 'Sin evaluación'}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <span className={`inline-flex min-w-[92px] justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getClientScoreTone(client.aggregateSolutionScore, 'solution')}`}>
                        {client.aggregateSolutionScore ?? 'Sin evaluación'}
                      </span>
                    </div>

                    <div className="col-span-2 relative flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      <div className="hidden items-center gap-1 group-hover:flex">
                        <Button size="sm" className="h-7 bg-white border text-slate-700 hover:bg-slate-50" onClick={() => setSelectedClientId(client.id)}>Ver ficha</Button>
                        <Button size="sm" className="h-7 bg-white border text-slate-700 hover:bg-slate-50" onClick={() => { setRunInterviewPrefill({ clientId: client.id, audienceId: client.audience_id || null }); setRunModalOpen(true); }}>Entrevistar</Button>
                        <Button size="sm" className="h-7 bg-white border text-slate-700 hover:bg-slate-50" onClick={() => openClientEditor(client)}>Editar</Button>
                      </div>
                      <Button className="bg-white border" title="Acciones" onClick={() => setClientActionsMenuId((prev) => (prev === client.id ? null : client.id))}>⋮</Button>
                      {clientActionsMenuId === client.id && (
                        <div className="absolute right-0 top-10 z-30 w-44 bg-white border rounded-xl shadow-md p-1">
                          <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { openClientEditor(client); setClientActionsMenuId(null); }}>Editar</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { setRunInterviewPrefill({ clientId: client.id, audienceId: client.audience_id || null }); setRunModalOpen(true); setClientActionsMenuId(null); }}>Entrevistar</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded text-amber-700 hover:bg-amber-50" onClick={() => { center.runMutation(() => interviewsModuleApi.updateClient(client.id, { ...client, status: client.status === 'archived' ? 'active' : 'archived' }), client.status === 'archived' ? 'Cliente reactivado' : 'Cliente archivado'); setClientActionsMenuId(null); }}>{client.status === 'archived' ? 'Reactivar' : 'Archivar'}</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded text-red-700 hover:bg-red-50" onClick={() => { center.runMutation(() => interviewsModuleApi.deleteClient(client.id), 'Cliente eliminado'); setClientActionsMenuId(null); }}>Borrar</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!center.loading && !center.error && tab === 'forms' && (
          <div className="space-y-3">
            {formEditorOpen ? (
              <FormBuilder
                draft={formDraft}
                setDraft={setFormDraft}
                activeQuestionId={activeQuestionId}
                setActiveQuestionId={setActiveQuestionId}
                onSave={async () => {
                  setFormSaveStatus('saving');
                  const snapshot = { ...formDraft, questions: formDraft.questions || [] };
                  try {
                    const saved = snapshot.id
                      ? await interviewsModuleApi.updateForm(snapshot.id, snapshot)
                      : await interviewsModuleApi.createForm(projectId, campaignId, snapshot);
                    const committed = { ...snapshot, id: saved.id, status: saved.status, updated_at: saved.updated_at };
                    setFormDraft((prev) => ({ ...prev, id: saved.id, status: saved.status, updated_at: saved.updated_at }));
                    lastSavedRef.current = JSON.stringify(committed);
                    autosaveSeqRef.current += 1;
                    setFormSaveStatus('saved');
                    setFormSaveError('');
                    toast({ title: 'Formulario guardado' });
                    await reload();
                  } catch (error) {
                    setFormSaveStatus('error');
                    setFormSaveError(error.message);
                    toast({ title: 'Error', description: error.message, variant: 'destructive' });
                  }
                }}
                onClose={() => {
                  setFormEditorOpen(false);
                  setFormPreview(false);
                  setFormDraft(createEmptyFormDraft());
                  setActiveQuestionId(null);
                  setFormSaveStatus('saved');
                  setFormSaveError('');
                }}
                saveStatus={formSaveStatus}
                saveError={formSaveError}
                preview={formPreview}
                setPreview={setFormPreview}
              />
            ) : (
              <>
                <div className="flex justify-end"><Button className="bg-indigo-600 text-white" onClick={openCreateForm}>Crear formulario</Button></div>
                {!center.forms.length ? <EmptyState title="No hay formularios" description="Crea un formulario para ejecutar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={openCreateForm}>Crear formulario</Button>} /> : (
                  <div className="space-y-2">
                    {center.forms.map((form) => {
                      const isActive = (form.status || 'active') === 'active';
                      const hasDescription = Boolean(form.description?.trim());

                      return (
                        <div
                          key={form.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openEditForm(form)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEditForm(form); } }}
                          className="group bg-white border border-slate-200 rounded-2xl px-4 py-4 transition-all duration-150 hover:border-slate-300 hover:shadow-sm focus-within:ring-2 focus-within:ring-indigo-200"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              <p className="text-sm font-semibold text-slate-900 truncate">{form.title || 'Formulario sin título'}</p>
                              <p className="text-sm text-slate-500 line-clamp-2">{hasDescription ? form.description : 'Sin descripción'}</p>
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">{form.questions?.length || 0} preguntas</span>
                                <span className={`text-xs px-2 py-1 rounded-full border ${isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>{isActive ? 'activo' : 'inactivo'}</span>
                                {!hasDescription && <span className="text-xs px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">sin descripción</span>}
                              </div>
                            </div>

                            <div className="relative shrink-0 flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150" onClick={(event) => event.stopPropagation()}>
                              <Button className="bg-white border" onClick={() => openEditForm(form)}>Editar</Button>
                              <Button className="bg-white border" title="Acciones" onClick={() => setFormsMenuOpenId((prev) => (prev === form.id ? null : form.id))}>⋮</Button>

                              {formsMenuOpenId === form.id && (
                                <div className="absolute right-0 top-10 z-30 w-44 bg-white border rounded-xl shadow-md p-1">
                                  <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { openEditForm(form); setFormsMenuOpenId(null); }}>Editar</button>
                                  <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={async () => {
                                    const clone = { title: `${form.title} (copia)`, description: form.description, questions: form.questions };
                                    const created = await interviewsModuleApi.createForm(projectId, campaignId, clone);
                                    await reload();
                                    openEditForm(created);
                                    setFormsMenuOpenId(null);
                                    toast({ title: 'Formulario duplicado' });
                                  }}>Duplicar</button>
                                  <button className="w-full text-left text-sm px-3 py-2 rounded text-red-700 hover:bg-red-50" onClick={async () => {
                                    if (!window.confirm('¿Borrar formulario?')) return;
                                    await center.runMutation(() => interviewsModuleApi.deleteForm(form.id), 'Formulario eliminado');
                                    setFormsMenuOpenId(null);
                                  }}>Borrar</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!center.loading && !center.error && tab === 'hypotheses' && (
          <div className="space-y-2">
            <div className="bg-white border rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-900">Nueva ficha de hipótesis</h4>

              <div className="grid gap-2 md:grid-cols-4">
                <input className="border rounded p-2 md:col-span-2" placeholder="Nombre de hipótesis" value={hypDraft.title} onChange={(e) => setHypDraft((prev) => ({ ...prev, title: e.target.value }))} />
                <select className="border rounded p-2" value={hypDraft.type} onChange={(e) => setHypDraft((prev) => ({ ...prev, type: e.target.value, parent_hypothesis_id: '' }))}>{interviewHypothesisTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                <select className="border rounded p-2" value={hypDraft.status} onChange={(e) => setHypDraft((prev) => ({ ...prev, status: e.target.value }))}><option value="exploracion">exploración</option><option value="en_prueba">en prueba</option><option value="validada">validada</option><option value="refutada">refutada</option></select>
                <textarea className="border rounded p-2 md:col-span-4" rows={2} placeholder="Descripción" value={hypDraft.description} onChange={(e) => setHypDraft((prev) => ({ ...prev, description: e.target.value }))} />
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <select className="border rounded p-2" value={hypDraft.parent_hypothesis_id} onChange={(e) => setHypDraft((prev) => ({ ...prev, parent_hypothesis_id: e.target.value }))} disabled={!interviewParentTypeByChild[normalizeInterviewHypothesisType(hypDraft.type)]}>
                  <option value="">{interviewParentTypeByChild[normalizeInterviewHypothesisType(hypDraft.type)] ? 'Sin padre' : 'Este tipo no admite padre'}</option>
                  {buildInterviewAllowedParents(hypDraft.type).map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title} · {interviewHypothesisTypeLabel(hypothesis.type)}</option>)}
                </select>
                <select className="border rounded p-2" value={hypDraft.audience_id} onChange={(e) => setHypDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia objetivo</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
                <input className="border rounded p-2" placeholder="Segmento" value={hypDraft.segment} onChange={(e) => setHypDraft((prev) => ({ ...prev, segment: e.target.value }))} />
                <select className="border rounded p-2" value={hypDraft.related_client_id} onChange={(e) => setHypDraft((prev) => ({ ...prev, related_client_id: e.target.value }))}><option value="">Cliente relacionado</option>{center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
                <select className="border rounded p-2" value={hypDraft.interview_form_id} onChange={(e) => setHypDraft((prev) => ({ ...prev, interview_form_id: e.target.value }))}><option value="">Formulario asociado</option>{center.forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}</select>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <input className="border rounded p-2" type="number" min="1" placeholder="Min entrevistas" value={hypDraft.min_interviews} onChange={(e) => setHypDraft((prev) => ({ ...prev, min_interviews: e.target.value }))} />
                <select
                  className="border rounded p-2"
                  value={hypDraft.validation_metric_config.comparison_operator}
                  onChange={(e) => setHypDraft((prev) => ({
                    ...prev,
                    validation_metric_config: { ...prev.validation_metric_config, comparison_operator: e.target.value },
                  }))}
                >
                  <option value=">=">Promedio métricas ≥ umbral</option>
                  <option value=">">Promedio métricas &gt; umbral</option>
                  <option value="<=">Promedio métricas ≤ umbral</option>
                  <option value="<">Promedio métricas &lt; umbral</option>
                </select>
                <input
                  className="border rounded p-2"
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  placeholder="Umbral"
                  value={hypDraft.validation_metric_config.threshold_value}
                  onChange={(e) => setHypDraft((prev) => ({
                    ...prev,
                    validation_metric_config: { ...prev.validation_metric_config, threshold_value: e.target.value },
                  }))}
                />
                <select
                  className="border rounded p-2"
                  value={hypDraft.validation_metric_config.outcome_if_true}
                  onChange={(e) => setHypDraft((prev) => ({
                    ...prev,
                    validation_metric_config: { ...prev.validation_metric_config, outcome_if_true: e.target.value },
                  }))}
                >
                  <option value="validada">Si cumple → validada</option>
                  <option value="refutada">Si cumple → refutada</option>
                  <option value="señal fuerte">Si cumple → señal fuerte</option>
                  <option value="señal moderada">Si cumple → señal moderada</option>
                  <option value="señal débil">Si cumple → señal débil</option>
                </select>
                <select
                  className="border rounded p-2"
                  value={hypDraft.validation_metric_config.outcome_if_false}
                  onChange={(e) => setHypDraft((prev) => ({
                    ...prev,
                    validation_metric_config: { ...prev.validation_metric_config, outcome_if_false: e.target.value },
                  }))}
                >
                  <option value="refutada">Si no cumple → refutada</option>
                  <option value="validada">Si no cumple → validada</option>
                  <option value="señal fuerte">Si no cumple → señal fuerte</option>
                  <option value="señal moderada">Si no cumple → señal moderada</option>
                  <option value="señal débil">Si no cumple → señal débil</option>
                  <option value="no evaluada">Si no cumple → no evaluada</option>
                </select>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Métrica independiente Y</p>
                <p className="text-xs text-slate-600">Selecciona únicamente las métricas que realmente validarán esta hipótesis.</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {hypothesisMetricOptions.map((metric) => {
                    const active = hypDraft.validation_metric_config.selected_metrics.includes(metric.value);
                    return (
                      <label key={metric.value} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(event) => setHypDraft((prev) => {
                            const current = prev.validation_metric_config.selected_metrics || [];
                            const next = event.target.checked
                              ? [...new Set([...current, metric.value])]
                              : current.filter((item) => item !== metric.value);
                            return {
                              ...prev,
                              validation_metric_config: { ...prev.validation_metric_config, selected_metrics: next },
                            };
                          })}
                        />
                        <span>{metric.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <textarea className="border rounded p-2" rows={2} placeholder="Notas del experimento" value={hypDraft.experiment_notes} onChange={(e) => setHypDraft((prev) => ({ ...prev, experiment_notes: e.target.value }))} />
                <textarea className="border rounded p-2" rows={2} placeholder="Observaciones" value={hypDraft.observations} onChange={(e) => setHypDraft((prev) => ({ ...prev, observations: e.target.value }))} />
                <textarea className="border rounded p-2" rows={2} placeholder="Próximas acciones" value={hypDraft.next_actions} onChange={(e) => setHypDraft((prev) => ({ ...prev, next_actions: e.target.value }))} />
              </div>

              <div className="flex justify-end gap-2">
                <Button className="bg-white border" onClick={() => setHypDraft(createBlankHypothesisDraft())}>Limpiar</Button>
                <Button
                  className="bg-indigo-600 text-white"
                  onClick={() => center.runMutation(async () => {
                    const payload = buildHypothesisPayload(hypDraft);
                    if (!payload) throw new Error('La hipótesis debe respetar la cadena problema → segmento → mensajes → solucion → producto.');
                    const created = await interviewsModuleApi.createHypothesis(projectId, campaignId, payload);
                    setHypDraft(createBlankHypothesisDraft());
                    return created;
                  }, 'Hipótesis creada')}
                >
                  Guardar ficha
                </Button>
              </div>
            </div>
            {center.hypotheses.map((hypothesis) => {
              const parentHypothesis = interviewHypothesisById.get(getInterviewParentHypothesisId(hypothesis)) || null;
              const childHypotheses = interviewChildHypothesesByParentId.get(String(hypothesis.id)) || [];
              return (
              <div key={hypothesis.id} className="bg-white border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{hypothesis.title}</p>
                    <p className="text-sm text-slate-500">{interviewHypothesisTypeLabel(hypothesis.type)} · {hypothesis.status || 'exploracion'} · {hypothesis.audience_name || 'Sin audiencia'}</p>
                    <p className="mt-1 text-xs text-slate-500">Padre: {parentHypothesis ? parentHypothesis.title : 'Sin padre'} · Hijas: {childHypotheses.length} · Capa hija permitida: {interviewChildTypeByParent[normalizeInterviewHypothesisType(hypothesis.type)] ? interviewHypothesisTypeLabel(interviewChildTypeByParent[normalizeInterviewHypothesisType(hypothesis.type)]) : 'No admite hijas'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="bg-indigo-600 text-white"
                      onClick={() => center.runMutation(() => interviewsModuleApi.evaluateHypothesis(hypothesis.id), 'Hipótesis evaluada')}
                    >
                      Evaluar hipótesis
                    </Button>
                    <Button className="bg-white border" onClick={() => openEditHypothesis(hypothesis)}>Editar</Button>
                    <Button className="bg-red-50 border text-red-700" onClick={() => center.runMutation(() => interviewsModuleApi.deleteHypothesis(hypothesis.id), 'Hipótesis eliminada')}>Borrar</Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Relación jerárquica: {parentHypothesis ? `${parentHypothesis.title} → ${hypothesis.title}` : 'Hipótesis raíz de la cadena'} · Hijas: {childHypotheses.length ? childHypotheses.map((child) => child.title).join(' · ') : 'Sin hijas'}.</div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Sección 1 · Información general</p>
                    <p className="mt-1 text-sm text-slate-700">{hypothesis.description || 'Sin descripción'}</p>
                    <p className="mt-1 text-xs text-slate-500">Segmento: {hypothesis.segment || '—'} · Cliente: {hypothesis.related_client_name || '—'} · Formulario: {hypothesis.interview_form_title || '—'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Sección 2 · Configuración de validación</p>
                    <p className="mt-1 text-xs text-slate-600">Min entrevistas: {hypothesis.min_interviews ?? '—'}</p>
                    <p className="text-xs text-slate-600">Métricas: {(hypothesis.validation_metric_config?.selected_metrics || []).map((metric) => hypothesisMetricLabelByValue[metric] || metric).join(', ') || '—'}</p>
                    <p className="text-xs text-slate-600">Regla: promedio métricas {hypothesis.validation_metric_config?.comparison_operator || '≥'} {hypothesis.validation_metric_config?.threshold_value ?? '—'}</p>
                    <p className="text-xs text-slate-600">Resultado: cumple → {hypothesis.validation_metric_config?.outcome_if_true || 'validada'} · no cumple → {hypothesis.validation_metric_config?.outcome_if_false || 'refutada'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Sección 3 · Resultados (preparado para 14.1)</p>
                    <p className="mt-1 text-xs text-slate-600">Entrevistas evaluadas: {hypothesis.evaluated_interviews_count ?? '—'} · Avg problema: {hypothesis.problem_score_avg ?? '—'} · Avg solución: {hypothesis.solution_score_avg ?? '—'}</p>
                    <p className="text-xs text-slate-600">Última evaluación: {hypothesis.last_evaluated_at ? new Date(hypothesis.last_evaluated_at).toLocaleString() : '—'}</p>
                    <div className="mt-1">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${validationToneByResult[hypothesis.validation_result || 'no evaluada'] || validationToneByResult['no evaluada']}`}>{hypothesis.validation_result || 'no evaluada'}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{hypothesis.validation_summary || 'Sin resumen de validación aún.'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Sección 4 · Notas del experimento</p>
                    <p className="mt-1 text-xs text-slate-600">Notas: {hypothesis.experiment_notes || '—'}</p>
                    <p className="text-xs text-slate-600">Observaciones: {hypothesis.observations || '—'}</p>
                    <p className="text-xs text-slate-600">Siguientes acciones: {hypothesis.next_actions || '—'}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase text-slate-500">Detalle de regla activa</p>
                  {(() => {
                    const ruleStatus = getHypothesisRuleStatus(hypothesis);
                    if (!ruleStatus.configured) {
                      return <p className="mt-2 text-xs text-slate-600">No hay regla configurada.</p>;
                    }
                    return (
                      <div className="mt-2 space-y-1 text-xs text-slate-700">
                        <p>Métricas evaluadas: {ruleStatus.selectedMetrics.map((metric) => hypothesisMetricLabelByValue[metric] || metric).join(', ')}</p>
                        <p>Promedio actual: {ruleStatus.comparisonValue ?? '—'} · Umbral: {ruleStatus.threshold}</p>
                        <p>Estado: {ruleStatus.passed ? 'Cumple regla' : 'No cumple regla'}</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {!center.loading && !center.error && tab === 'sessions' && (
          <div className="space-y-3">
            <div className="bg-white border rounded-xl p-3 grid md:grid-cols-5 gap-2">
              <select className="border rounded p-2" value={sessionFilter.audience_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.client_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, client_id: e.target.value }))}><option value="">Cliente</option>{center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.form_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, form_id: e.target.value }))}><option value="">Formulario</option>{center.forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}</select>
              <input className="border rounded p-2" type="date" value={sessionFilter.from} onChange={(e) => setSessionFilter((prev) => ({ ...prev, from: e.target.value }))} />
              <input className="border rounded p-2" type="date" value={sessionFilter.to} onChange={(e) => setSessionFilter((prev) => ({ ...prev, to: e.target.value }))} />
            </div>
            {!filteredSessions.length ? <EmptyState title="No hay entrevistas" description="Inicia una entrevista para ver sesiones aquí." action={<Button className="bg-indigo-600 text-white" onClick={() => setRunModalOpen(true)}>Realizar entrevista</Button>} /> : (
              <div className="space-y-2">
                <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <p>Cliente — Formulario</p>
                  <p>Audiencia • Fecha • Hora</p>
                  <p className="text-right">Análisis</p>
                </div>
                {filteredSessions.map((session) => {
                  const leanScore = getLeanScore(session.responses_json?.__lean_evaluation || {});
                  const isDraft = String(session.status || '').toLowerCase() === 'draft';
                  const detailUrl = `/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`;
                  return (
                    <button
                      key={session.id}
                      className="group w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      onClick={() => navigate(detailUrl)}
                    >
                      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-center gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{session.client_name || 'Sin cliente'}</p>
                          <p className="text-sm font-medium text-slate-600">{session.form_title || 'Sin formulario'}</p>
                        </div>

                        <p className="text-xs text-slate-500">{session.audience_name || 'Sin audiencia'} • {new Date(session.created_at).toLocaleDateString()} • {new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>

                        <div className="flex items-center justify-end gap-2">
                          {leanScore != null ? (
                            <span className="inline-flex min-w-[76px] justify-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">Lean {leanScore}</span>
                          ) : (
                            <span className="inline-flex min-w-[76px] justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">Sin score</span>
                          )}
                          <div className="hidden items-center gap-1 group-hover:flex" onClick={(event) => event.stopPropagation()}>
                            <Button size="sm" className="h-7 bg-white border text-slate-700 hover:bg-slate-50" onClick={() => navigate(detailUrl)}>Abrir</Button>
                            <Button size="sm" className="h-7 bg-white border text-slate-700 hover:bg-slate-50" onClick={() => navigate(detailUrl)}>{isDraft ? 'Continuar' : 'Ver evaluación'}</Button>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {!center.loading && !center.error && tab === 'cloud' && (
          <section className="space-y-4">
            <div className={`rounded-2xl border bg-white p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${nodeId ? "hidden" : ""}`}>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Cloud de investigación cualitativa</h3>
                <p className="text-sm text-slate-600">Espacio documental independiente para audiencias, entrevistas, hipótesis y evidencia primaria.</p>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-indigo-600 text-white cursor-pointer text-sm">
                Subir archivo
                <input type="file" multiple className="hidden" onChange={uploadInterviewCloudFiles} />
              </label>
            </div>

            <div className={`grid gap-3 md:grid-cols-3 ${nodeId ? "hidden" : ""}`}>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-slate-500">Audiencias</p>
                <p className="text-xl font-semibold">{cloudState.overview?.audiences?.length || 0}</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-slate-500">Entrevistas</p>
                <p className="text-xl font-semibold">{cloudState.overview?.interviews?.length || 0}</p>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <p className="text-xs text-slate-500">Hipótesis de entrevistas</p>
                <p className="text-xl font-semibold">{cloudState.overview?.hypotheses?.length || 0}</p>
              </div>
            </div>

            <div className={`rounded-2xl border bg-white p-4 space-y-3 ${nodeId ? "hidden" : ""}`}>
              <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                {(cloudState.breadcrumbs || []).map((crumb, idx) => (
                  <button key={crumb.id} className="hover:underline" onClick={() => loadInterviewCloudFolder(crumb.id)}>
                    {idx ? ' / ' : ''}{crumb.name}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={cloudFilters.clientId}
                    onChange={(event) => setCloudFilters((prev) => ({ ...prev, clientId: event.target.value, interviewId: '' }))}
                  >
                    <option value="">Filtrar por cliente…</option>
                    {center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={cloudFilters.interviewId}
                    onChange={(event) => setCloudFilters((prev) => ({ ...prev, interviewId: event.target.value }))}
                  >
                    <option value="">Filtrar por entrevista…</option>
                    {cloudInterviewOptions.map((session) => (
                      <option key={session.id} value={session.id}>{session.interviewer_name || 'Entrevista'} · {session.created_at ? new Date(session.created_at).toLocaleDateString() : 'Sin fecha'}</option>
                    ))}
                  </select>
                  <Button
                    className="bg-white border text-slate-700"
                    onClick={() => setCloudFilters({ clientId: '', interviewId: '' })}
                    disabled={!cloudFilters.clientId && !cloudFilters.interviewId}
                  >
                    Limpiar filtros
                  </Button>
                </div>
              </div>

              {cloudState.error ? <p className="text-sm text-red-600">{cloudState.error}</p> : null}
              {cloudState.loading ? <p className="text-sm text-slate-500">Cargando cloud...</p> : null}
              <div className="space-y-2">
                {filteredCloudItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                    <button
                      className="flex items-center gap-2 text-left"
                      onClick={() => {
                        if (item.kind === 'file') {
                          navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/cloud/${item.id}`);
                          return;
                        }
                        if (item.targetType === 'interview_session') {
                          const interviewId = String(item.targetEntityId || '');
                          const interview = center.sessions.find((session) => String(session.id) === interviewId);
                          setCloudNodeContextById((prev) => ({
                            ...prev,
                            [String(item.targetId || item.id)]: { interviewId, clientId: String(interview?.client_id || '') },
                          }));
                        }
                        loadInterviewCloudFolder(item.targetId || item.id);
                      }}
                    >
                      {item.kind === 'folder' || item.kind === 'shortcut' ? <FolderOpen className="h-4 w-4 text-indigo-600" /> : <FileText className="h-4 w-4 text-slate-500" />}
                      <span className="font-medium text-slate-800">{item.name}</span>
                      {String(item.name || '').toLowerCase().includes('audio') ? <Headphones className="h-4 w-4 text-emerald-600" /> : null}
                    </button>
                    {item.kind === 'file' ? <a className="text-slate-500 hover:text-slate-900" href={`${apiBaseUrl}/api/cloud/download?nodeId=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a> : null}
                  </div>
                ))}
                {!cloudState.loading && !filteredCloudItems.length ? (
                  <div className="rounded-lg border border-dashed p-3 text-sm text-slate-500">
                    No hay elementos para los filtros seleccionados en esta ubicación.
                  </div>
                ) : null}
              </div>
            </div>

            {!nodeId ? (
              <div className="space-y-4">
                <div className="rounded-xl border bg-white p-3">
                  <p className="text-sm text-slate-600">Selecciona un documento para abrirlo en una página dedicada del lector.</p>
                </div>
              </div>
            ) : null}

            {nodeId ? (
              <div className="space-y-4">
                <div className="rounded-2xl border bg-[#f8fafc] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900">Lector de documento</h4>
                      <p className="text-xs text-slate-500">Lectura enriquecida para transcripción (.doc/.docx/txt) con extracción de fragmentos.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {docReader.document?.warning ? <span className="text-xs text-amber-700">{docReader.document.warning}</span> : null}
                    </div>
                  </div>
                  <Toolbar
                    collapsed={toolbarCollapsed}
                    onBackToCloud={() => {
                      setDocSelectionMenu((prev) => ({ ...prev, open: false }));
                      navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`);
                    }}
                    onDownloadDocument={() => {
                      const node = docReader.document?.node_id;
                      if (!node) return;
                      window.open(`${apiBaseUrl}/api/cloud/download?nodeId=${encodeURIComponent(node)}`, '_blank', 'noopener,noreferrer');
                    }}
                    onCreateFragment={createSelectionFragment}
                    onCreateManualFragment={() => setManualFragmentModalOpen(true)}
                    onViewFragments={() => fragmentsRailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    onViewCodes={() => announcePendingTool('Ver códigos')}
                    onLinkCode={() => announcePendingTool('Vincular código')}
                    onViewClusters={() => announcePendingTool('Ver clusters')}
                    onActivateAnalysis={() => announcePendingTool('Activar técnicas de análisis')}
                    onCreateMemo={() => {
                      setDocReader((prev) => ({ ...prev, manualText: prev.manualText || `Memo ${new Date().toLocaleString()}: ` }));
                      setManualFragmentModalOpen(true);
                    }}
                    onToggleView={() => setReaderViewMode((prev) => (prev === 'document' ? 'focus' : 'document'))}
                    canCreateFragment={Boolean(docReader.selectionText)}
                    viewLabel={readerViewMode === 'focus' ? 'focus' : 'documento'}
                  />
                  {docReader.loading ? <p className="text-sm text-slate-500">Abriendo documento...</p> : null}
                  {docReader.error ? <p className="text-sm text-red-600">{docReader.error}</p> : null}
                  {docReader.document ? (
                    <>
                      <div className="mx-auto w-full max-w-6xl">
                        <div className="relative pr-[196px]">
                          <div
                            ref={documentReaderRef}
                            className={`min-h-[320px] rounded-xl border bg-white ${readerViewMode === "focus" ? "px-16 py-12 text-[16px] leading-8" : "px-12 py-10 text-[15px] leading-7"} text-slate-800 shadow-sm whitespace-pre-wrap`}
                            onMouseUp={captureSelection}
                            onContextMenu={openSelectionMenu}
                          >
                            {documentFragmentsSegments.length ? documentFragmentsSegments.map((segment, index) => {
                              if (segment.type === 'text') return <React.Fragment key={`seg-text-${index}`}>{segment.value}</React.Fragment>;

                              const fragmentId = String(segment.id);
                              const isActive = activeFragmentId === fragmentId;
                              const isHighlighted = highlightFragmentId === fragmentId;
                              return (
                                <span
                                  key={`seg-fragment-${fragmentId}-${index}`}
                                  ref={(node) => {
                                    if (node) documentFragmentRefs.current[fragmentId] = node;
                                    else delete documentFragmentRefs.current[fragmentId];
                                  }}
                                  className={`group mx-0.5 inline rounded-md border px-1 py-0.5 align-baseline transition ${isActive ? 'border-indigo-300 bg-indigo-50' : 'border-cyan-200 bg-cyan-50/70'} ${isHighlighted ? 'ring-2 ring-indigo-200' : ''}`}
                                >
                                  <button
                                    type="button"
                                    className={`mr-1 inline-flex h-5 min-w-5 items-center justify-center rounded text-[10px] font-semibold ${isActive ? 'bg-indigo-600 text-white' : 'bg-cyan-600 text-white'}`}
                                    title="Ir a cita enlazada"
                                    onClick={() => openFragmentDetailModal(fragmentId, 'document')}
                                  >
                                    ¶
                                  </button>
                                  <span className="cursor-pointer" onClick={() => openFragmentDetailModal(fragmentId, 'document')}>
                                    {segment.value}
                                  </span>
                                </span>
                              );
                            }) : (docReader.document.text || 'No se pudo renderizar texto de este documento.')}
                          </div>

                          <div
                            ref={fragmentsRailRef}
                            className="pointer-events-none absolute right-0 top-0 min-h-[320px] w-[188px]"
                            style={{ height: `${documentRailHeight}px` }}
                          >
                            {fragmentRailCards.map((card) => {
                              const fragmentId = card.id;
                              const fragment = card.fragment;
                              const isActive = activeFragmentId === fragmentId;
                              const isHighlighted = highlightFragmentId === fragmentId;
                              return (
                                <button
                                  key={fragment.id}
                                  type="button"
                                  ref={(node) => {
                                    if (node) railFragmentRefs.current[fragmentId] = node;
                                    else delete railFragmentRefs.current[fragmentId];
                                  }}
                                  onClick={() => openFragmentDetailModal(fragmentId, 'rail')}
                                  style={{ top: `${Math.max(0, card.topPx - 3)}px` }}
                                  className={`group pointer-events-auto absolute right-0 flex w-[176px] items-start gap-1.5 rounded-md border px-2 py-1.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-150 ${isActive ? 'border-indigo-300 bg-indigo-50/95' : 'border-slate-200/90 bg-white/95 hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50/90'} ${isHighlighted ? 'ring-1 ring-indigo-200' : ''}`}
                                >
                                  <span className={`mt-[1px] inline-flex h-3 w-3 shrink-0 rounded-full ${isActive ? 'bg-indigo-500' : 'bg-cyan-500 group-hover:bg-cyan-600'}`} />
                                  <span className="absolute -left-4 top-1/2 h-px w-3 -translate-y-1/2 rounded bg-slate-300/80" aria-hidden="true" />
                                  <span className="min-w-0">
                                    <span className={`block text-[9px] font-semibold uppercase tracking-[0.08em] ${isActive ? 'text-indigo-700' : 'text-slate-500 group-hover:text-slate-600'}`}>Cita</span>
                                    <span className={`mt-0.5 line-clamp-2 block text-[10px] leading-3.5 ${isActive ? 'text-indigo-900' : 'text-slate-700'}`}>{card.shortPreview}</span>
                                  </span>
                                </button>
                              );
                            })}
                            {!docReader.fragments?.length ? <p className="px-1 text-xs text-slate-500">Sin citas enlazadas.</p> : null}
                          </div>

                          <div className="mt-3 rounded-lg border bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selección actual</p>
                            <p className="mt-1 text-sm text-slate-700">{docReader.selectionText || 'Selecciona texto en el documento para crear fragmento.'}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <Button className="bg-indigo-600 text-white" onClick={createSelectionFragment} disabled={!docReader.selectionText}>Crear fragmento</Button>
                              <Button className="bg-white border" onClick={() => setManualFragmentModalOpen(true)}>Agregar manual</Button>
                              {docReader.selectionRange ? <span className="text-xs text-slate-500">rango {docReader.selectionRange.start_offset}-{docReader.selectionRange.end_offset}</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      {docSelectionMenu.open && docReader.selectionText ? (
                        <div
                          className="fixed z-50 w-56 rounded-xl border bg-white p-1 shadow-lg"
                          style={{ left: docSelectionMenu.x, top: docSelectionMenu.y }}
                        >
                          <button
                            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                            onClick={() => {
                              setDocReader((prev) => ({ ...prev, manualText: prev.selectionText || prev.manualText }));
                              setManualFragmentModalOpen(true);
                              setDocSelectionMenu((prev) => ({ ...prev, open: false }));
                            }}
                          >
                            Guardar fragmento manual
                          </button>
                          <button
                            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                            onClick={createSelectionFragment}
                          >
                            Agregar fragmento textutal
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        )}

        {!center.loading && !center.error && tab === 'semantic' && (
          <SemanticAnalysisLab
            sessions={center.sessions}
            audiences={center.audiences}
            forms={center.forms}
            clients={center.clients}
            hypotheses={center.hypotheses}
            persistedFragments={semanticCloudFragments}
            onOpenSession={(id) => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${id}`)}
            onCreateFragment={createSemanticInterviewFragment}
          />
        )}

        {!center.loading && !center.error && tab === 'quantitative' && (
          <QuantitativeAnalysisLab
            sessions={center.sessions}
            audiences={center.audiences}
            forms={center.forms}
            clients={center.clients}
            hypotheses={center.hypotheses}
            onOpenSession={(id) => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${id}`)}
          />
        )}
      </InterviewModuleShell>

      <Modal
        title="Editar ficha de hipótesis"
        open={hypothesisEditModalOpen}
        onClose={() => {
          setHypothesisEditModalOpen(false);
          setActiveHypothesisId('');
          setHypothesisEditDraft(createBlankHypothesisDraft());
        }}
      >
        <div className="grid gap-2 md:grid-cols-3">
          <input className="border rounded p-2 md:col-span-2" placeholder="Nombre de hipótesis" value={hypothesisEditDraft.title} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, title: e.target.value }))} />
          <select className="border rounded p-2" value={hypothesisEditDraft.type} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, type: e.target.value, parent_hypothesis_id: '' }))}>{interviewHypothesisTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <textarea className="border rounded p-2 md:col-span-3" rows={2} placeholder="Descripción" value={hypothesisEditDraft.description} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, description: e.target.value }))} />
          <select className="border rounded p-2" value={hypothesisEditDraft.parent_hypothesis_id || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, parent_hypothesis_id: e.target.value }))} disabled={!interviewParentTypeByChild[normalizeInterviewHypothesisType(hypothesisEditDraft.type)]}><option value="">{interviewParentTypeByChild[normalizeInterviewHypothesisType(hypothesisEditDraft.type)] ? 'Sin padre' : 'Este tipo no admite padre'}</option>{buildInterviewAllowedParents(hypothesisEditDraft.type, activeHypothesisId).map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title} · {interviewHypothesisTypeLabel(hypothesis.type)}</option>)}</select>
          <select className="border rounded p-2" value={hypothesisEditDraft.status} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, status: e.target.value }))}><option value="exploracion">exploración</option><option value="en_prueba">en prueba</option><option value="validada">validada</option><option value="refutada">refutada</option></select>
          <select className="border rounded p-2" value={hypothesisEditDraft.audience_id || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia objetivo</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
          <input className="border rounded p-2" placeholder="Segmento" value={hypothesisEditDraft.segment || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, segment: e.target.value }))} />
          <select className="border rounded p-2" value={hypothesisEditDraft.related_client_id || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, related_client_id: e.target.value }))}><option value="">Cliente relacionado</option>{center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <select className="border rounded p-2" value={hypothesisEditDraft.interview_form_id || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, interview_form_id: e.target.value }))}><option value="">Formulario asociado</option>{center.forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}</select>
          <input className="border rounded p-2" type="number" min="1" placeholder="Min entrevistas" value={hypothesisEditDraft.min_interviews || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, min_interviews: e.target.value }))} />
          <select className="border rounded p-2" value={hypothesisEditDraft.validation_metric_config.comparison_operator} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, comparison_operator: e.target.value } }))}>
            <option value=">=">Promedio métricas ≥ umbral</option>
            <option value=">">Promedio métricas &gt; umbral</option>
            <option value="<=">Promedio métricas ≤ umbral</option>
            <option value="<">Promedio métricas &lt; umbral</option>
          </select>
          <input className="border rounded p-2" type="number" min="1" max="5" step="0.1" placeholder="Umbral" value={hypothesisEditDraft.validation_metric_config.threshold_value || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, threshold_value: e.target.value } }))} />
          <select className="border rounded p-2" value={hypothesisEditDraft.validation_metric_config.outcome_if_true} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, outcome_if_true: e.target.value } }))}>
            <option value="validada">Si cumple → validada</option><option value="refutada">Si cumple → refutada</option><option value="señal fuerte">Si cumple → señal fuerte</option><option value="señal moderada">Si cumple → señal moderada</option><option value="señal débil">Si cumple → señal débil</option>
          </select>
          <select className="border rounded p-2" value={hypothesisEditDraft.validation_metric_config.outcome_if_false} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, outcome_if_false: e.target.value } }))}>
            <option value="refutada">Si no cumple → refutada</option><option value="validada">Si no cumple → validada</option><option value="señal fuerte">Si no cumple → señal fuerte</option><option value="señal moderada">Si no cumple → señal moderada</option><option value="señal débil">Si no cumple → señal débil</option><option value="no evaluada">Si no cumple → no evaluada</option>
          </select>
          <textarea className="border rounded p-2" rows={2} placeholder="Notas experimento" value={hypothesisEditDraft.experiment_notes || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, experiment_notes: e.target.value }))} />
          <textarea className="border rounded p-2" rows={2} placeholder="Observaciones" value={hypothesisEditDraft.observations || ''} onChange={(e) => setHypothesisEditDraft((prev) => ({ ...prev, observations: e.target.value }))} />
          <div className="md:col-span-3 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Métrica independiente Y</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {hypothesisMetricOptions.map((metric) => {
                const selected = hypothesisEditDraft.validation_metric_config.selected_metrics.includes(metric.value);
                return (
                  <label key={metric.value} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                    <input type="checkbox" checked={selected} onChange={(event) => setHypothesisEditDraft((prev) => {
                      const current = prev.validation_metric_config.selected_metrics || [];
                      const next = event.target.checked ? [...new Set([...current, metric.value])] : current.filter((item) => item !== metric.value);
                      return { ...prev, validation_metric_config: { ...prev.validation_metric_config, selected_metrics: next } };
                    })} />
                    <span>{metric.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button className="bg-white border" onClick={() => setHypothesisEditModalOpen(false)}>Cancelar</Button>
          <Button
            className="bg-indigo-600 text-white"
            onClick={() => center.runMutation(async () => {
              const payload = buildHypothesisPayload(hypothesisEditDraft, { editingId: activeHypothesisId });
              if (!payload) throw new Error('La hipótesis debe respetar la cadena problema → segmento → mensajes → solucion → producto.');
              const updated = await interviewsModuleApi.updateHypothesis(activeHypothesisId, payload);
              setHypothesisEditModalOpen(false);
              setActiveHypothesisId('');
              return updated;
            }, 'Hipótesis actualizada')}
            disabled={!activeHypothesisId}
          >
            Guardar cambios
          </Button>
        </div>
      </Modal>

      <Modal
        title="Detalle del fragmento"
        open={fragmentDetailModalOpen}
        onClose={() => setFragmentDetailModalOpen(false)}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título</p>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Asigna un título al fragmento"
              value={fragmentDetailDraft.title}
              onChange={(event) => setFragmentDetailDraft((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción (texto extraído)</p>
            <textarea
              className="h-28 w-full rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700"
              value={fragmentDetailDraft.description}
              onChange={(event) => setFragmentDetailDraft((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Código vinculado</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={fragmentDetailDraft.linkedCode}
              onChange={(event) => setFragmentDetailDraft((prev) => ({ ...prev, linkedCode: event.target.value }))}
            >
              <option value="">Seleccionar código…</option>
              {fragmentEvolutionCodeOptions.map((option) => (
                <option key={option.slug} value={option.slug}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={fragmentDetailDraft.clientId}
              onChange={(event) => setFragmentDetailDraft((prev) => ({ ...prev, clientId: event.target.value, interviewId: '' }))}
            >
              <option value="">Seleccionar cliente…</option>
              {center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entrevista vinculada</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={fragmentDetailDraft.interviewId}
              onChange={(event) => setFragmentDetailDraft((prev) => ({ ...prev, interviewId: event.target.value }))}
              disabled={!fragmentDetailDraft.clientId}
            >
              <option value="">{fragmentDetailDraft.clientId ? 'Seleccionar entrevista…' : 'Selecciona un cliente primero'}</option>
              {fragmentDetailInterviewOptions.map((session) => (
                <option key={session.id} value={session.id}>{session.interviewer_name || 'Entrevista'} · {session.created_at ? new Date(session.created_at).toLocaleDateString() : 'Sin fecha'}</option>
              ))}
            </select>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p><span className="font-semibold text-slate-700">Origen:</span> {String((docReader.fragments || []).find((fragment) => String(fragment.id) === String(fragmentDetailDraft.id))?.source_type || 'selection')}</p>
            <p><span className="font-semibold text-slate-700">Documento:</span> {docReader.document?.node_id || '—'}</p>
          </div>

          {fragmentDetailDraft.evolvedToCode ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Fragmento evolucionado a código.
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button className="bg-white border" onClick={() => setFragmentDetailModalOpen(false)}>Cerrar</Button>
            <Button className="bg-white border" onClick={persistFragmentDetailDraft} disabled={!fragmentDetailDraft.clientId || !fragmentDetailDraft.interviewId}>Guardar detalle</Button>
            <Button className="bg-indigo-600 text-white" onClick={evolveFragmentToCode} disabled={!fragmentDetailDraft.clientId || !fragmentDetailDraft.interviewId}>Evolucionar a código</Button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Agregar fragmento manual"
        open={manualFragmentModalOpen}
        onClose={() => setManualFragmentModalOpen(false)}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Completa el fragmento manual y vincúlalo a una entrevista para mantener contexto.</p>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título del fragmento</p>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Título opcional"
              value={docReader.manualTitle}
              onChange={(event) => setDocReader((prev) => ({ ...prev, manualTitle: event.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={docReader.manualClientId}
              onChange={(event) => setDocReader((prev) => ({ ...prev, manualClientId: event.target.value, manualInterviewId: '' }))}
            >
              <option value="">Seleccionar cliente…</option>
              {center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entrevista vinculada</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={docReader.manualInterviewId}
              onChange={(event) => setDocReader((prev) => ({ ...prev, manualInterviewId: event.target.value }))}
              disabled={!docReader.manualClientId}
            >
              <option value="">{docReader.manualClientId ? 'Seleccionar entrevista…' : 'Selecciona un cliente primero'}</option>
              {manualInterviewOptions.map((session) => (
                <option key={session.id} value={session.id}>{session.interviewer_name || 'Entrevista'} · {session.created_at ? new Date(session.created_at).toLocaleDateString() : 'Sin fecha'}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Código vinculado</p>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={docReader.manualCode}
              onChange={(event) => setDocReader((prev) => ({ ...prev, manualCode: event.target.value }))}
            >
              <option value="">Sin código</option>
              {fragmentEvolutionCodeOptions.map((option) => (
                <option key={option.slug} value={option.slug}>{option.label}</option>
              ))}
            </select>
          </div>

          <textarea
            className="w-full min-h-[160px] rounded-md border p-2 text-sm"
            placeholder="Escribe una observación semántica o resumen manual..."
            value={docReader.manualText}
            onChange={(event) => setDocReader((prev) => ({ ...prev, manualText: event.target.value }))}
          />
          <div className="flex justify-end gap-2">
            <Button className="bg-white border" onClick={() => setManualFragmentModalOpen(false)}>Cancelar</Button>
            <Button className="bg-slate-900 text-white" onClick={createManualFragment} disabled={!docReader.manualText.trim() || !docReader.manualClientId || !docReader.manualInterviewId}>Guardar fragmento manual</Button>
          </div>
        </div>
      </Modal>

      <Modal title={clientDraft?.id ? 'Editar cliente' : 'Crear cliente'} open={clientModalOpen} onClose={() => { setClientModalOpen(false); setClientDraft(blankClient); }}>
        <div className="space-y-4">
          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Información básica</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="border rounded p-2" placeholder="Nombre" value={clientDraft.name || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, name: e.target.value }))} />
              <input className="border rounded p-2" placeholder="Contacto" value={clientDraft.contact || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, contact: e.target.value }))} />
              <select className="border rounded p-2 md:col-span-2" value={clientDraft.audience_id || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Sin audiencia</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
            </div>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación demográfica</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="border rounded p-2" placeholder="Edad" value={clientDraft.profile?.demographic?.age || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, age: e.target.value } } }))} />
              <select className="border rounded p-2" value={clientDraft.profile?.demographic?.gender || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, gender: e.target.value } } }))}><option value="">Género</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option><option value="no_binario">No binario</option><option value="prefiero_no_decir">Prefiero no decir</option></select>
              <input className="border rounded p-2" placeholder="Ubicación" value={clientDraft.profile?.demographic?.location || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, location: e.target.value } } }))} />
              <select className="border rounded p-2" value={clientDraft.profile?.demographic?.marital_status || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, marital_status: e.target.value } } }))}><option value="">Estado civil</option><option value="soltero">Soltero/a</option><option value="casado">Casado/a</option><option value="union_libre">Unión libre</option><option value="divorciado">Divorciado/a</option></select>
              <input className="border rounded p-2" placeholder="Nivel educativo" value={clientDraft.profile?.demographic?.education_level || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, education_level: e.target.value } } }))} />
              <input className="border rounded p-2" placeholder="Situación laboral" value={clientDraft.profile?.demographic?.employment_status || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, employment_status: e.target.value } } }))} />
              <select className="border rounded p-2 md:col-span-2" value={clientDraft.profile?.demographic?.income_range || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, income_range: e.target.value } } }))}><option value="">Nivel de ingresos</option><option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto">Alto</option></select>
            </div>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación psicográfica</h4>
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Valores principales" value={clientDraft.profile?.psychographic?.core_values || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, core_values: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Miedos principales" value={clientDraft.profile?.psychographic?.main_fears || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, main_fears: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Deseos principales" value={clientDraft.profile?.psychographic?.main_desires || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, main_desires: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Frustraciones" value={clientDraft.profile?.psychographic?.frustrations || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, frustrations: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Rasgos de personalidad percibidos" value={clientDraft.profile?.psychographic?.personality_traits || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, personality_traits: e.target.value } } }))} />
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación conductual</h4>
            <select className="border rounded p-2 w-full" value={clientDraft.profile?.behavioral?.problem_frequency || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, problem_frequency: e.target.value } } }))}><option value="">Frecuencia del problema</option><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Intentos previos de solución" value={clientDraft.profile?.behavioral?.previous_attempts || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, previous_attempts: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Herramientas utilizadas" value={clientDraft.profile?.behavioral?.tools_used || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, tools_used: e.target.value } } }))} />
            <select className="border rounded p-2 w-full" value={clientDraft.profile?.behavioral?.urgency_level || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, urgency_level: e.target.value } } }))}><option value="">Nivel de urgencia</option><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Notas</h4>
            <textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas generales" value={clientDraft.notes || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, notes: e.target.value }))} />
          </section>

          <Button className="bg-indigo-600 text-white" onClick={async () => {
            const payload = {
              ...clientDraft,
              notes: composeClientNotes(clientDraft.notes, clientDraft.profile),
            };
            if (clientDraft.id) {
              await center.runMutation(() => interviewsModuleApi.updateClient(clientDraft.id, payload), 'Cliente actualizado');
              setSelectedClientId(clientDraft.id);
            } else {
              const created = await createClient(payload);
              setSelectedClientId(created.id);
            }
            setClientDraft(blankClient);
            setClientModalOpen(false);
          }}>Guardar cliente</Button>
        </div>
      </Modal>

      <Modal title={selectedClient ? `Cliente · ${selectedClient.name}` : 'Cliente'} open={Boolean(selectedClient)} onClose={() => setSelectedClientId(null)}>
        {selectedClient && (
          <div className="space-y-4">
            <div className="border rounded-xl p-4 bg-slate-50/60">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">{selectedClient.name}</h3>
              <p className="text-sm text-slate-600">Audiencia: <b>{selectedClient.audience_name || 'Sin audiencia'}</b> · Contacto: <b>{selectedClient.contact || '—'}</b></p>
              <div className="grid md:grid-cols-3 gap-2 mt-3">
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Total entrevistas</p><p className="text-lg font-semibold">{selectedClientSummary?.total || 0}</p></div>
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Última entrevista</p><p className="text-sm font-medium">{selectedClientSummary?.lastInterview ? new Date(selectedClientSummary.lastInterview.created_at).toLocaleString() : 'Sin entrevistas'}</p></div>
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Formularios usados</p><p className="text-lg font-semibold">{selectedClientSummary?.formsUsed || 0}</p></div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">Evaluación acumulada del cliente</p>
                <div className="mt-2 grid md:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
                    <p className="text-xs text-slate-500">Score Problema</p>
                    <p className="text-lg font-semibold text-indigo-700">{selectedClient.aggregateProblemScore ?? 'Sin evaluación'}</p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-3">
                    <p className="text-xs text-slate-500">Score Solución</p>
                    <p className="text-lg font-semibold text-sky-700">{selectedClient.aggregateSolutionScore ?? 'Sin evaluación'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Entrevistas evaluadas</p>
                    <p className="text-lg font-semibold text-slate-800">{selectedClient.evaluatedInterviewsCount || 0}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button className="bg-white border" onClick={() => openClientEditor(selectedClient, true)}>Editar cliente</Button>
                <Button className="bg-indigo-600 text-white" onClick={() => { setRunInterviewPrefill({ clientId: selectedClient.id, audienceId: selectedClient.audience_id || null }); setRunModalOpen(true); }}>Iniciar entrevista</Button>
                <Button className="bg-amber-50 border text-amber-700" onClick={() => center.runMutation(() => interviewsModuleApi.updateClient(selectedClient.id, { ...selectedClient, status: selectedClient.status === 'archived' ? 'active' : 'archived' }), selectedClient.status === 'archived' ? 'Cliente reactivado' : 'Cliente archivado')}>{selectedClient.status === 'archived' ? 'Reactivar' : 'Archivar'}</Button>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold tracking-tight">Notas globales</p>
                <p className={`text-xs ${clientNotesSaveState === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{clientNotesSaveState === 'saving' ? 'Guardando…' : clientNotesSaveState === 'saved' ? 'Guardado' : clientNotesSaveState === 'error' ? 'Error al guardar' : ''}</p>
              </div>
              <textarea className="border rounded-lg p-2 w-full" rows={4} value={clientNotesDraft} onChange={(e) => setClientNotesDraft(e.target.value)} placeholder="Notas acumuladas del cliente" />
            </div>
            <div className="bg-white border rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold tracking-tight">Perfil demográfico</p>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <p><b>Edad:</b> {selectedClient.profile?.demographic?.age || '—'}</p>
                <p><b>Género:</b> {selectedClient.profile?.demographic?.gender || '—'}</p>
                <p><b>Ubicación:</b> {selectedClient.profile?.demographic?.location || '—'}</p>
                <p><b>Estado civil:</b> {selectedClient.profile?.demographic?.marital_status || '—'}</p>
                <p><b>Nivel educativo:</b> {selectedClient.profile?.demographic?.education_level || '—'}</p>
                <p><b>Situación laboral:</b> {selectedClient.profile?.demographic?.employment_status || '—'}</p>
                <p><b>Nivel de ingresos:</b> {selectedClient.profile?.demographic?.income_range || '—'}</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold tracking-tight">Perfil psicográfico</p>
              <p className="text-sm"><b>Valores:</b> {selectedClient.profile?.psychographic?.core_values || '—'}</p>
              <p className="text-sm"><b>Miedos:</b> {selectedClient.profile?.psychographic?.main_fears || '—'}</p>
              <p className="text-sm"><b>Deseos:</b> {selectedClient.profile?.psychographic?.main_desires || '—'}</p>
              <p className="text-sm"><b>Frustraciones:</b> {selectedClient.profile?.psychographic?.frustrations || '—'}</p>
              <p className="text-sm"><b>Rasgos:</b> {selectedClient.profile?.psychographic?.personality_traits || '—'}</p>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold tracking-tight">Perfil conductual</p>
              <p className="text-sm"><b>Frecuencia del problema:</b> {selectedClient.profile?.behavioral?.problem_frequency || '—'}</p>
              <p className="text-sm"><b>Intentos previos:</b> {selectedClient.profile?.behavioral?.previous_attempts || '—'}</p>
              <p className="text-sm"><b>Herramientas usadas:</b> {selectedClient.profile?.behavioral?.tools_used || '—'}</p>
              <p className="text-sm"><b>Urgencia:</b> {selectedClient.profile?.behavioral?.urgency_level || '—'}</p>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-4">
              <p className="text-sm font-semibold tracking-tight">Timeline de entrevistas</p>
              {!selectedClientSummary?.interviews.length ? <p className="text-sm text-slate-500">Sin entrevistas todavía.</p> : (
                <div className="space-y-3">
                  {selectedClientSummary.interviews.map((session, index) => (
                    <div key={session.id} className="relative pl-8 py-1">
                      {index < selectedClientSummary.interviews.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-14px] w-px bg-slate-200" />}
                      <div className="absolute left-0 top-1 h-6 w-6 rounded-full border border-indigo-200 bg-indigo-50 flex items-center justify-center text-[10px] text-indigo-700">●</div>
                      <div className="group border rounded-xl p-3 bg-white hover:bg-slate-50 hover:shadow-sm transition-all duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{session.form_title || 'Formulario'}</p>
                            <div className="flex items-center gap-2 mt-1"><p className="text-xs text-slate-500">{new Date(session.created_at).toLocaleString()}</p><span className={`text-[11px] px-2 py-0.5 rounded-full border ${(session.status || 'draft') === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{session.status || 'draft'}</span></div>
                          </div>
                          <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                            <Button className="bg-white border" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Abrir</Button>
                            <Button className="bg-white border" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Editar</Button>
                            {(session.status || 'draft') === 'draft' && <Button className="bg-indigo-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Continuar</Button>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal title="Realizar entrevista" open={runModalOpen} onClose={() => { setRunModalOpen(false); setRunInterviewPrefill({ clientId: null, audienceId: null }); }}>
        <InterviewRunner
          audiences={center.audiences}
          clients={center.clients}
          forms={center.forms}
          hypotheses={center.hypotheses}
          onCreateClient={createClient}
          onStartInterview={startInterviewSession}
          onAutosave={autosaveInterviewSession}
          onCompleteInterview={completeInterviewSession}
          onViewSession={(id) => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${id}`)}
          initialClientId={runInterviewPrefill.clientId}
          initialAudienceId={runInterviewPrefill.audienceId}
          loading={saving}
        />
      </Modal>
    </>
  );
};

export default InterviewCenterPage;
