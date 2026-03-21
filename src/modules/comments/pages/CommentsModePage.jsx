import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, BookOpenText, MessageSquareText, Tags, Network, Scissors, Search, MoreHorizontal, Plus, ChevronRight, ChevronDown, Eye, BarChart3, Sparkles, Trash2, Activity, GitBranch, CalendarClock, Lightbulb, BrainCircuit, RotateCcw, PanelsTopLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { commentsIngestionApi } from '@/services/commentsIngestionApi';
import { Toolbar } from '@/modules/interviews/components/editor-toolbar/Toolbar';
import { loadCommentsModeStore, saveCommentsModeStore } from '@/modules/comments/services/commentsModeStore';
import { markHypothesisEvolutionLinksDeleted } from '@/modules/comments/services/hypothesisEvolutionService';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';
import { syncCrossModeHypothesisStateTransition } from '@/modules/hypotheses/services/crossModeValidationSync';

const defaultCodeEditor = {
  mode: 'create',
  targetSlug: '',
  name: '',
  description: '',
  parent_slug: '',
  color: '#6366F1',
  tags: '',
  score_consistencia: 50,
  score_intensidad: 50,
};
const defaultIngestionDraft = {
  videoUrl: '',
  videoId: '',
  channelId: '',
  keyword: '',
  videoSearchQuery: '',
  videosLimit: '',
  commentsPerVideo: 100,
  includeReplies: true,
  order: 'time',
};


const defaultEvolutionInterviewDraft = {
  title: '',
  description: '',
  type: 'problema',
  status: 'exploracion',
  audience_id: '',
  segment: '',
  related_client_id: '',
  interview_form_id: '',
  min_interviews: 5,
  experiment_notes: '',
  observations: '',
  next_actions: '',
  validation_metric_config: {
    selected_metrics: ['problem_score_avg', 'solution_interest_avg'],
    threshold_value: 3.5,
    comparison_operator: '>=',
    outcome_if_true: 'validada',
    outcome_if_false: 'refutada',
    evaluation_type: 'average_selected_metrics',
  },
};

const defaultEvolutionVideoDraft = {
  type: 'problema',
  hypothesis_statement: '',
  variable_x: '',
  metrica_objetivo_y: 'views',
  umbral_operador: '>=',
  umbral_tipo: 'entero',
  umbral_valor: 1000,
  volumen_minimo: 100,
  volumen_unidad: 'views',
  canal_principal: 'organic',
  contexto_cualitativo: '',
};

const createEvolutionInterviewDraftForHypothesis = (hypothesis = {}) => {
  const sourceTitle = String(hypothesis?.title || '').trim() || 'Hipótesis evolucionada';
  const sourceDescription = String(hypothesis?.description || '').trim();
  const sourceContext = String(hypothesis?.context_note || '').trim();
  return {
    ...defaultEvolutionInterviewDraft,
    title: sourceTitle,
    description: [sourceDescription, sourceContext].filter(Boolean).join('\n\n'),
    type: normalizeCommentHypothesisType(hypothesis?.type) || defaultEvolutionInterviewDraft.type,
    experiment_notes: `Adaptar esta hipótesis al flujo de entrevistas para validar su señal cualitativa.`,
    observations: sourceContext,
    next_actions: 'Diseñar entrevistas y ejecutar validación con muestra mínima.',
  };
};

const createEvolutionVideoDraftForHypothesis = (hypothesis = {}) => {
  const sourceTitle = String(hypothesis?.title || '').trim() || 'Hipótesis evolucionada';
  const sourceDescription = String(hypothesis?.description || '').trim();
  const sourceContext = String(hypothesis?.context_note || '').trim();
  return {
    ...defaultEvolutionVideoDraft,
    type: normalizeCommentHypothesisType(hypothesis?.type) || defaultEvolutionVideoDraft.type,
    hypothesis_statement: sourceDescription || sourceTitle,
    variable_x: sourceTitle,
    contexto_cualitativo: sourceContext,
  };
};

const normalizeVideoEvolutionDisplayTitle = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const resolveVideoEvolutionDisplayTitle = ({ explicitTitle = '', fallbackTitle = '', statement = '' } = {}) => {
  const normalizedStatement = normalizeVideoEvolutionDisplayTitle(statement);
  const candidates = [explicitTitle, fallbackTitle]
    .map((candidate) => normalizeVideoEvolutionDisplayTitle(candidate))
    .filter(Boolean)
    .filter((candidate, index, array) => array.indexOf(candidate) === index);
  const shortCandidate = candidates.find((candidate) => candidate.length <= 120 && candidate !== normalizedStatement);
  return shortCandidate || candidates[0] || normalizedStatement;
};

const buildCommentHypothesisTraceBlock = ({ sourceHypothesis = {}, destinationMode = '', workspaceId = '', evolvedAt = '', destinationHypothesisId = '' } = {}) => {
  const sourceId = String(sourceHypothesis?.id || '').trim();
  const sourceTitle = String(sourceHypothesis?.title || '').trim();
  const routeType = destinationMode === 'interviews' ? 'comentarios → entrevistas' : 'comentarios → video';
  return [
    'TRAZABILIDAD DE EVOLUCIÓN',
    `origen_modo: comentarios`,
    `origen_workspace_id: ${workspaceId || '__legacy_workspace__'}`,
    `origen_hypothesis_id: ${sourceId || 'sin_id'}`,
    `origen_hypothesis_title: ${sourceTitle || 'Hipótesis comentarios'}`,
    `destino_modo: ${destinationMode || 'sin_destino'}`,
    `tipo_evolucion: ${routeType}`,
    `evolved_at: ${evolvedAt || new Date().toISOString()}`,
    `destino_hypothesis_id: ${destinationHypothesisId || 'pendiente_asignacion'}`,
  ].join('\n');
};


const COMMENT_HYPOTHESIS_TYPE_OPTIONS = [
  { value: 'problema', label: 'Problema' },
  { value: 'segmento', label: 'Segmento' },
  { value: 'mensajes', label: 'Mensajes' },
  { value: 'solucion', label: 'Solución' },
  { value: 'producto', label: 'Producto' },
];

const COMMENT_HYPOTHESIS_PARENT_TYPE_BY_CHILD = {
  problema: '',
  segmento: 'problema',
  mensajes: 'segmento',
  solucion: 'mensajes',
  producto: 'solucion',
};

const COMMENT_HYPOTHESIS_CHILD_TYPE_BY_PARENT = {
  problema: 'segmento',
  segmento: 'mensajes',
  mensajes: 'solucion',
  solucion: 'producto',
  producto: '',
};

const COMMENT_HYPOTHESIS_VALIDATION_STATUS = {
  PENDING: 'pendiente',
  VALID: 'validada',
  INVALID: 'invalidada',
};

const normalizeCommentHypothesisType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return COMMENT_HYPOTHESIS_TYPE_OPTIONS.some((option) => option.value === normalized) ? normalized : '';
};

const commentHypothesisTypeLabel = (value = '') => COMMENT_HYPOTHESIS_TYPE_OPTIONS.find((option) => option.value === normalizeCommentHypothesisType(value))?.label || 'Sin tipo';

const normalizeCommentHypothesisValidationStatus = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID) return COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID;
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID || normalized === 'refutada') return COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID;
  return COMMENT_HYPOTHESIS_VALIDATION_STATUS.PENDING;
};

const commentHypothesisValidationStatusLabel = (value = '') => {
  const normalized = normalizeCommentHypothesisValidationStatus(value);
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID) return 'Validada';
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID) return 'Invalidada';
  return 'Pendiente';
};

const commentHypothesisValidationStatusClasses = (value = '') => {
  const normalized = normalizeCommentHypothesisValidationStatus(value);
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const parseYouTubeVideoId = (value = '') => {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtu.be')) return (url.pathname || '').replace('/', '').slice(0, 11);
    const v = url.searchParams.get('v') || '';
    if (v) return v.slice(0, 11);
    const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    return embedMatch?.[1] || '';
  } catch {
    return '';
  }
};

const slugify = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const buildClusters = (codes = [], fragments = []) => {
  const counts = new Map();
  fragments.forEach((fragment) => {
    (fragment.code_slugs || []).forEach((slug) => counts.set(slug, (counts.get(slug) || 0) + 1));
  });
  return codes
    .map((code) => ({
      id: `cluster:${code.slug}`,
      name: `Cluster · ${code.name}`,
      code_slug: code.slug,
      fragments_count: counts.get(code.slug) || 0,
    }))
    .filter((row) => row.fragments_count > 0)
    .sort((a, b) => b.fragments_count - a.fragments_count);
};

const COMMENT_CODE_EVOLUTION_DISABLED = true;


const CODE_MAP_ALL_SCOPE = '__all__';


const LEGACY_WORKSPACE_ID = '__legacy_workspace__';
const WORKSPACE_ACTIVE_LIMIT = 5;

const normalizeWorkspace = (item = {}) => ({
  id: String(item?.id || '').trim(),
  name: String(item?.name || 'Workspace').trim() || 'Workspace',
  description: String(item?.description || '').trim(),
  status: String(item?.status || 'active').trim() === 'inactive' ? 'inactive' : 'active',
  is_migrated: Number(item?.is_migrated || 0) ? 1 : 0,
  created_at: String(item?.created_at || ''),
  updated_at: String(item?.updated_at || ''),
});


const parseHypothesisSelection = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return Array.from(new Set(raw.split(',').map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
};

const buildCodeMapScopeKey = (value = '') => {
  const selected = parseHypothesisSelection(value);
  if (!selected.length) return CODE_MAP_ALL_SCOPE;
  return selected.join('__');
};

const buildCodeMapInitialAssistantReport = (analysis = {}, subject = {}, targetType = 'code') => {
  const subjectName = String(subject?.name || '').trim() || (targetType === 'profile' ? 'Perfil estratégico' : 'Código analítico');
  const subjectLabel = targetType === 'profile' ? 'PERFIL' : 'CÓDIGO';
  const summary = String(analysis?.summary_absolute || '').trim();
  const sintesisFinal = String(analysis?.sintesis_final?.analysis || '').trim();
  const sections = [
    ['Dolores', analysis?.dolores?.analysis],
    ['Deseos', analysis?.deseos?.analysis],
    ['Placeres', analysis?.placeres?.analysis],
    ['Problemas', analysis?.problemas?.analysis],
    ['Soluciones', analysis?.soluciones?.analysis],
  ];
  const sectionBlocks = sections
    .map(([title, body]) => {
      const text = String(body || '').trim();
      if (!text) return '';
      return `\n${title}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    `INFORME ABSOLUTO DE INVESTIGACIÓN DEL ${subjectLabel}: ${subjectName}`,
    '',
    'Este es el informe fundacional del chat analítico por código. Se construye a partir de evidencia real y funciona como punto de partida para toda la conversación especializada.',
    '',
    summary || 'No hay evidencia suficiente para construir el informe base completo.',
    sectionBlocks ? `\n\nDESARROLLO ANALÍTICO POR CAPAS\n${sectionBlocks}` : '',
    sintesisFinal ? `\n\nSÍNTESIS ESTRATÉGICA FINAL\n${sintesisFinal}` : '',
    '\n\nNota metodológica: este primer mensaje es el informe más completo del chat. Las respuestas posteriores pueden ser más específicas, pero siempre deben anclarse a esta base analítica.',
  ].join('\n');
};

const createEmptyCommentsStore = () => ({
  fragments: [],
  codes: [],
  codeProposals: [],
  hypotheses: [],
  hypothesisEvolutionLinks: [],
  codeMapLayoutsByHypothesis: {},
  codeMapAnalysisSessions: {},
  codeMapVisualProfilesByScope: {},
  hypothesisMapLayout: {},
});

const loadCommentsStoreFromLocalStorage = (storageKey = '') => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      codeProposals: Array.isArray(parsed.codeProposals) ? parsed.codeProposals : [],
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
      hypothesisEvolutionLinks: Array.isArray(parsed.hypothesisEvolutionLinks) ? parsed.hypothesisEvolutionLinks : [],
      codeMapLayoutsByHypothesis: parsed.codeMapLayoutsByHypothesis && typeof parsed.codeMapLayoutsByHypothesis === 'object'
        ? parsed.codeMapLayoutsByHypothesis
        : {},
      codeMapAnalysisSessions: parsed.codeMapAnalysisSessions && typeof parsed.codeMapAnalysisSessions === 'object'
        ? parsed.codeMapAnalysisSessions
        : {},
      codeMapVisualProfilesByScope: parsed.codeMapVisualProfilesByScope && typeof parsed.codeMapVisualProfilesByScope === 'object'
        ? parsed.codeMapVisualProfilesByScope
        : {},
      hypothesisMapLayout: parsed.hypothesisMapLayout && typeof parsed.hypothesisMapLayout === 'object'
        ? parsed.hypothesisMapLayout
        : {},
    };
  } catch {
    return createEmptyCommentsStore();
  }
};

const normalizeGeneratedProposalName = (value = '', fallback = 'Dinámica emocional recurrente') => {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return fallback;
  const normalized = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const invalid = !normalized
    || /(^|\s)(generic|generico|placeholder)(\s|$)/i.test(normalized)
    || /(^(codigo|cluster|tema|grupo)\s*\d*$)/i.test(normalized)
    || /(patron\s+conceptual\s*\d+|codigo\s+conceptual\s*\d+|cluster\s*\d+)/i.test(normalized)
    || raw.split(/\s+/).filter(Boolean).length < 2;
  if (invalid) return fallback;
  return raw;
};

const normalizeGeneratedProposalDescription = (description = '', name = '') => {
  const value = String(description || '').replace(/\s+/g, ' ').trim();
  const bannedTemplate = /agrupa comentarios que expresan|suficiente densidad sem[aá]ntica|describe de forma precisa cómo se manifiesta|describe un patr[oó]n donde|organiza el significado dominante/i;
  if (value.length >= 30 && !bannedTemplate.test(value)) return value;

  const safeName = String(name || '').trim();
  const safeLower = safeName.toLowerCase();
  const parts = safeLower.split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const rest = parts.slice(1).join(' ');

  if (/^proteccion|^protección/.test(first)) return `Invocación de ${rest || safeLower} como figura de resguardo frente a amenazas o fuerzas percibidas como dañinas.`;
  if (/^cobertura/.test(first)) return `Solicitud de resguardo sobre ${rest || 'un ámbito específico'} para evitar daño, bloqueo o interferencia.`;
  if (/^declaracion|^declaración/.test(first)) return `Afirmación de ${rest || 'un resultado esperado'} como certeza que fortalece convicción y desplaza escenarios adversos.`;
  if (/^fortaleza/.test(first)) return `Petición de fuerza interior para sostenerse ante ${rest || 'pruebas o conflictos'} sin ceder al desgaste.`;
  if (/^ruptura/.test(first)) return `Acción simbólica de romper ${rest || 'una carga persistente'} para cortar su efecto y abrir una sensación de liberación.`;
  if (/^reconocer/.test(first)) return `Reconocimiento consciente de ${rest || 'un impulso interno'} como punto de partida para comprenderlo o transformarlo.`;
  if (/^evitar/.test(first)) return `Decisión de evitar ${rest || 'una exposición concreta'} para prevenir consecuencias negativas o afectación percibida.`;
  if (/^identificacion|^identificación/.test(first)) return `Identificación de ${rest || 'señales relevantes'} como indicios que permiten interpretar el fenómeno dominante.`;
  return safeLower ? `Describe ${safeLower} como un fenómeno reconocible que explica por qué estos comentarios comparten un mismo patrón.` : '';
};

const CommentsModePage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { createHypothesis: createVideoHypothesis, deleteHypothesis: deleteVideoHypothesis, updateHypothesis: updateVideoHypothesis, fetchHypotheses: fetchVideoHypotheses } = useHypotheses();
  const workspacePreferenceKey = `comments-mode:workspace-selection:${projectId}:${campaignId}`;
  const legacyStorageKey = `comments-mode:${projectId}:${campaignId}`;

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(true);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
    try {
      return String(localStorage.getItem(workspacePreferenceKey) || '').trim();
    } catch {
      return '';
    }
  });
  const [workspaceEditor, setWorkspaceEditor] = useState({ open: false, mode: 'create', id: '', name: '', description: '', status: 'active' });

  const storageKey = activeWorkspaceId
    ? (activeWorkspaceId === LEGACY_WORKSPACE_ID ? legacyStorageKey : `${legacyStorageKey}:workspace:${activeWorkspaceId}`)
    : legacyStorageKey;

  const [tab, setTab] = useState('comments');
  const [commentsSubtab, setCommentsSubtab] = useState('ingestion');
  const [ingestionDraft, setIngestionDraft] = useState(defaultIngestionDraft);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [ingestionError, setIngestionError] = useState('');
  const [ingestionInputs, setIngestionInputs] = useState([]);
  const [ingestionRuns, setIngestionRuns] = useState([]);
  const [proposalFeedbackSummary, setProposalFeedbackSummary] = useState({});
  const [codeSelectionMetrics, setCodeSelectionMetrics] = useState(null);
  const [semanticAgentBusy, setSemanticAgentBusy] = useState(false);
  const [semanticAgentError, setSemanticAgentError] = useState('');
  const [semanticAgentProgress, setSemanticAgentProgress] = useState({ done: 0, total: 0 });
  const [semanticClusterModalOpen, setSemanticClusterModalOpen] = useState(false);
  const [semanticClusterCards, setSemanticClusterCards] = useState([]);
  const [clusterDecisionDrafts, setClusterDecisionDrafts] = useState({});
  const [clusterDecisionLog, setClusterDecisionLog] = useState([]);
  const [codeGenerationModalOpen, setCodeGenerationModalOpen] = useState(false);
  const [codeGenerationBusy, setCodeGenerationBusy] = useState(false);
  const [codeGenerationError, setCodeGenerationError] = useState('');
  const [generatedCodeProposals, setGeneratedCodeProposals] = useState([]);
  const [codeGenerationMetrics, setCodeGenerationMetrics] = useState(null);
  const [codeGenerationDeleteMenuOpen, setCodeGenerationDeleteMenuOpen] = useState(false);
  const [codeGenerationDeleteMode, setCodeGenerationDeleteMode] = useState('none');
  const [commentsTable, setCommentsTable] = useState({ loading: false, error: '', items: [], total: 0, limit: 100, offset: 0, q: '' });
  const [readerViewMode, setReaderViewMode] = useState('document');
  const [readerSelection, setReaderSelection] = useState({ text: '', start: null, end: null, commentId: '' });
  const [selectedReaderCommentId, setSelectedReaderCommentId] = useState('');
  const [selectedFragmentIds, setSelectedFragmentIds] = useState([]);
  const [selectedFragmentId, setSelectedFragmentId] = useState('');
  const [fragmentQuery, setFragmentQuery] = useState('');
  const [fragmentCodeFilter, setFragmentCodeFilter] = useState('');
  const [fragmentClientFilter, setFragmentClientFilter] = useState('');
  const [fragmentInterviewFilter, setFragmentInterviewFilter] = useState('');
  const [fragmentMenuId, setFragmentMenuId] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [codeHypothesisFilter, setCodeHypothesisFilter] = useState('');
  const [codeClusterFilter, setCodeClusterFilter] = useState('');
  const [codeClientFilter, setCodeClientFilter] = useState('');
  const [codeSortBy, setCodeSortBy] = useState('score_total_desc');
  const [proposalStatusFilter, setProposalStatusFilter] = useState('');
  const [proposalTypeFilter, setProposalTypeFilter] = useState('');
  const [proposalSortBy, setProposalSortBy] = useState('confidence_desc');
  const [proposalQuery, setProposalQuery] = useState('');
  const [activeProposalId, setActiveProposalId] = useState('');
  const [proposalComparisonCode, setProposalComparisonCode] = useState('');
  const [proposalComparisonPage, setProposalComparisonPage] = useState(0);
  const [proposalActionDrafts, setProposalActionDrafts] = useState({});
  const [selectedProposalIds, setSelectedProposalIds] = useState([]);
  const [collapsedCodeSlugs, setCollapsedCodeSlugs] = useState({});
  const [selectedCodeSlug, setSelectedCodeSlug] = useState('');
  const [codeMenuSlug, setCodeMenuSlug] = useState('');
  const [codesActionsMenuOpen, setCodesActionsMenuOpen] = useState(false);
  const [codeDeleteMode, setCodeDeleteMode] = useState('none');
  const [codeCardSlug, setCodeCardSlug] = useState('');
  const [codeCardDeleteMenuOpen, setCodeCardDeleteMenuOpen] = useState(false);
  const [codeCardDeleteMode, setCodeCardDeleteMode] = useState('none');
  const [hypothesisQuery, setHypothesisQuery] = useState('');
  const [hypothesisMenuId, setHypothesisMenuId] = useState('');
  const [hypothesisEvolutionModal, setHypothesisEvolutionModal] = useState({
    open: false,
    saving: false,
    error: '',
    destinationMode: '',
    sourceHypothesisId: '',
    scope: 'single',
  });
  const [hypothesisEvolutionSupport, setHypothesisEvolutionSupport] = useState({ loading: false, error: '', audiences: [], clients: [], forms: [] });
  const [hypothesisEvolutionDeleteModal, setHypothesisEvolutionDeleteModal] = useState({
    open: false,
    deleting: false,
    error: '',
    sourceHypothesisId: '',
    selectedEvolutionId: '',
    deleteMode: 'branch',
  });
  const [hypothesisEvolutionInterviewDraft, setHypothesisEvolutionInterviewDraft] = useState(defaultEvolutionInterviewDraft);
  const [hypothesisEvolutionVideoDraft, setHypothesisEvolutionVideoDraft] = useState(defaultEvolutionVideoDraft);
  const [hypothesisEvolutionInterviewBranchDrafts, setHypothesisEvolutionInterviewBranchDrafts] = useState({});
  const [hypothesisEvolutionVideoBranchDrafts, setHypothesisEvolutionVideoBranchDrafts] = useState({});
  const [hypothesisEditor, setHypothesisEditor] = useState({
    open: false,
    mode: 'create',
    id: '',
    title: '',
    description: '',
    type: 'problema',
    parentHypothesisId: '',
    context_note: '',
    linkedProfileIds: [],
    profileQuery: '',
  });
  const [codeMapOpen, setCodeMapOpen] = useState(false);
  const [codeMapZoom, setCodeMapZoom] = useState(1);
  const [codeMapPan, setCodeMapPan] = useState({ x: 0, y: 0 });
  const [isCodeMapPanning, setIsCodeMapPanning] = useState(false);
  const [codeMapLayoutBySlug, setCodeMapLayoutBySlug] = useState({});
  const [draggingCodeMapNode, setDraggingCodeMapNode] = useState('');
  const [selectedCodeMapNode, setSelectedCodeMapNode] = useState('');
  const [selectedCodeMapEdge, setSelectedCodeMapEdge] = useState('');
  const [codeMapConnectSource, setCodeMapConnectSource] = useState('');
  const [codeMapContextMenu, setCodeMapContextMenu] = useState({ open: false, x: 0, y: 0, slug: '' });
  const [codeMapProfileContextMenu, setCodeMapProfileContextMenu] = useState({ open: false, x: 0, y: 0, profileId: '' });
  const [codeMapProfileEditor, setCodeMapProfileEditor] = useState({ open: false, mode: 'create', id: '', name: '', description: '' });
  const [profileConnectSource, setProfileConnectSource] = useState('');
  const [codeMapAiModal, setCodeMapAiModal] = useState({
    open: false,
    loading: false,
    sending: false,
    error: '',
    targetType: 'code',
    targetId: '',
    title: '',
    result: null,
    sessionId: '',
  });
  const [codeMapAiInput, setCodeMapAiInput] = useState('');
  const codeMapCanvasRef = useRef(null);
  const codeMapLayoutRef = useRef({});

  const [hypothesisMapOpen, setHypothesisMapOpen] = useState(false);
  const [hypothesisMapZoom, setHypothesisMapZoom] = useState(1);
  const [hypothesisMapPan, setHypothesisMapPan] = useState({ x: 0, y: 0 });
  const [isHypothesisMapPanning, setIsHypothesisMapPanning] = useState(false);
  const [hypothesisMapLayoutById, setHypothesisMapLayoutById] = useState({});
  const [draggingHypothesisMapNode, setDraggingHypothesisMapNode] = useState('');
  const [selectedHypothesisMapNode, setSelectedHypothesisMapNode] = useState('');
  const [selectedHypothesisMapEdge, setSelectedHypothesisMapEdge] = useState('');
  const [hypothesisMapFilter, setHypothesisMapFilter] = useState('');
  const hypothesisMapCanvasRef = useRef(null);
  const hypothesisMapLayoutRef = useRef({});
  const [codeEditor, setCodeEditor] = useState({
    open: false,
    ...defaultCodeEditor,
  });
  const [fragmentEditor, setFragmentEditor] = useState({
    open: false,
    mode: 'edit',
    fragmentId: '',
    title: '',
    excerpt: '',
    linkedCode: '',
    sourceCommentId: '',
    sourceType: '',
    sourceCommentText: '',
    selectedText: '',
    selectionStart: null,
    selectionEnd: null,
  });
  const readerTextContainerRef = useRef(null);

  const [store, setStore] = useState(() => loadCommentsStoreFromLocalStorage(storageKey));

  const persist = (next) => {
    setStore(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Fallback para datasets grandes: el guardado principal vive en IndexedDB.
    }
    saveCommentsModeStore(storageKey, next).catch(() => {
      // Silencio controlado: no bloquear UX si IndexedDB falla en navegador restringido.
    });
  };


  const activeWorkspace = useMemo(
    () => workspaces.find((item) => String(item.id) === String(activeWorkspaceId)) || null,
    [workspaces, activeWorkspaceId],
  );

  const activeWorkspaceCount = useMemo(
    () => workspaces.filter((item) => String(item.status || 'active') === 'active').length,
    [workspaces],
  );

  const workspaceContext = useMemo(() => ({
    workspaceId: String(activeWorkspaceId || '').trim(),
  }), [activeWorkspaceId]);

  const loadWorkspaces = async (preferredId = '') => {
    if (!projectId || !campaignId) return;
    setWorkspaceBusy(true);
    setWorkspaceError('');
    try {
      const response = await commentsIngestionApi.listWorkspaces({ projectId, campaignId, workspaceId: workspaceContext.workspaceId });
      const items = (Array.isArray(response?.items) ? response.items : []).map(normalizeWorkspace).filter((item) => item.id);
      setWorkspaces(items);
      const preferred = String(preferredId || activeWorkspaceId || '').trim();
      const validPreferred = preferred && items.some((item) => String(item.id) === preferred);
      const fallback = items.find((item) => String(item.status) === 'active') || items[0] || null;
      const nextActive = validPreferred ? preferred : String(fallback?.id || '');
      if (nextActive) {
        setActiveWorkspaceId(nextActive);
        try { localStorage.setItem(workspacePreferenceKey, nextActive); } catch {}
      }
      if (!nextActive) setWorkspaceModalOpen(true);
    } catch (error) {
      setWorkspaceError(error?.message || 'No se pudieron cargar los workspaces.');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const selectWorkspace = (workspaceId) => {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    setActiveWorkspaceId(id);
    try { localStorage.setItem(workspacePreferenceKey, id); } catch {}
    setWorkspaceModalOpen(false);
    setWorkspaceMenuOpen(false);
  };

  const saveWorkspaceEditor = async () => {
    const name = String(workspaceEditor.name || '').trim();
    if (!name) {
      setWorkspaceError('El workspace requiere un nombre.');
      return;
    }
    if (workspaceEditor.mode === 'create' && String(workspaceEditor.status) === 'active' && activeWorkspaceCount >= WORKSPACE_ACTIVE_LIMIT) {
      setWorkspaceError(`No puedes tener más de ${WORKSPACE_ACTIVE_LIMIT} workspaces activos por campaña.`);
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceError('');
    try {
      if (workspaceEditor.mode === 'create') {
        const created = await commentsIngestionApi.createWorkspace({
          project_id: projectId,
          campaign_id: campaignId,
          name,
          description: String(workspaceEditor.description || '').trim(),
          status: String(workspaceEditor.status || 'active'),
        });
        const normalized = normalizeWorkspace(created);
        await loadWorkspaces(normalized.id);
      } else {
        const updated = await commentsIngestionApi.updateWorkspace({
          workspaceId: workspaceEditor.id,
          project_id: projectId,
          campaign_id: campaignId,
          name,
          description: String(workspaceEditor.description || '').trim(),
          status: String(workspaceEditor.status || 'active'),
        });
        const normalized = normalizeWorkspace(updated);
        await loadWorkspaces(normalized.id || workspaceEditor.id);
      }
      setWorkspaceEditor({ open: false, mode: 'create', id: '', name: '', description: '', status: 'active' });
    } catch (error) {
      setWorkspaceError(error?.message || 'No se pudo guardar el workspace.');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const guardCodeEvolution = () => {
    if (!COMMENT_CODE_EVOLUTION_DISABLED) return false;
    setSemanticAgentError('La evolución de fragmentos a códigos está deshabilitada en Modo Comentarios.');
    return true;
  };

  useEffect(() => {
    loadWorkspaces();
  }, [projectId, campaignId]);

  useEffect(() => {
    let cancelled = false;
    setStore(loadCommentsStoreFromLocalStorage(storageKey));
    const hydrateStore = async () => {
      try {
        const indexedState = await loadCommentsModeStore(storageKey);
        if (cancelled) return;
        if (!indexedState || typeof indexedState !== 'object') {
          setStore(loadCommentsStoreFromLocalStorage(storageKey));
          return;
        }
        setStore({
          fragments: Array.isArray(indexedState.fragments) ? indexedState.fragments : [],
          codes: Array.isArray(indexedState.codes) ? indexedState.codes : [],
          codeProposals: Array.isArray(indexedState.codeProposals) ? indexedState.codeProposals : [],
          hypotheses: Array.isArray(indexedState.hypotheses) ? indexedState.hypotheses : [],
          hypothesisEvolutionLinks: Array.isArray(indexedState.hypothesisEvolutionLinks) ? indexedState.hypothesisEvolutionLinks : [],
          codeMapLayoutsByHypothesis: indexedState.codeMapLayoutsByHypothesis && typeof indexedState.codeMapLayoutsByHypothesis === 'object'
            ? indexedState.codeMapLayoutsByHypothesis
            : {},
          codeMapAnalysisSessions: indexedState.codeMapAnalysisSessions && typeof indexedState.codeMapAnalysisSessions === 'object'
            ? indexedState.codeMapAnalysisSessions
            : {},
          codeMapVisualProfilesByScope: indexedState.codeMapVisualProfilesByScope && typeof indexedState.codeMapVisualProfilesByScope === 'object'
            ? indexedState.codeMapVisualProfilesByScope
            : {},
          hypothesisMapLayout: indexedState.hypothesisMapLayout && typeof indexedState.hypothesisMapLayout === 'object'
            ? indexedState.hypothesisMapLayout
            : {},
        });
      } catch {
        if (!cancelled) setStore(loadCommentsStoreFromLocalStorage(storageKey));
      }
    };
    hydrateStore();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const fragments = store.fragments || [];
  const codes = store.codes || [];
  const codeProposals = store.codeProposals || [];
  const hypotheses = store.hypotheses || [];
  const hypothesisEvolutionLinks = Array.isArray(store.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks : [];
  const codeMapLayoutsByHypothesis = store.codeMapLayoutsByHypothesis && typeof store.codeMapLayoutsByHypothesis === 'object'
    ? store.codeMapLayoutsByHypothesis
    : {};
  const codeMapAnalysisSessions = store.codeMapAnalysisSessions && typeof store.codeMapAnalysisSessions === 'object'
    ? store.codeMapAnalysisSessions
    : {};
  const codeMapVisualProfilesByScope = store.codeMapVisualProfilesByScope && typeof store.codeMapVisualProfilesByScope === 'object'
    ? store.codeMapVisualProfilesByScope
    : {};
  const hypothesisMapLayout = store.hypothesisMapLayout && typeof store.hypothesisMapLayout === 'object'
    ? store.hypothesisMapLayout
    : {};
  const readerComments = commentsTable.items || [];

  const selectedReaderComment = useMemo(() => {
    if (!readerComments.length) return null;
    const selected = readerComments.find((item) => String(item.id) === String(selectedReaderCommentId));
    return selected || readerComments[0] || null;
  }, [readerComments, selectedReaderCommentId]);

  const codeGenerationProgress = useMemo(() => {
    const tableTotalRaw = Number(codeGenerationMetrics?.comments_total_from_table || 0);
    const analyzedRaw = Number(codeGenerationMetrics?.comments_analyzed || 0);
    const fetchedRaw = Number(codeGenerationMetrics?.comments_fetched_for_generation || 0);

    const tableTotal = Number.isFinite(tableTotalRaw) ? Math.max(0, tableTotalRaw) : 0;
    const analyzed = Number.isFinite(analyzedRaw) ? Math.max(0, analyzedRaw) : 0;
    const fetched = Number.isFinite(fetchedRaw) ? Math.max(0, fetchedRaw) : 0;

    const denominator = tableTotal > 0 ? tableTotal : Math.max(analyzed, fetched, 0);
    const ratio = denominator > 0 ? Math.min(1, analyzed / denominator) : 0;

    return {
      totalComments: denominator,
      analyzedComments: analyzed,
      fetchedComments: fetched,
      pct: Math.round(ratio * 100),
    };
  }, [codeGenerationMetrics]);

  const clusters = useMemo(() => buildClusters(codes, fragments), [codes, fragments]);

  const fragmentClientOptions = useMemo(() => Array.from(new Set(fragments.map((f) => String(f.client_id || '').trim()).filter(Boolean))), [fragments]);
  const fragmentInterviewOptions = useMemo(() => Array.from(new Set(fragments.map((f) => String(f.interview_id || '').trim()).filter(Boolean))), [fragments]);

  const codeUsageCount = useMemo(() => {
    const usage = new Map();
    fragments.forEach((fragment) => {
      (fragment.code_slugs || []).forEach((slug) => usage.set(slug, (usage.get(slug) || 0) + 1));
    });
    return usage;
  }, [fragments]);

  const codeScoreBySlug = useMemo(() => {
    const fragmentCountBySlug = new Map();
    const uniqueSourcesBySlug = new Map();

    fragments.forEach((fragment) => {
      const sourceKey = String(fragment.comment_id || fragment.source_comment_id || fragment.video_id || fragment.source_run_id || fragment.id || '').trim();
      (fragment.code_slugs || []).forEach((slug) => {
        const currentCount = Number(fragmentCountBySlug.get(slug) || 0);
        fragmentCountBySlug.set(slug, currentCount + 1);
        if (!uniqueSourcesBySlug.has(slug)) uniqueSourcesBySlug.set(slug, new Set());
        if (sourceKey) uniqueSourcesBySlug.get(slug).add(sourceKey);
      });
    });

    const maxFragments = Math.max(1, ...Array.from(fragmentCountBySlug.values(), (value) => Number(value || 0)));
    const maxSources = Math.max(1, ...Array.from(uniqueSourcesBySlug.values(), (set) => Number(set?.size || 0)));

    const result = new Map();
    codes.forEach((code) => {
      const slug = String(code.slug || '');
      const fragmentCount = Number(fragmentCountBySlug.get(slug) || 0);
      const uniqueSources = Number(uniqueSourcesBySlug.get(slug)?.size || 0);

      const scoreFrecuencia = Math.round((fragmentCount / maxFragments) * 100);
      const scoreDispersion = Math.round((uniqueSources / maxSources) * 100);
      const scoreConsistencia = Math.max(0, Math.min(100, Number(code.score_consistencia ?? 50)));
      const scoreIntensidad = Math.max(0, Math.min(100, Number(code.score_intensidad ?? 50)));

      const scoreTotal = Math.round(
        (0.35 * scoreFrecuencia)
        + (0.30 * scoreDispersion)
        + (0.20 * scoreConsistencia)
        + (0.15 * scoreIntensidad),
      );

      result.set(slug, {
        score_total: scoreTotal,
        score_frecuencia: scoreFrecuencia,
        score_dispersion: scoreDispersion,
        score_consistencia: scoreConsistencia,
        score_intensidad: scoreIntensidad,
        fragment_count: fragmentCount,
        unique_sources: uniqueSources,
      });
    });

    return result;
  }, [codes, fragments]);

  const getScoreColorClass = (score = 0) => {
    if (score >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (score >= 60) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (score >= 40) return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const codeHypothesisOptions = useMemo(() => Array.from(new Set(codes.map((code) => String(code.hypothesis_id || '').trim()).filter(Boolean))), [codes]);
  const codeClusterOptions = useMemo(() => Array.from(new Set(codes.map((code) => String(code.cluster_id || '').trim()).filter(Boolean))), [codes]);
  const codeClientOptions = useMemo(() => Array.from(new Set(codes.map((code) => String(code.client_id || '').trim()).filter(Boolean))), [codes]);

  const tokenize = (text = '') => String(text || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);

  const scoreCodeReuse = (fragmentText = '', code = {}) => {
    const fragmentTokens = new Set(tokenize(fragmentText));
    const codeTokens = new Set([
      ...tokenize(code.name),
      ...tokenize(code.description),
      ...tokenize(Array.isArray(code.tags) ? code.tags.join(' ') : String(code.tags || '')),
    ]);
    if (!fragmentTokens.size || !codeTokens.size) return 0;

    let overlap = 0;
    fragmentTokens.forEach((token) => {
      if (codeTokens.has(token)) overlap += 1;
    });

    const overlapRatio = overlap / Math.max(fragmentTokens.size, 1);
    const usageBonus = Math.min(0.2, Number(codeUsageCount.get(String(code.slug)) || 0) * 0.02);
    const feedback = proposalFeedbackSummary[String(code.slug)] || {};
    const accepted = Number(feedback.accepted || 0);
    const rejected = Number(feedback.rejected || 0);
    const reviewedTotal = Math.max(1, Number(feedback.total || 0));
    const feedbackDelta = ((accepted - rejected) / reviewedTotal) * 0.18;
    return Math.max(0, Math.min(1, overlapRatio + usageBonus + feedbackDelta));
  };

  const saveProposalReviewToDatabase = async ({ proposal, action, finalCodeSlug = '', finalCodeName = '', decisionStatus = '' }) => {
    try {
      await commentsIngestionApi.saveCodeProposalReview({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        proposal_id: String(proposal?.id || '').trim(),
        fragment_id: String(proposal?.fragment_id || '').trim(),
        action: String(action || '').trim() || 'revision',
        decision_status: String(decisionStatus || proposal?.status || '').trim() || null,
        decision_type: String(proposal?.decision_type || '').trim() || null,
        confidence: Number.isFinite(Number(proposal?.confidence)) ? Number(proposal.confidence) : null,
        justification: String(proposal?.justification || '').trim() || null,
        suggested_code_slug: String(proposal?.original_suggested_code_slug || proposal?.suggested_code_slug || '').trim() || null,
        suggested_code_name: String(proposal?.original_suggested_code_name || proposal?.suggested_code_name || '').trim() || null,
        final_code_slug: String(finalCodeSlug || '').trim() || null,
        final_code_name: String(finalCodeName || '').trim() || null,
        metadata: {
          review_log_size: Array.isArray(proposal?.review_log) ? proposal.review_log.length : 0,
        },
      });
    } catch {
      // No bloquear la UX local; la trazabilidad principal sigue en la propuesta local.
    }
  };

  const enrichFragmentsForIaSelection = async (incomingFragments = []) => {
    const preparedIncoming = (Array.isArray(incomingFragments) ? incomingFragments : [])
      .map((fragment) => ({ ...fragment, excerpt: String(fragment?.excerpt || '').trim() }))
      .filter((fragment) => fragment.excerpt.length >= 8);

    if (!preparedIncoming.length) return [];

    try {
      const response = await commentsIngestionApi.enrichFragments({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        fragments: preparedIncoming,
        existing_fragments: fragments.slice(0, 5000).map((fragment) => ({
          id: fragment.id,
          excerpt: fragment.excerpt,
          source_comment_id: fragment.source_comment_id || fragment.comment_id,
          source_video_id: fragment.source_video_id || fragment.video_id,
          source_run_id: fragment.source_run_id,
          source_type: fragment.source_type,
          semantic_hash: fragment.semantic_hash,
        })),
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      if (items.length) return items;
      return preparedIncoming;
    } catch {
      return preparedIncoming;
    }
  };

  const getCurrentReviewer = () => {
    try {
      const fromStorage = JSON.parse(localStorage.getItem('auth_user') || '{}');
      const email = String(fromStorage?.email || '').trim();
      const name = String(fromStorage?.name || '').trim();
      return email || name || 'usuario_humano';
    } catch {
      return 'usuario_humano';
    }
  };

  const getDraftForProposal = (proposalId) => {
    const key = String(proposalId || '');
    const existing = proposalActionDrafts[key] || {};
    return {
      assignExistingSlug: String(existing.assignExistingSlug || ''),
      manualCodeName: String(existing.manualCodeName || ''),
      manualCodeDescription: String(existing.manualCodeDescription || ''),
      renameSuggestedName: String(existing.renameSuggestedName || ''),
      mergeTargetSlug: String(existing.mergeTargetSlug || ''),
      splitNameA: String(existing.splitNameA || ''),
      splitNameB: String(existing.splitNameB || ''),
    };
  };

  const updateProposalDraft = (proposalId, patch) => {
    const key = String(proposalId || '');
    setProposalActionDrafts((prev) => ({
      ...prev,
      [key]: {
        ...getDraftForProposal(key),
        ...patch,
      },
    }));
  };


  const getClusterDraft = (clusterId) => {
    const key = String(clusterId || '');
    const existing = clusterDecisionDrafts[key] || {};
    return {
      editedName: String(existing.editedName || ''),
      conceptualType: String(existing.conceptualType || ''),
      targetCodeSlug: String(existing.targetCodeSlug || ''),
    };
  };

  const updateClusterDraft = (clusterId, patch) => {
    const key = String(clusterId || '');
    setClusterDecisionDrafts((prev) => ({
      ...prev,
      [key]: {
        ...getClusterDraft(key),
        ...patch,
      },
    }));
  };

  const createUniqueCode = ({ name, description = '', parentSlug = null, createdManual = false }) => {
    const safeName = String(name || '').trim() || `Código ${new Date().toLocaleTimeString()}`;
    const baseSlug = slugify(safeName).slice(0, 64) || `code-${Date.now()}`;
    let nextSlug = baseSlug;
    let suffix = 1;
    while (codes.some((code) => String(code.slug) === String(nextSlug))) {
      suffix += 1;
      nextSlug = `${baseSlug}-${suffix}`;
    }
    return {
      id: `code_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: safeName,
      slug: nextSlug,
      parent_slug: parentSlug || null,
      description: String(description || ''),
      tags: [],
      created_manually: createdManual,
      created_by: getCurrentReviewer(),
      created_at: new Date().toISOString(),
    };
  };

  const appendProposalReviewLog = (proposal, action, finalCodeSlug = '', finalCodeName = '', extra = {}) => {
    const now = new Date().toISOString();
    const originalSuggestedCodeSlug = String(proposal.original_suggested_code_slug || proposal.suggested_code_slug || '');
    const originalSuggestedCodeName = String(proposal.original_suggested_code_name || proposal.suggested_code_name || '');
    const entry = {
      action,
      actor: getCurrentReviewer(),
      acted_at: now,
      final_code_slug: String(finalCodeSlug || ''),
      final_code_name: String(finalCodeName || ''),
      original_suggested_code_slug: originalSuggestedCodeSlug,
      original_suggested_code_name: originalSuggestedCodeName,
      ...extra,
    };
    return {
      ...proposal,
      original_suggested_code_slug: originalSuggestedCodeSlug,
      original_suggested_code_name: originalSuggestedCodeName,
      review_log: [...(Array.isArray(proposal.review_log) ? proposal.review_log : []), entry],
      updated_at: now,
    };
  };

  const runCodeProposalAgent = async () => {
    const targetFragments = fragments.filter((fragment) => {
      const hasAcceptedCoding = Array.isArray(fragment.code_slugs) && fragment.code_slugs.length > 0;
      return !hasAcceptedCoding;
    });

    if (!targetFragments.length) return;

    try {
      const response = await commentsIngestionApi.runCodeSelectionAgent({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        fragments: targetFragments,
        existing_codes: codes,
      });

      const selectedFragments = Array.isArray(response?.selected_fragments) ? response.selected_fragments : [];
      const selectedById = new Map(selectedFragments.map((fragment) => [String(fragment.id), fragment]));
      const clusters = Array.isArray(response?.semantic_clusters)
        ? response.semantic_clusters
        : (Array.isArray(response?.clusters_internal) ? response.clusters_internal : []);

      const nextFragments = fragments.map((fragment) => {
        const selected = selectedById.get(String(fragment.id));
        if (!selected) return fragment;
        return {
          ...fragment,
          ...selected,
          fragment_status: 'selected',
        };
      });

      const normalizedCards = clusters.map((cluster, index) => ({
        id: String(cluster.id || `semantic_cluster_${index + 1}`),
        suggested_pattern_name: String(cluster.suggested_pattern_name || `Patrón ${index + 1}`),
        suggested_code_type: String(cluster.suggested_code_type || 'emergente'),
        suggested_decision: String(cluster.suggested_decision || 'crear'),
        cluster_state: String(cluster.cluster_state || 'valido'),
        quality_score: Number(cluster.quality_score || 0),
        confidence: Number(cluster.confidence || 0),
        coherence: Number(cluster.coherence || 0),
        density: Number(cluster.density || 0),
        separation: Number(cluster.separation || 0),
        interpretability: Number(cluster.interpretability || 0),
        size: Number(cluster.size || 0),
        depth: Number(cluster.depth || 0),
        source_dispersion: Number(cluster.source_dispersion || 0),
        similar_existing_code: cluster.similar_existing_code || null,
        representative_fragments: Array.isArray(cluster.representative_fragments) ? cluster.representative_fragments : [],
        fragment_ids: Array.isArray(cluster.fragment_ids) ? cluster.fragment_ids.map((id) => String(id)) : [],
      }));

      setSemanticClusterCards(normalizedCards);
      setSemanticClusterModalOpen(true);
      persist({ ...store, fragments: nextFragments });
      setCodeSelectionMetrics(response?.metrics || null);
    } catch (error) {
      setIngestionError(error?.message || 'No se pudo ejecutar el agente de clusterización semántica.');
    }
  };

  const applyClusterDecision = (cluster, action) => {
    if (!cluster) return;
    const draft = getClusterDraft(cluster.id);
    const editedName = String(draft.editedName || cluster.suggested_pattern_name || '').trim();
    const conceptualType = String(draft.conceptualType || cluster.suggested_code_type || 'emergente').trim();
    const fragmentIdSet = new Set((cluster.fragment_ids || []).map((id) => String(id)));

    let nextCodes = [...codes];
    let targetSlug = '';
    let targetName = '';

    if (action === 'crear') {
      const newCode = createUniqueCode({
        name: editedName || 'Código conceptual',
        description: `Código creado desde cluster ${cluster.id} · tipo ${conceptualType}.`,
        createdManual: true,
      });
      nextCodes = [newCode, ...nextCodes];
      targetSlug = String(newCode.slug);
      targetName = String(newCode.name);
    }

    if (action === 'reutilizar') {
      const reused = codes.find((code) => String(code.slug) === String(draft.targetCodeSlug || cluster?.similar_existing_code?.slug || ''));
      if (!reused) return;
      targetSlug = String(reused.slug);
      targetName = String(reused.name || reused.slug);
    }

    let nextFragments = fragments;
    if (targetSlug) {
      nextFragments = fragments.map((fragment) => {
        if (!fragmentIdSet.has(String(fragment.id))) return fragment;
        const merged = Array.from(new Set([...(fragment.code_slugs || []), targetSlug]));
        return {
          ...fragment,
          code_slugs: merged,
          last_cluster_id: String(cluster.id || ''),
        };
      });
    }

    const logEntry = {
      id: `cluster_decision_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      cluster_id: String(cluster.id || ''),
      action,
      final_code_slug: targetSlug || null,
      final_code_name: targetName || null,
      edited_name: editedName || null,
      conceptual_type: conceptualType || null,
      fragment_count: Number(cluster.size || 0),
      created_at: new Date().toISOString(),
    };

    setClusterDecisionLog((prev) => [logEntry, ...prev]);
    setSemanticClusterCards((prev) => prev.filter((item) => String(item.id) !== String(cluster.id)));
    persist({ ...store, fragments: nextFragments, codes: nextCodes });
  };


  const acceptCodeProposal = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const fragmentId = String(proposal.fragment_id || '');
    if (!fragmentId) return;

    let nextCodes = [...codes];
    let finalCodeSlug = String(proposal.suggested_code_slug || '');
    let finalCodeName = String(proposal.suggested_code_name || '');
    const nextFragments = fragments.map((fragment) => {
      if (String(fragment.id) !== fragmentId) return fragment;

      const previous = Array.isArray(fragment.code_slugs) ? fragment.code_slugs : [];
      const merged = Array.from(new Set([...previous, finalCodeSlug].filter(Boolean)));
      return { ...fragment, code_slugs: merged };
    });

    if (proposal.decision_type === 'nuevo') {
      const exists = nextCodes.some((code) => String(code.slug) === String(proposal.suggested_code_slug));
      if (!exists) {
        const newCode = createUniqueCode({
          name: String(proposal.suggested_code_name || 'Código nuevo'),
          description: 'Creado desde aceptación de propuesta del Agente 2.',
          parentSlug: proposal.parent_candidate_slug || null,
          createdManual: false,
        });
        finalCodeSlug = String(newCode.slug);
        finalCodeName = String(newCode.name);
        nextCodes = [newCode, ...nextCodes];
      }
    }

    const now = new Date().toISOString();
    const nextCodeProposals = codeProposals.map((item) => (
      String(item.id) === String(proposal.id)
        ? appendProposalReviewLog({ ...item, status: 'aceptado' }, 'aceptar', finalCodeSlug, finalCodeName)
        : item
    ));

    persist({
      ...store,
      codes: nextCodes,
      fragments: nextFragments,
      codeProposals: nextCodeProposals,
    });
    saveProposalReviewToDatabase({
      proposal,
      action: 'aceptar',
      finalCodeSlug,
      finalCodeName,
      decisionStatus: 'aceptado',
    }).finally(() => {
      loadProposalReviews();
    });
  };

  const rejectCodeProposal = (proposalId) => {
    const targetProposal = codeProposals.find((proposal) => String(proposal.id) === String(proposalId));
    const nextCodeProposals = codeProposals.map((proposal) => {
      if (String(proposal.id) !== String(proposalId)) return proposal;
      return appendProposalReviewLog({ ...proposal, status: 'rechazado' }, 'rechazar');
    });
    persist({ ...store, codeProposals: nextCodeProposals });
    if (targetProposal) {
      saveProposalReviewToDatabase({
        proposal: targetProposal,
        action: 'rechazar',
        decisionStatus: 'rechazado',
      }).finally(() => {
        loadProposalReviews();
      });
    }
  };

  const assignExistingCodeToProposal = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const draft = getDraftForProposal(proposal.id);
    const targetSlug = String(draft.assignExistingSlug || '').trim();
    if (!targetSlug) return;
    const targetCode = codes.find((code) => String(code.slug) === targetSlug);
    if (!targetCode) return;

    const nextFragments = fragments.map((fragment) => {
      if (String(fragment.id) !== String(proposal.fragment_id || '')) return fragment;
      const merged = Array.from(new Set([...(fragment.code_slugs || []), targetSlug]));
      return { ...fragment, code_slugs: merged };
    });

    const nextCodeProposals = codeProposals.map((item) => {
      if (String(item.id) !== String(proposal.id)) return item;
      return appendProposalReviewLog({ ...item, status: 'reasignado' }, 'reasignar', targetSlug, targetCode.name);
    });

    persist({ ...store, fragments: nextFragments, codeProposals: nextCodeProposals });
    saveProposalReviewToDatabase({
      proposal,
      action: 'reasignar',
      finalCodeSlug: targetSlug,
      finalCodeName: targetCode.name,
      decisionStatus: 'reasignado',
    }).finally(() => {
      loadProposalReviews();
    });
  };

  const createManualCodeForProposal = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const draft = getDraftForProposal(proposal.id);
    const manualName = String(draft.manualCodeName || '').trim();
    if (!manualName) return;
    const newCode = createUniqueCode({
      name: manualName,
      description: String(draft.manualCodeDescription || '').trim() || 'Creado manualmente desde Panel Humano.',
      parentSlug: proposal.parent_candidate_slug || null,
      createdManual: true,
    });

    const nextFragments = fragments.map((fragment) => {
      if (String(fragment.id) !== String(proposal.fragment_id || '')) return fragment;
      const merged = Array.from(new Set([...(fragment.code_slugs || []), String(newCode.slug)]));
      return { ...fragment, code_slugs: merged };
    });

    const nextCodeProposals = codeProposals.map((item) => {
      if (String(item.id) !== String(proposal.id)) return item;
      return appendProposalReviewLog({ ...item, status: 'corregido' }, 'crear_manual', newCode.slug, newCode.name, { created_manually: true });
    });

    persist({ ...store, codes: [newCode, ...codes], fragments: nextFragments, codeProposals: nextCodeProposals });
    saveProposalReviewToDatabase({
      proposal,
      action: 'crear_manual',
      finalCodeSlug: newCode.slug,
      finalCodeName: newCode.name,
      decisionStatus: 'corregido',
    }).finally(() => {
      loadProposalReviews();
    });
  };

  const renameSuggestedProposalCode = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const draft = getDraftForProposal(proposal.id);
    const renamed = String(draft.renameSuggestedName || '').trim();
    if (!renamed) return;
    const now = new Date().toISOString();
    const nextSlugBase = slugify(renamed).slice(0, 64) || `code-${Date.now()}`;
    let nextSlug = nextSlugBase;
    let suffix = 1;
    while (codes.some((code) => String(code.slug) === String(nextSlug))) {
      suffix += 1;
      nextSlug = `${nextSlugBase}-${suffix}`;
    }
    const nextCodeProposals = codeProposals.map((item) => {
      if (String(item.id) !== String(proposal.id)) return item;
      const updated = {
        ...item,
        suggested_code_name: renamed,
        suggested_code_slug: nextSlug,
        status: 'corregido',
        updated_at: now,
      };
      return appendProposalReviewLog(updated, 'renombrar_sugerido', nextSlug, renamed);
    });
    persist({ ...store, codeProposals: nextCodeProposals });
    saveProposalReviewToDatabase({
      proposal,
      action: 'renombrar_sugerido',
      finalCodeSlug: nextSlug,
      finalCodeName: renamed,
      decisionStatus: 'corregido',
    });
  };

  const splitSuggestedProposalCode = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const draft = getDraftForProposal(proposal.id);
    const nameA = String(draft.splitNameA || '').trim();
    const nameB = String(draft.splitNameB || '').trim();
    if (!nameA || !nameB) return;
    const now = new Date().toISOString();
    const splitCandidates = [nameA, nameB].map((name) => ({ code_name: name, confidence: 0.5 }));
    const nextCodeProposals = codeProposals.map((item) => {
      if (String(item.id) !== String(proposal.id)) return item;
      const updated = {
        ...item,
        status: 'corregido',
        split_candidates: splitCandidates,
        alternatives: [...(Array.isArray(item.alternatives) ? item.alternatives : []), ...splitCandidates],
        updated_at: now,
      };
      return appendProposalReviewLog(updated, 'dividir_sugerido', '', '', { split_candidates: splitCandidates });
    });
    persist({ ...store, codeProposals: nextCodeProposals });
    saveProposalReviewToDatabase({
      proposal,
      action: 'dividir_sugerido',
      decisionStatus: 'corregido',
    });
  };

  const mergeSuggestedWithExistingCode = (proposal) => {
    if (guardCodeEvolution()) return;
    if (!proposal) return;
    const draft = getDraftForProposal(proposal.id);
    const targetSlug = String(draft.mergeTargetSlug || '').trim();
    if (!targetSlug) return;
    const targetCode = codes.find((code) => String(code.slug) === targetSlug);
    if (!targetCode) return;

    const nextFragments = fragments.map((fragment) => {
      if (String(fragment.id) !== String(proposal.fragment_id || '')) return fragment;
      const merged = Array.from(new Set([...(fragment.code_slugs || []), targetSlug]));
      return { ...fragment, code_slugs: merged };
    });

    const nextCodeProposals = codeProposals.map((item) => {
      if (String(item.id) !== String(proposal.id)) return item;
      const updated = {
        ...item,
        status: 'fusionado',
        merged_into_slug: targetSlug,
        merged_into_name: targetCode.name,
      };
      return appendProposalReviewLog(updated, 'fusionar', targetSlug, targetCode.name);
    });
    persist({ ...store, fragments: nextFragments, codeProposals: nextCodeProposals });
    saveProposalReviewToDatabase({
      proposal,
      action: 'fusionar',
      finalCodeSlug: targetSlug,
      finalCodeName: targetCode.name,
      decisionStatus: 'fusionado',
    }).finally(() => {
      loadProposalReviews();
    });
  };

  const fragmentById = useMemo(() => {
    const map = new Map();
    fragments.forEach((fragment) => {
      map.set(String(fragment.id), fragment);
    });
    return map;
  }, [fragments]);

  const proposalStatusAllowed = useMemo(() => {
    const raw = String(proposalStatusFilter || '').trim();
    if (!raw) return null;
    return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
  }, [proposalStatusFilter]);

  const humanPanelProposals = useMemo(() => {
    const query = String(proposalQuery || '').toLowerCase().trim();
    const list = codeProposals.filter((proposal) => {
      const status = String(proposal.status || 'pendiente');
      if (proposalStatusAllowed && !proposalStatusAllowed.has(status)) return false;
      if (proposalTypeFilter && String(proposal.decision_type || '') !== proposalTypeFilter) return false;
      if (!query) return true;
      const fragment = fragmentById.get(String(proposal.fragment_id || ''));
      const haystack = [
        proposal.fragment_excerpt,
        proposal.suggested_code_name,
        proposal.suggested_code_slug,
        fragment?.excerpt,
        fragment?.source_comment_text,
      ].map((item) => String(item || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });

    const sorted = [...list].sort((a, b) => {
      if (proposalSortBy === 'confidence_asc') return Number(a.confidence || 0) - Number(b.confidence || 0);
      if (proposalSortBy === 'date_asc') return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      if (proposalSortBy === 'type') return String(a.decision_type || '').localeCompare(String(b.decision_type || ''));
      if (proposalSortBy === 'date_desc') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    });

    return sorted;
  }, [codeProposals, proposalStatusAllowed, proposalTypeFilter, proposalQuery, proposalSortBy, fragmentById]);

  useEffect(() => {
    const visible = new Set(humanPanelProposals.map((proposal) => String(proposal.id || '')).filter(Boolean));
    setSelectedProposalIds((prev) => prev.filter((id) => visible.has(String(id || ''))));
  }, [humanPanelProposals]);

  const proposalComparisonRows = useMemo(() => {
    const slug = String(proposalComparisonCode || '').trim();
    if (!slug) return [];
    return fragments.filter((fragment) => Array.isArray(fragment.code_slugs) && fragment.code_slugs.includes(slug));
  }, [proposalComparisonCode, fragments]);

  const proposalComparisonPageSize = 8;
  const paginatedProposalComparisonRows = useMemo(() => {
    const start = proposalComparisonPage * proposalComparisonPageSize;
    return proposalComparisonRows.slice(start, start + proposalComparisonPageSize);
  }, [proposalComparisonRows, proposalComparisonPage]);

  const toggleProposalSelection = (proposalId) => {
    const key = String(proposalId || '');
    if (!key) return;
    setSelectedProposalIds((prev) => (
      prev.includes(key)
        ? prev.filter((id) => id !== key)
        : [...prev, key]
    ));
  };

  const selectAllVisibleProposals = () => {
    const visibleIds = humanPanelProposals.map((proposal) => String(proposal.id || '')).filter(Boolean);
    setSelectedProposalIds(visibleIds);
  };

  const clearProposalSelection = () => {
    setSelectedProposalIds([]);
  };

  const deleteProposalById = (proposalId) => {
    const key = String(proposalId || '');
    if (!key) return;
    const target = codeProposals.find((proposal) => String(proposal.id) === key);
    if (!target) return;
    if (!window.confirm(`¿Eliminar la propuesta ${key}? Esta acción no se puede deshacer.`)) return;

    const nextCodeProposals = codeProposals.filter((proposal) => String(proposal.id) !== key);
    persist({ ...store, codeProposals: nextCodeProposals });
    setSelectedProposalIds((prev) => prev.filter((id) => id !== key));
    setActiveProposalId((prev) => (String(prev) === key ? '' : prev));
  };

  const deleteSelectedProposals = () => {
    const selected = new Set(selectedProposalIds.map((id) => String(id || '')).filter(Boolean));
    if (!selected.size) return;
    if (!window.confirm(`¿Eliminar ${selected.size} propuesta(s) seleccionada(s)? Esta acción no se puede deshacer.`)) return;

    const nextCodeProposals = codeProposals.filter((proposal) => !selected.has(String(proposal.id || '')));
    persist({ ...store, codeProposals: nextCodeProposals });
    setSelectedProposalIds([]);
    setActiveProposalId('');
  };

  const openCodeEditor = (mode = 'create', code = null, parentSlug = '') => {
    setCodeMenuSlug('');
    if (mode === 'create') {
      setCodeEditor({
        open: true,
        ...defaultCodeEditor,
        mode,
        parent_slug: parentSlug || '',
      });
      return;
    }
    if (!code) return;
    setCodeEditor({
      open: true,
      mode: 'edit',
      targetSlug: String(code.slug || ''),
      name: String(code.name || ''),
      description: String(code.description || ''),
      parent_slug: String(code.parent_slug || ''),
      color: String(code.color || '#6366F1'),
      tags: Array.isArray(code.tags) ? code.tags.join(', ') : String(code.tags || ''),
      score_consistencia: Math.max(0, Math.min(100, Number(code.score_consistencia ?? 50))),
      score_intensidad: Math.max(0, Math.min(100, Number(code.score_intensidad ?? 50))),
    });
  };

  const closeCodeEditor = () => setCodeEditor((prev) => ({ ...prev, open: false }));

  const saveCodeEditor = () => {
    const name = String(codeEditor.name || '').trim();
    if (!name) return;
    const targetSlug = slugify(name).slice(0, 64) || `code-${Date.now()}`;
    const tags = String(codeEditor.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
    const scoreConsistencia = Math.max(0, Math.min(100, Number(codeEditor.score_consistencia ?? 50)));
    const scoreIntensidad = Math.max(0, Math.min(100, Number(codeEditor.score_intensidad ?? 50)));

    if (codeEditor.mode === 'create') {
      let nextSlug = targetSlug;
      let suffix = 1;
      while (codes.some((code) => code.slug === nextSlug)) {
        suffix += 1;
        nextSlug = `${targetSlug}-${suffix}`;
      }

      const nextCode = {
        id: `code_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name,
        slug: nextSlug,
        parent_slug: codeEditor.parent_slug || null,
        description: String(codeEditor.description || '').trim(),
        color: codeEditor.color || '#6366F1',
        tags,
        score_consistencia: scoreConsistencia,
        score_intensidad: scoreIntensidad,
        created_at: new Date().toISOString(),
      };
      persist({ ...store, codes: [nextCode, ...codes] });
      setSelectedCodeSlug(nextSlug);
      closeCodeEditor();
      return;
    }

    const nextCodes = codes.map((code) => {
      if (String(code.slug) !== String(codeEditor.targetSlug)) return code;
      return {
        ...code,
        name,
        description: String(codeEditor.description || '').trim(),
        parent_slug: codeEditor.parent_slug || null,
        color: codeEditor.color || '#6366F1',
        tags,
        score_consistencia: scoreConsistencia,
        score_intensidad: scoreIntensidad,
      };
    });
    persist({ ...store, codes: nextCodes });
    setSelectedCodeSlug(codeEditor.targetSlug);
    closeCodeEditor();
  };

  const toggleCodeCollapsed = (slug) => {
    setCollapsedCodeSlugs((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const deleteCodeTree = (slug) => {
    const target = String(slug || '');
    if (!target) return;
    const descendants = new Set([target]);
    let changed = true;
    while (changed) {
      changed = false;
      codes.forEach((code) => {
        if (code.parent_slug && descendants.has(String(code.parent_slug)) && !descendants.has(String(code.slug))) {
          descendants.add(String(code.slug));
          changed = true;
        }
      });
    }

    const nextCodes = codes.filter((code) => !descendants.has(String(code.slug)));
    const nextFragments = fragments.map((fragment) => ({
      ...fragment,
      code_slugs: (fragment.code_slugs || []).filter((item) => !descendants.has(String(item))),
    }));
    const cleanedVisualScopes = Object.fromEntries(Object.entries(codeMapVisualProfilesByScope).map(([scope, data]) => {
      const safe = data && typeof data === 'object' ? data : {};
      const assignments = safe.assignments && typeof safe.assignments === 'object' ? safe.assignments : {};
      const nextAssignments = Object.fromEntries(Object.entries(assignments).filter(([codeSlug]) => !descendants.has(String(codeSlug))));
      return [scope, {
        profiles: Array.isArray(safe.profiles) ? safe.profiles : [],
        assignments: nextAssignments,
        collapsed: safe.collapsed && typeof safe.collapsed === 'object' ? safe.collapsed : {},
      }];
    }));
    persist({ ...store, codes: nextCodes, fragments: nextFragments, codeMapVisualProfilesByScope: cleanedVisualScopes });
    setSelectedCodeSlug('');
    setCodeMenuSlug('');
    if (String(codeCardSlug || '') && descendants.has(String(codeCardSlug))) {
      setCodeCardSlug('');
      setCodeCardDeleteMode('none');
      setCodeCardDeleteMenuOpen(false);
    }
  };



  const deleteAllCodes = () => {
    if (!codes.length) return;
    if (!window.confirm(`¿Eliminar todos los códigos (${codes.length}) y desvincularlos de fragmentos?`)) return;
    const nextFragments = fragments.map((fragment) => ({
      ...fragment,
      code_slugs: [],
    }));
    const cleanedVisualScopes = Object.fromEntries(Object.entries(codeMapVisualProfilesByScope).map(([scope, data]) => {
      const safe = data && typeof data === 'object' ? data : {};
      return [scope, {
        profiles: Array.isArray(safe.profiles) ? safe.profiles : [],
        assignments: {},
        collapsed: safe.collapsed && typeof safe.collapsed === 'object' ? safe.collapsed : {},
      }];
    }));
    persist({ ...store, codes: [], fragments: nextFragments, codeMapVisualProfilesByScope: cleanedVisualScopes });
    setSelectedCodeSlug('');
    setCodeMenuSlug('');
    setCodeCardSlug('');
    setCodeDeleteMode('none');
    setCodesActionsMenuOpen(false);
  };

  const setCodeParent = (slug, parentSlug) => {
    const normalizedSlug = String(slug || '');
    if (!normalizedSlug) return;
    const normalizedParent = String(parentSlug || '').trim();
    if (normalizedParent && normalizedParent === normalizedSlug) return;
    const nextCodes = codes.map((code) => {
      if (String(code.slug) !== normalizedSlug) return code;
      return {
        ...code,
        parent_slug: normalizedParent || null,
      };
    });
    persist({ ...store, codes: nextCodes });
  };

  const isDescendantCode = (targetSlug, candidateAncestorSlug) => {
    const target = String(targetSlug || '');
    const candidate = String(candidateAncestorSlug || '');
    if (!target || !candidate || target === candidate) return false;
    let parent = String(codes.find((code) => String(code.slug) === target)?.parent_slug || '');
    const guard = new Set();
    while (parent && !guard.has(parent)) {
      if (parent === candidate) return true;
      guard.add(parent);
      parent = String(codes.find((code) => String(code.slug) === parent)?.parent_slug || '');
    }
    return false;
  };

  const connectCodeFromSource = (targetSlug) => {
    const sourceSlug = String(codeMapConnectSource || '');
    const normalizedTarget = String(targetSlug || '');
    if (!sourceSlug || !normalizedTarget || sourceSlug === normalizedTarget) return;
    if (isDescendantCode(normalizedTarget, sourceSlug)) {
      window.alert('No se puede conectar porque generaría un ciclo en la jerarquía.');
      return;
    }
    setCodeParent(sourceSlug, normalizedTarget);
    setSelectedCodeMapNode(normalizedTarget);
    setSelectedCodeMapEdge('');
    setCodeMapConnectSource('');
  };

  const filteredCodes = useMemo(() => {
    const query = codeQuery.trim().toLowerCase();
    const selectedHypothesisIds = parseHypothesisSelection(codeHypothesisFilter);
    return codes.filter((code) => {
      const name = String(code.name || '').toLowerCase();
      const description = String(code.description || '').toLowerCase();
      const tags = Array.isArray(code.tags) ? code.tags.join(' ').toLowerCase() : String(code.tags || '').toLowerCase();
      const matchesQuery = !query || name.includes(query) || description.includes(query) || tags.includes(query);
      const matchesHypothesis = !selectedHypothesisIds.length || selectedHypothesisIds.includes(String(code.hypothesis_id || ''));
      const matchesCluster = !codeClusterFilter || String(code.cluster_id || '') === codeClusterFilter;
      const matchesClient = !codeClientFilter || String(code.client_id || '') === codeClientFilter;
      return matchesQuery && matchesHypothesis && matchesCluster && matchesClient;
    });
  }, [codes, codeQuery, codeHypothesisFilter, codeClusterFilter, codeClientFilter]);

  const codeTreeRoots = useMemo(() => {
    const filteredSet = new Set(filteredCodes.map((code) => String(code.slug)));
    const childrenByParent = new Map();
    filteredCodes.forEach((code) => {
      const parent = String(code.parent_slug || '');
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(code);
    });

    const sortByName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    const sortByScoreMetric = (a, b, key) => {
      const aScore = Number(codeScoreBySlug.get(String(a.slug))?.[key] || 0);
      const bScore = Number(codeScoreBySlug.get(String(b.slug))?.[key] || 0);
      if (bScore !== aScore) return bScore - aScore;
      return sortByName(a, b);
    };
    const sortBy = (a, b) => {
      if (codeSortBy === 'frecuencia_desc') return sortByScoreMetric(a, b, 'score_frecuencia');
      if (codeSortBy === 'dispersion_desc') return sortByScoreMetric(a, b, 'score_dispersion');
      if (codeSortBy === 'score_total_desc') return sortByScoreMetric(a, b, 'score_total');
      return sortByName(a, b);
    };
    childrenByParent.forEach((list) => list.sort(sortBy));

    const roots = filteredCodes.filter((code) => !code.parent_slug || !filteredSet.has(String(code.parent_slug)));
    roots.sort(sortBy);

    return { roots, childrenByParent };
  }, [filteredCodes, codeSortBy, codeScoreBySlug]);

  const codeMapScopeKey = useMemo(
    () => buildCodeMapScopeKey(codeHypothesisFilter),
    [codeHypothesisFilter],
  );

  const scopedVisualProfiles = codeMapVisualProfilesByScope[codeMapScopeKey] && typeof codeMapVisualProfilesByScope[codeMapScopeKey] === 'object'
    ? codeMapVisualProfilesByScope[codeMapScopeKey]
    : { profiles: [], assignments: {}, collapsed: {} };
  const codeMapProfiles = Array.isArray(scopedVisualProfiles.profiles) ? scopedVisualProfiles.profiles : [];
  const codeMapProfileAssignments = scopedVisualProfiles.assignments && typeof scopedVisualProfiles.assignments === 'object' ? scopedVisualProfiles.assignments : {};
  const codeMapProfileCollapsed = scopedVisualProfiles.collapsed && typeof scopedVisualProfiles.collapsed === 'object' ? scopedVisualProfiles.collapsed : {};

  const persistCodeMapVisualScope = (scopeKey, nextScopeData) => {
    const normalizedScope = String(scopeKey || CODE_MAP_ALL_SCOPE);
    const safeData = nextScopeData && typeof nextScopeData === 'object' ? nextScopeData : { profiles: [], assignments: {}, collapsed: {} };
    persist({
      ...store,
      codeMapVisualProfilesByScope: {
        ...codeMapVisualProfilesByScope,
        [normalizedScope]: {
          profiles: Array.isArray(safeData.profiles) ? safeData.profiles : [],
          assignments: safeData.assignments && typeof safeData.assignments === 'object' ? safeData.assignments : {},
          collapsed: safeData.collapsed && typeof safeData.collapsed === 'object' ? safeData.collapsed : {},
        },
      },
    });
  };

  const upsertCodeMapProfile = (profile) => {
    if (!profile || !String(profile.id || '').trim()) return;
    const profileId = String(profile.id).trim();
    const existing = codeMapProfiles.find((item) => String(item.id) === profileId);
    const nextProfiles = existing
      ? codeMapProfiles.map((item) => (String(item.id) === profileId ? { ...item, ...profile } : item))
      : [...codeMapProfiles, profile];
    persistCodeMapVisualScope(codeMapScopeKey, {
      profiles: nextProfiles,
      assignments: codeMapProfileAssignments,
      collapsed: codeMapProfileCollapsed,
    });
  };

  const removeCodeMapProfile = (profileId) => {
    const normalizedProfileId = String(profileId || '').trim();
    if (!normalizedProfileId) return;
    const nextProfiles = codeMapProfiles.filter((item) => String(item.id) !== normalizedProfileId);
    const nextAssignments = Object.fromEntries(Object.entries(codeMapProfileAssignments).filter(([, value]) => String(value || '') !== normalizedProfileId));
    const nextCollapsed = { ...codeMapProfileCollapsed };
    delete nextCollapsed[normalizedProfileId];
    persistCodeMapVisualScope(codeMapScopeKey, {
      profiles: nextProfiles,
      assignments: nextAssignments,
      collapsed: nextCollapsed,
    });
  };

  useEffect(() => {
    const scopedLayout = codeMapLayoutsByHypothesis[codeMapScopeKey];
    setCodeMapLayoutBySlug(scopedLayout && typeof scopedLayout === 'object' ? scopedLayout : {});
  }, [codeMapLayoutsByHypothesis, codeMapScopeKey]);

  useEffect(() => {
    codeMapLayoutRef.current = codeMapLayoutBySlug || {};
  }, [codeMapLayoutBySlug]);

  const persistCodeMapLayoutForScope = (scopeKey, nextLayoutBySlug) => {
    const normalizedScope = String(scopeKey || CODE_MAP_ALL_SCOPE);
    const normalizedLayout = nextLayoutBySlug && typeof nextLayoutBySlug === 'object' ? nextLayoutBySlug : {};
    const previousScopedLayout = codeMapLayoutsByHypothesis[normalizedScope] && typeof codeMapLayoutsByHypothesis[normalizedScope] === 'object'
      ? codeMapLayoutsByHypothesis[normalizedScope]
      : {};
    if (JSON.stringify(previousScopedLayout) === JSON.stringify(normalizedLayout)) return;

    persist({
      ...store,
      codeMapLayoutsByHypothesis: {
        ...codeMapLayoutsByHypothesis,
        [normalizedScope]: normalizedLayout,
      },
    });
  };

  const codeMapVisibleCodes = useMemo(() => {
    const selectedHypothesisIds = parseHypothesisSelection(codeHypothesisFilter);
    if (!selectedHypothesisIds.length) return codes;
    return codes.filter((code) => selectedHypothesisIds.includes(String(code.hypothesis_id || '')));
  }, [codes, codeHypothesisFilter]);

  const codeMapNodes = useMemo(() => codeMapVisibleCodes.map((code, index) => {
    const saved = codeMapLayoutBySlug[code.slug] || {};
    const x = Number(saved.x);
    const y = Number(saved.y);
    return {
      ...code,
      fragmentCount: Number(codeUsageCount.get(String(code.slug)) || 0),
      scoreTotal: Number(codeScoreBySlug.get(String(code.slug))?.score_total || 0),
      x: Number.isFinite(x) ? x : 120 + ((index % 4) * 260),
      y: Number.isFinite(y) ? y : 80 + (Math.floor(index / 4) * 160),
    };
  }), [codeMapVisibleCodes, codeMapLayoutBySlug, codeUsageCount, codeScoreBySlug]);

  const codeMapVisibleSlugSet = useMemo(() => new Set(codeMapVisibleCodes.map((code) => String(code.slug))), [codeMapVisibleCodes]);

  const codeMapProfileNodes = useMemo(() => (Array.isArray(codeMapProfiles) ? codeMapProfiles : []).map((profile, index) => {
    const fallbackX = 80 + ((index % 3) * 320);
    const fallbackY = 36 + (Math.floor(index / 3) * 210);
    return {
      id: String(profile.id || ''),
      name: String(profile.name || 'Perfil estratégico').trim() || 'Perfil estratégico',
      description: String(profile.description || '').trim(),
      x: Number.isFinite(Number(profile.x)) ? Number(profile.x) : fallbackX,
      y: Number.isFinite(Number(profile.y)) ? Number(profile.y) : fallbackY,
    };
  }).filter((profile) => profile.id), [codeMapProfiles]);

  const codeMapProfileNodeById = useMemo(() => new Map(codeMapProfileNodes.map((profile) => [String(profile.id), profile])), [codeMapProfileNodes]);

  const collapsedProfileIds = useMemo(() => new Set(Object.entries(codeMapProfileCollapsed).filter(([, collapsed]) => Boolean(collapsed)).map(([profileId]) => String(profileId))), [codeMapProfileCollapsed]);
  const visibleCodeMapNodes = useMemo(() => codeMapNodes.filter((code) => !collapsedProfileIds.has(String(codeMapProfileAssignments[String(code.slug)] || ''))), [codeMapNodes, collapsedProfileIds, codeMapProfileAssignments]);

  const codeMapEdges = useMemo(() => {
    const visibleCodeSlugSet = new Set(visibleCodeMapNodes.map((code) => String(code.slug)));
    const hierarchyEdges = visibleCodeMapNodes
      .filter((code) => code.parent_slug && String(code.parent_slug) !== String(code.slug))
      .filter((code) => visibleCodeSlugSet.has(String(code.slug)) && visibleCodeSlugSet.has(String(code.parent_slug)))
      .map((code) => ({
        id: `edge_${code.parent_slug}_${code.slug}`,
        source: String(code.parent_slug),
        target: String(code.slug),
      }));

    const profileEdges = Object.entries(codeMapProfileAssignments)
      .filter(([codeSlug, profileId]) => visibleCodeSlugSet.has(String(codeSlug)) && codeMapProfileNodeById.has(String(profileId)))
      .map(([codeSlug, profileId]) => ({
        id: `edge_profile_${profileId}_${codeSlug}`,
        source: String(profileId),
        target: String(codeSlug),
        type: 'profile_link',
      }));

    return [...hierarchyEdges, ...profileEdges];
  }, [visibleCodeMapNodes, codeMapProfileAssignments, codeMapProfileNodeById]);





  const buildCodeMapAnalysisSessionKey = (targetType, targetId) => `${String(targetType || 'code').trim()}:${String(targetId || '').trim()}`;

  const codeMapRenderableNodesById = useMemo(() => {
    const rows = [
      ...visibleCodeMapNodes.map((node) => ({ id: String(node.slug), x: Number(node.x) || 0, y: Number(node.y) || 0 })),
      ...codeMapProfileNodes.map((profile) => ({ id: String(profile.id), x: Number(profile.x) || 0, y: Number(profile.y) || 0 })),
    ];
    return new Map(rows.map((item) => [item.id, item]));
  }, [visibleCodeMapNodes, codeMapProfileNodes]);

  const hypothesisById = useMemo(
    () => new Map(hypotheses.map((hypothesis) => [String(hypothesis.id), hypothesis])),
    [hypotheses],
  );

  const childHypothesesByParentId = useMemo(() => hypotheses.reduce((acc, hypothesis) => {
    const parentId = String(hypothesis?.parent_hypothesis_id || '').trim();
    if (!parentId) return acc;
    const current = acc.get(parentId) || [];
    current.push(hypothesis);
    acc.set(parentId, current);
    return acc;
  }, new Map()), [hypotheses]);

  useEffect(() => {
    setHypothesisMapLayoutById(hypothesisMapLayout && typeof hypothesisMapLayout === 'object' ? hypothesisMapLayout : {});
  }, [hypothesisMapLayout]);

  useEffect(() => {
    hypothesisMapLayoutRef.current = hypothesisMapLayoutById || {};
  }, [hypothesisMapLayoutById]);

  const persistHypothesisMapLayout = (nextLayout) => {
    const normalizedLayout = nextLayout && typeof nextLayout === 'object' ? nextLayout : {};
    if (JSON.stringify(hypothesisMapLayout) === JSON.stringify(normalizedLayout)) return;
    persist({ ...store, hypothesisMapLayout: normalizedLayout });
  };

  const hypothesisMapVisibleHypotheses = useMemo(() => {
    const filterId = String(hypothesisMapFilter || '').trim();
    if (!filterId) return hypotheses;
    const visible = new Set();
    visible.add(filterId);
    let current = hypothesisById.get(filterId);
    while (current) {
      const parentId = String(current.parent_hypothesis_id || '').trim();
      if (!parentId) break;
      visible.add(parentId);
      current = hypothesisById.get(parentId);
    }
    const addDescendants = (parentId) => {
      const children = childHypothesesByParentId.get(String(parentId)) || [];
      children.forEach((child) => {
        visible.add(String(child.id));
        addDescendants(String(child.id));
      });
    };
    addDescendants(filterId);
    return hypotheses.filter((h) => visible.has(String(h.id)));
  }, [hypotheses, hypothesisMapFilter, hypothesisById, childHypothesesByParentId]);

  const hypothesisMapProblemFilterOptions = useMemo(
    () => hypotheses.filter((hypothesis) => normalizeCommentHypothesisType(hypothesis.type) === 'problema'),
    [hypotheses],
  );

  useEffect(() => {
    const filterId = String(hypothesisMapFilter || '').trim();
    if (!filterId) return;
    const selectedHypothesis = hypothesisById.get(filterId);
    if (normalizeCommentHypothesisType(selectedHypothesis?.type) !== 'problema') {
      setHypothesisMapFilter('');
    }
  }, [hypothesisMapFilter, hypothesisById]);

  const hypothesisMapNodes = useMemo(() => hypothesisMapVisibleHypotheses.map((hypothesis, index) => {
    const saved = hypothesisMapLayoutById[hypothesis.id] || {};
    const x = Number(saved.x);
    const y = Number(saved.y);
    return {
      ...hypothesis,
      x: Number.isFinite(x) ? x : 120 + ((index % 4) * 300),
      y: Number.isFinite(y) ? y : 80 + (Math.floor(index / 4) * 180),
    };
  }), [hypothesisMapVisibleHypotheses, hypothesisMapLayoutById]);

  const hypothesisMapVisibleIdSet = useMemo(() => new Set(hypothesisMapNodes.map((h) => String(h.id))), [hypothesisMapNodes]);

  const hypothesisMapEdges = useMemo(() => hypothesisMapNodes
    .filter((h) => h.parent_hypothesis_id && hypothesisMapVisibleIdSet.has(String(h.parent_hypothesis_id)))
    .map((h) => ({
      id: `edge_${h.parent_hypothesis_id}_${h.id}`,
      source: String(h.parent_hypothesis_id),
      target: String(h.id),
    })), [hypothesisMapNodes, hypothesisMapVisibleIdSet]);

  const hypothesisMapRenderableNodesById = useMemo(() => new Map(hypothesisMapNodes.map((node) => [String(node.id), node])), [hypothesisMapNodes]);

  const buildCodeMapAnalysisSession = ({ targetType = 'code', targetId = '', subject = {}, linkedFragments, relatedCodes, analysis }) => {
    const now = new Date().toISOString();
    const normalizedType = String(targetType || 'code').trim() === 'profile' ? 'profile' : 'code';
    const normalizedId = String(targetId || '').trim();
    const sessionId = `code_map_analysis_${normalizedType}_${normalizedId}`;
    return {
      analysis_session_id: sessionId,
      target_type: normalizedType,
      target_id: normalizedId,
      code_slug: normalizedType === 'code' ? normalizedId : '',
      code_name: normalizedType === 'code' ? String(subject?.name || '').trim() : '',
      code_description: normalizedType === 'code' ? String(subject?.description || '').trim() : '',
      profile_id: normalizedType === 'profile' ? normalizedId : '',
      profile_name: normalizedType === 'profile' ? String(subject?.name || '').trim() : '',
      profile_description: normalizedType === 'profile' ? String(subject?.description || '').trim() : '',
      fragments_snapshot: linkedFragments,
      related_codes_snapshot: relatedCodes,
      initial_report: analysis,
      agent_outputs: {
        dolores: analysis?.dolores || { analysis: '', citations: [] },
        deseos: analysis?.deseos || { analysis: '', citations: [] },
        placeres: analysis?.placeres || { analysis: '', citations: [] },
        problemas: analysis?.problemas || { analysis: '', citations: [] },
        soluciones: analysis?.soluciones || { analysis: '', citations: [] },
        refinador: {
          summary_absolute: String(analysis?.summary_absolute || '').trim(),
        },
        optimizador_final: analysis?.sintesis_final || { analysis: '', citations: [] },
      },
      conversation_history: [
        {
          id: `assistant_initial_${Date.now()}`,
          role: 'assistant',
          content: buildCodeMapInitialAssistantReport(analysis, subject, normalizedType),
          created_at: now,
          type: 'initial_report',
        },
      ],
      memory_summary: String(analysis?.summary_absolute || '').trim().slice(0, 900),
      created_at: now,
      updated_at: now,
      version: 1,
    };
  };

  const saveCodeMapAnalysisSession = (session) => {
    const targetType = String(session?.target_type || (session?.profile_id ? 'profile' : 'code')).trim();
    const targetId = String(session?.target_id || (targetType === 'profile' ? session?.profile_id : session?.code_slug) || '').trim();
    if (!targetId) return;
    const key = buildCodeMapAnalysisSessionKey(targetType, targetId);
    persist({
      ...store,
      codeMapAnalysisSessions: {
        ...codeMapAnalysisSessions,
        [key]: {
          ...session,
          target_type: targetType,
          target_id: targetId,
          updated_at: new Date().toISOString(),
        },
      },
    });
  };

  const openCodeMapAiAnalysis = async (codeSlug, options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const slug = String(codeSlug || '').trim();
    if (!slug) return;
    const code = codes.find((item) => String(item.slug) === slug);
    if (!code) return;

    const linkedFragments = fragments
      .filter((fragment) => Array.isArray(fragment.code_slugs) && fragment.code_slugs.includes(slug))
      .slice(0, 120)
      .map((fragment, index) => ({
        fragment_id: String(fragment.id || `fragment_${index + 1}`),
        excerpt: String(fragment.excerpt || fragment.selected_text || '').trim(),
        source_comment_id: String(fragment.source_comment_id || fragment.comment_id || '').trim(),
      }))
      .filter((fragment) => fragment.excerpt);

    if (!linkedFragments.length) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: 'Este código no tiene fragmentos vinculados con evidencia suficiente para analizar.',
        targetType: 'code',
        targetId: slug,
        title: String(code.name || slug),
        result: null,
        sessionId: '',
      });
      return;
    }

    const relatedCodes = codes
      .filter((item) => String(item.slug) !== slug)
      .map((item) => ({
        ...item,
        overlap: fragments.reduce((acc, fragment) => {
          const slugs = Array.isArray(fragment.code_slugs) ? fragment.code_slugs : [];
          return slugs.includes(slug) && slugs.includes(String(item.slug)) ? acc + 1 : acc;
        }, 0),
      }))
      .filter((item) => item.overlap > 0 || String(item.parent_slug || '') === slug || String(code.parent_slug || '') === String(item.slug || ''))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 10)
      .map((item) => ({
        slug: String(item.slug || '').trim(),
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        relation: String(item.parent_slug || '') === slug ? 'child' : String(code.parent_slug || '') === String(item.slug || '') ? 'parent' : 'cooccurrence',
      }))
      .filter((item) => item.slug && item.name);

    const sessionKey = buildCodeMapAnalysisSessionKey('code', slug);
    const existingSession = codeMapAnalysisSessions[sessionKey] || codeMapAnalysisSessions[slug];
    if (!forceRefresh && existingSession?.initial_report) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: '',
        targetType: 'code',
        targetId: slug,
        title: String(code.name || slug),
        result: existingSession.initial_report,
        sessionId: String(existingSession.analysis_session_id || ''),
      });
      return;
    }

    setCodeMapAiModal({ open: true, loading: true, sending: false, error: '', targetType: 'code', targetId: slug, title: String(code.name || slug), result: null, sessionId: '' });

    try {
      const analysis = await commentsIngestionApi.runCodeMapAnalysisAgent({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        code: {
          slug,
          name: String(code.name || '').trim(),
          description: String(code.description || '').trim(),
        },
        fragments: linkedFragments,
        related_codes: relatedCodes,
      });

      const nextSession = buildCodeMapAnalysisSession({ targetType: 'code', targetId: slug, subject: code, linkedFragments, relatedCodes, analysis });
      saveCodeMapAnalysisSession(nextSession);
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: '',
        targetType: 'code',
        targetId: slug,
        title: String(code.name || slug),
        result: analysis,
        sessionId: String(nextSession.analysis_session_id || ''),
      });
    } catch (error) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: error?.message || 'No se pudo generar el análisis IA del código.',
        targetType: 'code',
        targetId: slug,
        title: String(code.name || slug),
        result: null,
        sessionId: '',
      });
    }
  };

  const openProfileMapAiAnalysis = async (profileId, options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const normalizedProfileId = String(profileId || '').trim();
    if (!normalizedProfileId) return;
    const profile = codeMapProfileNodes.find((item) => String(item.id) === normalizedProfileId);
    if (!profile) return;

    const profileCodeSlugs = Object.entries(codeMapProfileAssignments)
      .filter(([, pid]) => String(pid || '') === normalizedProfileId)
      .map(([codeSlug]) => String(codeSlug || '').trim())
      .filter(Boolean);

    if (!profileCodeSlugs.length) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: 'Este perfil no tiene códigos vinculados para analizar.',
        targetType: 'profile',
        targetId: normalizedProfileId,
        title: String(profile.name || 'Perfil estratégico'),
        result: null,
        sessionId: '',
      });
      return;
    }

    const profileCodes = codes.filter((item) => profileCodeSlugs.includes(String(item.slug || '')));
    const linkedFragments = fragments
      .filter((fragment) => {
        const slugs = Array.isArray(fragment.code_slugs) ? fragment.code_slugs.map((s) => String(s || '')) : [];
        return slugs.some((slug) => profileCodeSlugs.includes(slug));
      })
      .slice(0, 240)
      .map((fragment, index) => ({
        fragment_id: String(fragment.id || `fragment_${index + 1}`),
        excerpt: String(fragment.excerpt || fragment.selected_text || '').trim(),
        source_comment_id: String(fragment.source_comment_id || fragment.comment_id || '').trim(),
        code_slugs: Array.isArray(fragment.code_slugs) ? fragment.code_slugs.map((slug) => String(slug || '').trim()).filter((slug) => profileCodeSlugs.includes(slug)) : [],
      }))
      .filter((fragment) => fragment.excerpt && Array.isArray(fragment.code_slugs) && fragment.code_slugs.length);

    if (!linkedFragments.length) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: 'Este perfil no tiene fragmentos asociados en sus códigos vinculados.',
        targetType: 'profile',
        targetId: normalizedProfileId,
        title: String(profile.name || 'Perfil estratégico'),
        result: null,
        sessionId: '',
      });
      return;
    }

    const relatedCodes = profileCodes.map((item) => ({
      slug: String(item.slug || '').trim(),
      name: String(item.name || '').trim(),
      description: String(item.description || '').trim(),
      parent_slug: String(item.parent_slug || '').trim(),
      relation: String(item.parent_slug || '').trim() ? (profileCodeSlugs.includes(String(item.parent_slug || '').trim()) ? 'hierarchy_child_in_profile' : 'hierarchy_child') : 'profile_member',
    })).filter((item) => item.slug && item.name);

    const sessionKey = buildCodeMapAnalysisSessionKey('profile', normalizedProfileId);
    const existingSession = codeMapAnalysisSessions[sessionKey];
    if (!forceRefresh && existingSession?.initial_report) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: '',
        targetType: 'profile',
        targetId: normalizedProfileId,
        title: String(profile.name || 'Perfil estratégico'),
        result: existingSession.initial_report,
        sessionId: String(existingSession.analysis_session_id || ''),
      });
      return;
    }

    setCodeMapAiModal({ open: true, loading: true, sending: false, error: '', targetType: 'profile', targetId: normalizedProfileId, title: String(profile.name || 'Perfil estratégico'), result: null, sessionId: '' });

    try {
      const analysis = await commentsIngestionApi.runProfileCodeMapAnalysisAgent({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        profile: {
          id: normalizedProfileId,
          name: String(profile.name || 'Perfil estratégico').trim(),
          description: String(profile.description || '').trim(),
        },
        codes: relatedCodes,
        fragments: linkedFragments,
      });

      const nextSession = buildCodeMapAnalysisSession({ targetType: 'profile', targetId: normalizedProfileId, subject: profile, linkedFragments, relatedCodes, analysis });
      saveCodeMapAnalysisSession(nextSession);
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: '',
        targetType: 'profile',
        targetId: normalizedProfileId,
        title: String(profile.name || 'Perfil estratégico'),
        result: analysis,
        sessionId: String(nextSession.analysis_session_id || ''),
      });
    } catch (error) {
      setCodeMapAiModal({
        open: true,
        loading: false,
        sending: false,
        error: error?.message || 'No se pudo generar el análisis IA del perfil.',
        targetType: 'profile',
        targetId: normalizedProfileId,
        title: String(profile.name || 'Perfil estratégico'),
        result: null,
        sessionId: '',
      });
    }
  };

  const refreshCodeMapAiChat = async () => {
    const targetType = String(codeMapAiModal.targetType || 'code').trim();
    const targetId = String(codeMapAiModal.targetId || '').trim();
    if (!targetId || codeMapAiModal.loading || codeMapAiModal.sending) return;

    const nextSessions = { ...codeMapAnalysisSessions };
    delete nextSessions[buildCodeMapAnalysisSessionKey(targetType, targetId)];
    persist({
      ...store,
      codeMapAnalysisSessions: nextSessions,
    });

    setCodeMapAiInput('');
    if (targetType === 'profile') {
      await openProfileMapAiAnalysis(targetId, { forceRefresh: true });
      return;
    }
    await openCodeMapAiAnalysis(targetId, { forceRefresh: true });
  };

  const sendCodeMapAiMessage = async () => {
    const targetType = String(codeMapAiModal.targetType || 'code').trim();
    const targetId = String(codeMapAiModal.targetId || '').trim();
    const question = String(codeMapAiInput || '').trim();
    if (!targetId || !question || codeMapAiModal.sending) return;
    const session = codeMapAnalysisSessions[buildCodeMapAnalysisSessionKey(targetType, targetId)] || codeMapAnalysisSessions[targetId];
    if (!session?.initial_report) return;

    const userMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
      type: 'question',
    };

    const nextHistory = [...(Array.isArray(session.conversation_history) ? session.conversation_history : []), userMessage];
    const draftSession = {
      ...session,
      target_type: targetType,
      target_id: targetId,
      conversation_history: nextHistory,
      updated_at: new Date().toISOString(),
    };
    saveCodeMapAnalysisSession(draftSession);
    setCodeMapAiInput('');
    setCodeMapAiModal((prev) => ({ ...prev, sending: true, error: '' }));

    try {
      const response = await commentsIngestionApi.runCodeMapAnalysisChatTurn({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        question,
        analysis_session: draftSession,
      });
      const assistantMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: String(response?.answer || '').trim() || 'No tengo suficiente evidencia para responder con precisión.',
        created_at: new Date().toISOString(),
        type: 'answer',
        citations: Array.isArray(response?.citations) ? response.citations : [],
      };

      const persisted = {
        ...draftSession,
        memory_summary: String(response?.memory_summary || draftSession.memory_summary || '').trim(),
        conversation_history: [...nextHistory, assistantMessage],
        updated_at: new Date().toISOString(),
      };
      saveCodeMapAnalysisSession(persisted);
      setCodeMapAiModal((prev) => ({ ...prev, sending: false, error: '' }));
    } catch (error) {
      setCodeMapAiModal((prev) => ({ ...prev, sending: false, error: error?.message || 'No se pudo responder en el chat de este análisis.' }));
    }
  };

  const closeCodeMapAiModal = () => {
    setCodeMapAiInput('');
    setCodeMapAiModal({ open: false, loading: false, sending: false, error: '', targetType: 'code', targetId: '', title: '', result: null, sessionId: '' });
  };

  const createCodeMapProfile = () => {
    setCodeMapProfileEditor({ open: true, mode: 'create', id: '', name: '', description: '' });
    setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
  };

  const saveCodeMapProfileEditor = () => {
    const name = String(codeMapProfileEditor.name || '').trim();
    if (!name) return;
    const profileId = String(codeMapProfileEditor.id || '').trim() || `profile_${Date.now()}`;
    const existing = codeMapProfileNodes.find((profile) => String(profile.id) === profileId);
    upsertCodeMapProfile({
      id: profileId,
      name,
      description: String(codeMapProfileEditor.description || '').trim(),
      x: Number(existing?.x) || 120,
      y: Number(existing?.y) || 56,
    });
    setCodeMapProfileEditor({ open: false, mode: 'create', id: '', name: '', description: '' });
  };

  const assignCodeToProfile = (codeSlug, profileId) => {
    const normalizedCodeSlug = String(codeSlug || '').trim();
    if (!normalizedCodeSlug) return;
    const normalizedProfileId = String(profileId || '').trim();
    const nextAssignments = { ...codeMapProfileAssignments };
    if (normalizedProfileId) nextAssignments[normalizedCodeSlug] = normalizedProfileId;
    else delete nextAssignments[normalizedCodeSlug];
    persistCodeMapVisualScope(codeMapScopeKey, {
      profiles: codeMapProfiles,
      assignments: nextAssignments,
      collapsed: codeMapProfileCollapsed,
    });
  };

  const toggleCodeMapProfileCollapsed = (profileId) => {
    const normalizedProfileId = String(profileId || '').trim();
    if (!normalizedProfileId) return;
    persistCodeMapVisualScope(codeMapScopeKey, {
      profiles: codeMapProfiles,
      assignments: codeMapProfileAssignments,
      collapsed: {
        ...codeMapProfileCollapsed,
        [normalizedProfileId]: !codeMapProfileCollapsed[normalizedProfileId],
      },
    });
  };

  const handleCodeMapProfileMouseDown = (event, profileId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const id = String(profileId || '').trim();
    const startX = event.clientX;
    const startY = event.clientY;
    const startProfile = codeMapProfileNodes.find((profile) => String(profile.id) === id) || { x: 0, y: 0 };
    const startNodeX = Number(startProfile.x) || 0;
    const startNodeY = Number(startProfile.y) || 0;

    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / (codeMapZoom || 1);
      const deltaY = (moveEvent.clientY - startY) / (codeMapZoom || 1);
      upsertCodeMapProfile({
        ...startProfile,
        id,
        x: Math.max(12, Math.round(startNodeX + deltaX)),
        y: Math.max(12, Math.round(startNodeY + deltaY)),
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCodeMapNodeMouseDown = (event, slug) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingCodeMapNode(slug);
    setSelectedCodeMapNode(slug);
    setSelectedCodeMapEdge('');
    const startX = event.clientX;
    const startY = event.clientY;
    const start = codeMapLayoutBySlug[slug] || codeMapNodes.find((node) => node.slug === slug) || { x: 0, y: 0 };
    const startNodeX = Number(start.x) || 0;
    const startNodeY = Number(start.y) || 0;

    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / (codeMapZoom || 1);
      const deltaY = (moveEvent.clientY - startY) / (codeMapZoom || 1);
      setCodeMapLayoutBySlug((prev) => ({
        ...prev,
        [slug]: {
          x: Math.max(12, Math.round(startNodeX + deltaX)),
          y: Math.max(12, Math.round(startNodeY + deltaY)),
        },
      }));
    };

    const onUp = (upEvent) => {
      setDraggingCodeMapNode('');
      persistCodeMapLayoutForScope(codeMapScopeKey, codeMapLayoutRef.current);
      const profileElement = upEvent?.target?.closest?.('[data-code-map-profile-id]');
      if (profileElement) {
        assignCodeToProfile(slug, profileElement.getAttribute('data-code-map-profile-id'));
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCodeMapCanvasMouseDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('[data-code-map-node="true"]') || event.target.closest('[data-code-map-profile="true"]')) return;
    setSelectedCodeMapNode('');
    setSelectedCodeMapEdge('');
    setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
    setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
    setIsCodeMapPanning(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startPan = { ...codeMapPan };

    const onMove = (moveEvent) => {
      setCodeMapPan({
        x: startPan.x + (moveEvent.clientX - startX),
        y: startPan.y + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      setIsCodeMapPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!codeMapOpen) return;
      if (!selectedCodeMapEdge) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const edge = codeMapEdges.find((item) => item.id === selectedCodeMapEdge);
      if (!edge) return;
      if (String(edge.type || '') === 'profile_link') {
        assignCodeToProfile(edge.target, '');
      } else {
        setCodeParent(edge.target, '');
      }
      setSelectedCodeMapEdge('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [codeMapOpen, selectedCodeMapEdge, codeMapEdges]);

  const handleHypothesisMapNodeMouseDown = (event, id) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingHypothesisMapNode(id);
    setSelectedHypothesisMapNode(id);
    setSelectedHypothesisMapEdge('');
    const startX = event.clientX;
    const startY = event.clientY;
    const start = hypothesisMapLayoutById[id] || hypothesisMapNodes.find((node) => node.id === id) || { x: 0, y: 0 };
    const startNodeX = Number(start.x) || 0;
    const startNodeY = Number(start.y) || 0;
    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / (hypothesisMapZoom || 1);
      const deltaY = (moveEvent.clientY - startY) / (hypothesisMapZoom || 1);
      setHypothesisMapLayoutById((prev) => ({
        ...prev,
        [id]: {
          x: Math.max(12, Math.round(startNodeX + deltaX)),
          y: Math.max(12, Math.round(startNodeY + deltaY)),
        },
      }));
    };
    const onUp = () => {
      setDraggingHypothesisMapNode('');
      persistHypothesisMapLayout(hypothesisMapLayoutRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleHypothesisMapCanvasMouseDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('[data-hypothesis-map-node="true"]')) return;
    setSelectedHypothesisMapNode('');
    setSelectedHypothesisMapEdge('');
    setIsHypothesisMapPanning(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startPan = { ...hypothesisMapPan };
    const onMove = (moveEvent) => {
      setHypothesisMapPan({
        x: startPan.x + (moveEvent.clientX - startX),
        y: startPan.y + (moveEvent.clientY - startY),
      });
    };
    const onUp = () => {
      setIsHypothesisMapPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const updateFragment = (fragmentId, patch) => {
    const nextFragments = fragments.map((fragment) => {
      if (String(fragment.id) !== String(fragmentId)) return fragment;
      return { ...fragment, ...patch };
    });
    persist({ ...store, fragments: nextFragments });
  };

  const openFragmentEditor = (fragment = null, mode = 'edit') => {
    setFragmentMenuId('');
    if (!fragment || mode === 'create') {
      setFragmentEditor({
        open: true,
        mode: 'create',
        fragmentId: '',
        title: '',
        excerpt: '',
        linkedCode: '',
        sourceCommentId: '',
        sourceType: '',
        sourceCommentText: '',
        selectedText: '',
        selectionStart: null,
        selectionEnd: null,
      });
      return;
    }
    setFragmentEditor({
      open: true,
      mode: 'edit',
      fragmentId: String(fragment.id),
      title: String(fragment.title || ''),
      excerpt: String(fragment.excerpt || ''),
      linkedCode: Array.isArray(fragment.code_slugs) ? String(fragment.code_slugs[0] || '') : '',
      sourceCommentId: String(fragment.source_comment_id || fragment.comment_id || ''),
      sourceType: String(fragment.source_type || ''),
      sourceCommentText: String(fragment.source_comment_text || ''),
      selectedText: String(fragment.selected_text || fragment.excerpt || ''),
      selectionStart: Number.isFinite(Number(fragment.selection_start)) ? Number(fragment.selection_start) : null,
      selectionEnd: Number.isFinite(Number(fragment.selection_end)) ? Number(fragment.selection_end) : null,
    });
  };

  const closeFragmentEditor = () => {
    setFragmentEditor((prev) => ({ ...prev, open: false }));
  };

  const saveFragmentEditor = async () => {
    const title = String(fragmentEditor.title || '').trim();
    const excerpt = String(fragmentEditor.excerpt || '').trim();
    const linkedCode = String(fragmentEditor.linkedCode || '').trim();
    const codeSlugs = linkedCode && codes.some((code) => String(code.slug) === linkedCode) ? [linkedCode] : [];

    if (!excerpt) return;

    if (fragmentEditor.mode === 'create') {
      const nextFragment = {
        id: `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title,
        excerpt,
        code_slugs: codeSlugs,
        source_type: 'manual',
        created_at: new Date().toISOString(),
      };
      let fragmentToStore = nextFragment;
      try {
        const [enrichedFragment] = await enrichFragmentsForIaSelection([nextFragment]);
        fragmentToStore = enrichedFragment || nextFragment;
      } catch {
        fragmentToStore = nextFragment;
      }
      persist({ ...store, fragments: [fragmentToStore, ...fragments] });
      setSelectedFragmentId(String(nextFragment.id));
      closeFragmentEditor();
      return;
    }

    updateFragment(fragmentEditor.fragmentId, {
      title,
      excerpt,
      code_slugs: codeSlugs,
    });
    setSelectedFragmentId(String(fragmentEditor.fragmentId));
    closeFragmentEditor();
  };

  const toggleFragmentSelection = (fragmentId) => {
    const id = String(fragmentId);
    setSelectedFragmentIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const deleteFragments = (fragmentIds = []) => {
    const ids = Array.from(new Set((fragmentIds || []).map((item) => String(item)).filter(Boolean)));
    if (!ids.length) return;
    const nextFragments = fragments.filter((fragment) => !ids.includes(String(fragment.id)));
    persist({ ...store, fragments: nextFragments });
    setSelectedFragmentIds((prev) => prev.filter((id) => !ids.includes(String(id))));
  };

  const deleteSingleFragment = (fragmentId) => {
    const id = String(fragmentId);
    if (!window.confirm('¿Eliminar este fragmento?')) return;
    deleteFragments([id]);
  };

  const deleteSelectedFragments = () => {
    if (!selectedFragmentIds.length) return;
    if (!window.confirm(`¿Eliminar ${selectedFragmentIds.length} fragmento(s) seleccionados?`)) return;
    deleteFragments(selectedFragmentIds);
  };

  const deleteAllFragments = () => {
    if (!fragments.length) return;
    if (!window.confirm(`¿Eliminar todos los fragmentos (${fragments.length})? Esta acción no se puede deshacer.`)) return;
    persist({ ...store, fragments: [] });
    setSelectedFragmentIds([]);
    setSelectedFragmentId('');
    setFragmentMenuId('');
  };


  const codeCard = useMemo(() => {
    const slug = String(codeCardSlug || '').trim();
    if (!slug) return null;
    const code = codes.find((item) => String(item.slug) === slug);
    if (!code) return null;

    const relatedFragments = fragments
      .filter((fragment) => Array.isArray(fragment.code_slugs) && fragment.code_slugs.includes(slug))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    const uniqueComments = new Set();
    const uniqueVideos = new Set();
    const uniqueRuns = new Set();
    const uniqueSources = new Set();
    const sentimentCounts = { positivo: 0, neutral: 0, negativo: 0 };

    const positiveWords = ['excelente', 'genial', 'bueno', 'encanta', 'feliz', 'mejor', 'increible', 'increíble', 'recomiendo', 'satisfecho'];
    const negativeWords = ['malo', 'terrible', 'odio', 'horrible', 'peor', 'problema', 'queja', 'frustrante', 'caro', 'lento'];
    const intensityWords = ['nunca', 'siempre', 'urgente', 'demasiado', 'super', 'totalmente', 'increible', 'increíble'];

    const tokenizeLocal = (text = '') => String(text || '').toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2);

    const tokenizedRows = [];
    let sentimentSum = 0;
    let semanticRichnessAcc = 0;
    let semanticRichnessCount = 0;
    let intensityAcc = 0;

    for (const fragment of relatedFragments) {
      const text = String(fragment.excerpt || fragment.selected_text || '').trim();
      const commentKey = String(fragment.source_comment_id || fragment.comment_id || '').trim();
      const videoKey = String(fragment.video_id || '').trim();
      const runKey = String(fragment.source_run_id || '').trim();
      const sourceKey = String(fragment.source_type || fragment.execution_origin || '').trim();
      if (commentKey) uniqueComments.add(commentKey);
      if (videoKey) uniqueVideos.add(videoKey);
      if (runKey) uniqueRuns.add(runKey);
      if (sourceKey) uniqueSources.add(sourceKey);

      const tokens = tokenizeLocal(text);
      tokenizedRows.push(tokens);

      let posHits = 0;
      let negHits = 0;
      for (const token of tokens) {
        if (positiveWords.includes(token)) posHits += 1;
        if (negativeWords.includes(token)) negHits += 1;
      }
      const sentimentScore = posHits - negHits;
      sentimentSum += sentimentScore;
      if (sentimentScore > 0) sentimentCounts.positivo += 1;
      else if (sentimentScore < 0) sentimentCounts.negativo += 1;
      else sentimentCounts.neutral += 1;

      const semanticConfidence = Number(fragment.semantic_confidence);
      if (Number.isFinite(semanticConfidence)) {
        semanticRichnessAcc += Math.max(0, Math.min(1, semanticConfidence));
        semanticRichnessCount += 1;
      }

      const exclamations = (text.match(/!/g) || []).length;
      const uppercaseTokens = text.split(/\s+/).filter((token) => token.length > 2 && token === token.toUpperCase()).length;
      const emphasisWords = tokens.filter((token) => intensityWords.includes(token)).length;
      const textLengthFactor = Math.min(1, text.length / 280);
      const rawIntensity = (exclamations * 0.15) + (uppercaseTokens * 0.1) + (emphasisWords * 0.2) + (textLengthFactor * 0.55);
      intensityAcc += Math.max(0, Math.min(1, rawIntensity));
    }

    const tokenFreq = new Map();
    tokenizedRows.flat().forEach((token) => tokenFreq.set(token, Number(tokenFreq.get(token) || 0) + 1));
    const topTerms = Array.from(tokenFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const centroid = new Set(topTerms.slice(0, 8).map(([token]) => token));

    const coherenceScores = tokenizedRows.map((tokens) => {
      if (!tokens.length || !centroid.size) return 0;
      const uniqueTokens = new Set(tokens);
      let overlap = 0;
      uniqueTokens.forEach((token) => {
        if (centroid.has(token)) overlap += 1;
      });
      return overlap / Math.max(1, uniqueTokens.size);
    });

    const coherence = coherenceScores.length
      ? Math.round((coherenceScores.reduce((acc, value) => acc + value, 0) / coherenceScores.length) * 100)
      : 0;

    const intensity = relatedFragments.length
      ? Math.round((intensityAcc / relatedFragments.length) * 100)
      : 0;

    const sentimentAverage = relatedFragments.length ? Number((sentimentSum / relatedFragments.length).toFixed(2)) : 0;
    const semanticRichness = semanticRichnessCount
      ? Number(((semanticRichnessAcc / semanticRichnessCount) * 100).toFixed(1))
      : 0;

    const distributionByMonthMap = new Map();
    for (const fragment of relatedFragments) {
      const rawDate = fragment.created_at ? new Date(fragment.created_at) : null;
      if (!rawDate || Number.isNaN(rawDate.getTime())) continue;
      const key = `${rawDate.getUTCFullYear()}-${String(rawDate.getUTCMonth() + 1).padStart(2, '0')}`;
      distributionByMonthMap.set(key, Number(distributionByMonthMap.get(key) || 0) + 1);
    }

    const distributionByMonth = Array.from(distributionByMonthMap.entries())
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));

    const hierarchy = {
      parent: code.parent_slug ? codes.find((item) => String(item.slug) === String(code.parent_slug)) || null : null,
      children: codes.filter((item) => String(item.parent_slug || '') === String(code.slug || '')),
    };

    const score = codeScoreBySlug.get(slug) || {
      score_total: 0,
      score_frecuencia: 0,
      score_dispersion: 0,
      score_consistencia: 0,
      score_intensidad: 0,
    };

    return {
      code,
      score,
      fragments: relatedFragments,
      metrics: {
        frequency: relatedFragments.length,
        uniqueComments: uniqueComments.size,
        uniqueVideos: uniqueVideos.size,
        uniqueRuns: uniqueRuns.size,
        uniqueSources: uniqueSources.size,
        sentimentAverage,
        sentimentCounts,
        semanticRichness,
        coherence,
        intensity,
        distributionByMonth,
      },
      hierarchy,
      topTerms,
    };
  }, [codeCardSlug, codes, fragments, codeScoreBySlug]);

  const removeFragmentFromCodeCard = (fragmentId) => {
    if (!codeCard) return;
    const target = fragments.find((fragment) => String(fragment.id) === String(fragmentId));
    if (!target) return;
    if (!window.confirm('¿Eliminar este fragmento del código actual?')) return;
    deleteFragments([fragmentId]);
  };

  const removeAllFragmentsFromCodeCard = () => {
    if (!codeCard?.fragments?.length) return;
    if (!window.confirm(`¿Eliminar todos los fragmentos de ${codeCard.code.name}? (${codeCard.fragments.length})`)) return;
    deleteFragments(codeCard.fragments.map((fragment) => String(fragment.id)));
    setCodeCardDeleteMenuOpen(false);
  };

  const goToFragmentOrigin = async (fragment) => {
    if (!fragment) return;
    const sourceCommentId = String(fragment.source_comment_id || fragment.comment_id || '').trim();
    if (!sourceCommentId) {
      window.alert('Este fragmento no tiene comentario de origen asociado.');
      return;
    }

    const findReaderComment = (items = []) => items.find((item) => {
      const rowId = String(item.id || '').trim();
      const rowSourceId = String(item.source_comment_id || '').trim();
      return rowId === sourceCommentId || rowSourceId === sourceCommentId;
    }) || null;

    let originComment = findReaderComment(readerComments);
    if (!originComment) {
      const data = await commentsIngestionApi.listTable({
        projectId,
        campaignId,
        workspaceId: workspaceContext.workspaceId,
        limit: commentsTable.limit,
        offset: 0,
        q: '',
      });
      const fetchedItems = Array.isArray(data.items) ? data.items : [];
      setCommentsTable((prev) => ({
        ...prev,
        items: fetchedItems,
        total: Number(data.total || 0),
        offset: 0,
        q: '',
        error: '',
      }));
      originComment = findReaderComment(fetchedItems);
    }

    if (!originComment) {
      window.alert('No se encontró el comentario de origen en la base de comentarios cargada.');
      return;
    }

    setTab('reader');
    setSelectedReaderCommentId(String(originComment.id));
    setReaderSelection({ text: '', start: null, end: null, commentId: '' });
  };


  const runGenerateCodesWithoutTraceability = async () => {
    setCodeGenerationError('');
    setCodeGenerationBusy(true);
    setCodeGenerationModalOpen(true);

    try {
      const tableTotalEstimate = Number(commentsTable.total || 0);

      const response = await commentsIngestionApi.runCodeGenerationAgent({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        comments: [],
      });

      const proposals = Array.isArray(response?.proposals) ? response.proposals : [];
      const normalizedProposals = proposals.map((proposal, index) => {
        const suggestedName = normalizeGeneratedProposalName(
          proposal.suggested_code_name || proposal.cluster_name,
          'Dinámica emocional recurrente',
        );
        const clusterName = normalizeGeneratedProposalName(
          proposal.cluster_name || proposal.suggested_code_name,
          'Patrón semántico dominante',
        );

        return {
          id: `generated_code_proposal_${Date.now()}_${index + 1}`,
          cluster_name: clusterName,
          suggested_code_name: suggestedName,
          description: normalizeGeneratedProposalDescription(proposal.description, suggestedName),
          confidence: Number(proposal.confidence || 0),
          size_estimate: Number(proposal.size_estimate || 0),
          subclusters: Array.isArray(proposal.subclusters) ? proposal.subclusters : [],
          generated_without_traceability: true,
        };
      });

      setGeneratedCodeProposals(normalizedProposals);
      if (!normalizedProposals.length) {
        const stopReason = String(response?.metrics?.stop_reason || '').trim();
        setCodeGenerationError(
          stopReason
            ? `La IA no devolvió propuestas utilizables (stop_reason: ${stopReason}). Intenta nuevamente con más comentarios o ajusta la integración IA.`
            : 'La IA no devolvió propuestas utilizables. Intenta nuevamente con más comentarios o ajusta la integración IA.',
        );
      }
      setCodeGenerationMetrics({
        ...(response?.metrics || {}),
        comments_fetched_for_generation: Number(response?.metrics?.comments_analyzed || 0),
        comments_total_from_table: Number(response?.metrics?.comments_analyzed || 0) || tableTotalEstimate,
      });
    } catch (error) {
      setCodeGenerationError(error?.message || 'No se pudo generar propuestas desde comentarios.');
    } finally {
      setCodeGenerationBusy(false);
    }
  };

  const createCodeFromGeneratedProposal = (proposal) => {
    if (!proposal) return;
    const parentCode = createUniqueCode({
      name: String(proposal.suggested_code_name || proposal.cluster_name || 'Código generado').trim(),
      description: `${String(proposal.description || '').trim()} [GENERADO SIN TRAZABILIDAD]`,
      createdManual: true,
    });

    const children = (Array.isArray(proposal.subclusters) ? proposal.subclusters : []).map((subcluster) => createUniqueCode({
      name: String(subcluster.suggested_subcode_name || subcluster.cluster_name || 'Subcódigo generado').trim(),
      description: `${String(subcluster.description || 'Subpatrón generado sin trazabilidad inicial.').trim()} [GENERADO SIN TRAZABILIDAD]`,
      parentSlug: parentCode.slug,
      createdManual: true,
    }));

    const taggedParent = {
      ...parentCode,
      generated_without_traceability: true,
      generation_source: 'comments_cluster_generation',
      taxonomy_stage: 'discovery',
    };

    const taggedChildren = children.map((item) => ({
      ...item,
      generated_without_traceability: true,
      generation_source: 'comments_subcluster_generation',
      taxonomy_stage: 'discovery',
    }));

    persist({
      ...store,
      codes: [taggedParent, ...taggedChildren, ...codes],
    });

    setGeneratedCodeProposals((prev) => prev.filter((item) => String(item.id) !== String(proposal.id)));
  };

  const filteredFragments = useMemo(() => {
    const query = fragmentQuery.trim().toLowerCase();
    return fragments.filter((fragment) => {
      const title = String(fragment.title || '').toLowerCase();
      const excerpt = String(fragment.excerpt || '').toLowerCase();
      const matchesQuery = !query || title.includes(query) || excerpt.includes(query);
      const matchesCode = !fragmentCodeFilter || (fragment.code_slugs || []).includes(fragmentCodeFilter);
      const matchesClient = !fragmentClientFilter || String(fragment.client_id || '') === fragmentClientFilter;
      const matchesInterview = !fragmentInterviewFilter || String(fragment.interview_id || '') === fragmentInterviewFilter;
      return matchesQuery && matchesCode && matchesClient && matchesInterview;
    });
  }, [fragments, fragmentCodeFilter, fragmentClientFilter, fragmentInterviewFilter, fragmentQuery]);

  const renderFragmentSourceWithHighlight = (fragment) => {
    const sourceText = String(fragment?.source_comment_text || '');
    const start = Number(fragment?.selection_start);
    const end = Number(fragment?.selection_end);

    if (!sourceText) return 'Sin comentario origen disponible.';
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > sourceText.length) {
      return sourceText;
    }

    return (
      <>
        {sourceText.slice(0, start)}
        <mark className="rounded bg-amber-100 px-0.5">{sourceText.slice(start, end)}</mark>
        {sourceText.slice(end)}
      </>
    );
  };

  const evolveFragmentToCode = () => {
    guardCodeEvolution();
  };

  const createCommentFragment = async ({ text, comment, sourceType = 'selection', selectionStart = null, selectionEnd = null }) => {
    const excerpt = String(text || '');
    if (!excerpt.trim() || !comment) return;
    const resolvedSourceCommentId = String(comment.source_comment_id || comment.id || '').trim();
    const sourceCommentText = String(comment.text || '');
    const nextFragment = {
      id: `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      title: '',
      excerpt,
      comment_id: comment.id,
      source_comment_id: resolvedSourceCommentId,
      source_comment_text: sourceCommentText,
      selected_text: excerpt,
      selection_start: Number.isFinite(Number(selectionStart)) ? Number(selectionStart) : null,
      selection_end: Number.isFinite(Number(selectionEnd)) ? Number(selectionEnd) : null,
      source_type: String(sourceType || 'manual'),
      video_id: comment.video_id || null,
      source_run_id: comment.source_run_id || null,
      author_name: comment.author_name || null,
      code_slugs: [],
      created_at: new Date().toISOString(),
    };
    const [enrichedFragment] = await enrichFragmentsForIaSelection([nextFragment]);
    persist({
      ...store,
      fragments: [enrichedFragment || nextFragment, ...fragments],
    });
    setReaderSelection({ text: '', start: null, end: null, commentId: '' });
  };

  const fetchAllReaderCommentsForAgent = async () => {
    const limit = Math.max(50, Number(commentsTable.limit || 100));
    const allRows = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let pages = 0;

    while (offset < total && pages < 100) {
      const data = await commentsIngestionApi.listTable({
        projectId,
        campaignId,
        workspaceId: workspaceContext.workspaceId,
        limit,
        offset,
        q: '',
      });
      const items = Array.isArray(data.items) ? data.items : [];
      total = Number(data.total || items.length || 0);
      allRows.push(...items);
      if (!items.length) break;
      offset += items.length;
      pages += 1;
    }

    const unique = [];
    const seen = new Set();
    for (const row of allRows) {
      const key = String(row.source_comment_id || row.id || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    return unique;
  };

  const runSemanticFragmentAgent = async () => {
    setSemanticAgentBusy(true);
    setSemanticAgentError('');
    setSemanticAgentProgress({ done: 0, total: 0 });

    try {
      const targetComments = await fetchAllReaderCommentsForAgent();
      if (!targetComments.length) {
        setSemanticAgentError('No hay comentarios disponibles para auto-fragmentar.');
        return;
      }

      const existingCodeCatalog = codes
        .map((code) => ({
          slug: String(code?.slug || '').trim(),
          name: String(code?.name || '').trim(),
          description: String(code?.description || '').trim(),
        }))
        .filter((code) => code.slug && code.name);

      if (!existingCodeCatalog.length) {
        setSemanticAgentError('Auto-fragmentar con IA requiere códigos existentes en el codebook.');
        return;
      }

      const existingSourceIds = new Set(
        fragments
          .map((fragment) => String(fragment.source_comment_id || fragment.comment_id || '').trim())
          .filter(Boolean),
      );

      const pendingComments = targetComments.filter((comment) => {
        const sourceCommentId = String(comment.source_comment_id || comment.id || '').trim();
        return sourceCommentId && !existingSourceIds.has(sourceCommentId);
      });

      if (!pendingComments.length) {
        setSemanticAgentError('Todos los comentarios ya tienen fragmentación previa.');
        return;
      }

      const BATCH_SIZE = Math.max(10, Math.min(20, Number(import.meta.env.VITE_AUTOFRAGMENT_BATCH_SIZE) || 10));
      const MAX_CONCURRENCY = Math.max(3, Math.min(5, Number(import.meta.env.VITE_AUTOFRAGMENT_CONCURRENCY) || 3));
      const MAX_BATCH_RETRIES = 2;
      const createdFragments = [];
      const rejectionDiagnostics = {
        baja_riqueza_semantica: 0,
        sin_codigo_razonable: 0,
        comentario_redundante: 0,
        texto_demasiado_vago: 0,
      };
      let failed = 0;
      let processed = 0;
      let persistedCount = 0;
      let persistedFragments = [];
      setSemanticAgentProgress({ done: 0, total: pendingComments.length });

      const commentsById = new Map(
        pendingComments.map((comment) => [String(comment.source_comment_id || comment.id || '').trim(), comment]),
      );

      const mapFragmentsFromResponse = ({ responseItems = [] }) => {
        const mapped = [];
        for (const item of responseItems) {
          const sourceCommentId = String(item?.comment_id || '').trim();
          const comment = commentsById.get(sourceCommentId);
          const sourceText = String(comment?.text || '').trim();
          if (!comment || !sourceCommentId || !sourceText) continue;
          const generatedFragments = Array.isArray(item?.fragments) ? item.fragments : [];
          const timestamp = new Date().toISOString();
          for (const fragment of generatedFragments) {
            const text = String(fragment?.fragment_text || '').trim();
            if (!text) continue;
            mapped.push({
              id: String(fragment?.fragment_id || `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`),
              title: '',
              excerpt: text,
              comment_id: sourceCommentId,
              source_comment_id: sourceCommentId,
              source_comment_text: sourceText,
              selected_text: text,
              selection_start: Number.isFinite(Number(fragment?.start_char_index)) ? Number(fragment.start_char_index) : null,
              selection_end: Number.isFinite(Number(fragment?.end_char_index)) ? Number(fragment.end_char_index) : null,
              semantic_confidence: Number.isFinite(Number(fragment?.semantic_confidence)) ? Number(fragment.semantic_confidence) : null,
              source_type: 'autofragmentar_ia',
              source_run_id: comment.source_run_id || null,
              author_name: comment.author_name || null,
              video_id: comment.video_id || null,
              code_slugs: String(fragment?.assigned_code_slug || '').trim() ? [String(fragment.assigned_code_slug).trim()] : [],
              assignment_confidence: Number.isFinite(Number(fragment?.assignment_confidence)) ? Number(fragment.assignment_confidence) : null,
              assignment_rationale: String(fragment?.assignment_rationale || '').trim() || null,
              execution_origin: 'autofragmentar_ia',
              created_at: timestamp,
            });
          }
        }
        return mapped;
      };

      const persistIncremental = (nextFragments) => {
        if (!nextFragments.length) return;
        const batchSlice = nextFragments.slice(persistedCount);
        if (!batchSlice.length) return;
        persistedCount = nextFragments.length;
        persistedFragments = [...batchSlice, ...persistedFragments];
        persist({
          ...store,
          fragments: [...persistedFragments, ...fragments],
        });
      };

      const buildBatches = (items, size) => {
        const batches = [];
        for (let i = 0; i < items.length; i += size) {
          batches.push(items.slice(i, i + size));
        }
        return batches;
      };

      const tokenize = (value) => String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);

      const scoreCodeForComment = (commentText, code) => {
        const commentTokens = new Set(tokenize(commentText));
        if (!commentTokens.size) return 0;
        const codeTokens = tokenize(`${code?.name || ''} ${code?.description || ''}`);
        if (!codeTokens.length) return 0;
        let hits = 0;
        for (const token of codeTokens) {
          if (commentTokens.has(token)) hits += 1;
        }
        return hits / Math.max(1, codeTokens.length);
      };

      const buildShortlistedCodesForBatch = (batchComments) => {
        const unionSlugs = new Set();
        for (const comment of batchComments) {
          const text = String(comment?.text || '').trim();
          if (!text) continue;
          const topForComment = [...existingCodeCatalog]
            .map((code) => ({ code, score: scoreCodeForComment(text, code) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 18)
            .map((entry) => entry.code.slug)
            .filter(Boolean);
          for (const slug of topForComment) unionSlugs.add(slug);
          if (unionSlugs.size >= 90) break;
        }
        const shortlisted = existingCodeCatalog.filter((code) => unionSlugs.has(code.slug)).slice(0, 90);
        if (shortlisted.length >= 10) return shortlisted;
        return existingCodeCatalog.slice(0, 60);
      };

      const initialBatches = buildBatches(pendingComments, BATCH_SIZE).map((batch, index) => ({
        id: `batch_${index + 1}`,
        attempts: 0,
        splitDepth: 0,
        comments: batch,
      }));

      const processBatch = async (batch) => {
        setSemanticAgentProgress({
          done: Math.min(processed, pendingComments.length),
          total: pendingComments.length,
        });

        const accumulateDiagnostics = (meta) => {
          const diagnostics = meta?.diagnostics;
          if (!diagnostics || typeof diagnostics !== 'object') return;
          rejectionDiagnostics.baja_riqueza_semantica += Number(diagnostics.baja_riqueza_semantica || 0);
          rejectionDiagnostics.sin_codigo_razonable += Number(diagnostics.sin_codigo_razonable || 0);
          rejectionDiagnostics.comentario_redundante += Number(diagnostics.comentario_redundante || 0);
          rejectionDiagnostics.texto_demasiado_vago += Number(diagnostics.texto_demasiado_vago || 0);
        };

        const shortlistedCodes = buildShortlistedCodesForBatch(batch.comments);
        const payloadComments = batch.comments
          .map((comment) => ({
            comment_id: String(comment.source_comment_id || comment.id || '').trim(),
            source_id: String(comment.source || 'youtube'),
            texto_completo_del_comentario: String(comment.text || '').trim(),
          }))
          .filter((item) => item.comment_id && item.source_id && item.texto_completo_del_comentario);

        if (!payloadComments.length) {
          return { done: batch.comments.length, failed: batch.comments.length, fragments: [] };
        }

        const response = await commentsIngestionApi.extractSemanticFragments({
          comments: payloadComments,
          existing_codes: shortlistedCodes,
        });
        accumulateDiagnostics(response?.meta);
        let responseItems = Array.isArray(response?.items) ? response.items : [];
        let hasAnyFragments = responseItems.some((item) => Array.isArray(item?.fragments) && item.fragments.length > 0);

        if (!hasAnyFragments && shortlistedCodes.length < existingCodeCatalog.length) {
          const fullCatalogResponse = await commentsIngestionApi.extractSemanticFragments({
            comments: payloadComments,
            existing_codes: existingCodeCatalog,
          });
          accumulateDiagnostics(fullCatalogResponse?.meta);
          const fullItems = Array.isArray(fullCatalogResponse?.items) ? fullCatalogResponse.items : [];
          const fullHasAny = fullItems.some((item) => Array.isArray(item?.fragments) && item.fragments.length > 0);
          if (fullHasAny) {
            responseItems = fullItems;
            hasAnyFragments = true;
          }
        }

        return {
          done: batch.comments.length,
          failed: hasAnyFragments ? Math.max(0, batch.comments.length - responseItems.length) : 0,
          fragments: mapFragmentsFromResponse({ responseItems }),
        };
      };

      const MAX_SPLIT_DEPTH = 3;
      const queue = [...initialBatches];
      const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
          const nextBatch = queue.shift();
          if (!nextBatch) continue;
          try {
            const result = await processBatch(nextBatch);
            failed += Number(result.failed || 0);
            if (Array.isArray(result.fragments) && result.fragments.length) {
              createdFragments.push(...result.fragments);
              persistIncremental(createdFragments);
            }
            processed += Number(result.done || nextBatch.comments.length);
            setSemanticAgentProgress({
              done: Math.min(processed, pendingComments.length),
              total: pendingComments.length,
            });
          } catch {
            if (nextBatch.attempts + 1 < MAX_BATCH_RETRIES) {
              queue.push({ ...nextBatch, attempts: nextBatch.attempts + 1 });
              continue;
            }

            const canSplit = Array.isArray(nextBatch.comments)
              && nextBatch.comments.length > 1
              && Number(nextBatch.splitDepth || 0) < MAX_SPLIT_DEPTH;

            if (canSplit) {
              const mid = Math.ceil(nextBatch.comments.length / 2);
              const left = nextBatch.comments.slice(0, mid);
              const right = nextBatch.comments.slice(mid);
              if (left.length) {
                queue.push({
                  id: `${nextBatch.id}_a`,
                  attempts: 0,
                  splitDepth: Number(nextBatch.splitDepth || 0) + 1,
                  comments: left,
                });
              }
              if (right.length) {
                queue.push({
                  id: `${nextBatch.id}_b`,
                  attempts: 0,
                  splitDepth: Number(nextBatch.splitDepth || 0) + 1,
                  comments: right,
                });
              }
              continue;
            }

            failed += nextBatch.comments.length;
            processed += nextBatch.comments.length;
            setSemanticAgentProgress({
              done: Math.min(processed, pendingComments.length),
              total: pendingComments.length,
            });
          }
        }
      });

      await Promise.all(workers);

      if (!createdFragments.length) {
        setSemanticAgentError(
          `La IA no encontró fragmentos con riqueza semántica suficiente y ajuste razonable. `
          + `Descartes: baja_riqueza_semantica=${rejectionDiagnostics.baja_riqueza_semantica}, `
          + `sin_codigo_razonable=${rejectionDiagnostics.sin_codigo_razonable}, `
          + `comentario_redundante=${rejectionDiagnostics.comentario_redundante}, `
          + `texto_demasiado_vago=${rejectionDiagnostics.texto_demasiado_vago}.`,
        );
        return;
      }

      const enrichedBatch = await enrichFragmentsForIaSelection(createdFragments);
      persist({
        ...store,
        fragments: [...(enrichedBatch.length ? enrichedBatch : createdFragments), ...fragments],
      });
      if (failed > 0) {
        setSemanticAgentError(`Fragmentación completada con incidencias: ${failed} comentario(s) no pudieron procesarse.`);
      }
      setTab('fragments');
    } catch (error) {
      setSemanticAgentError(error?.message || 'No se pudo ejecutar la auto-fragmentación con IA.');
    } finally {
      setSemanticAgentBusy(false);
    }
  };

  const loadInputs = async () => {
    try {
      const data = await commentsIngestionApi.listInputs({ projectId, campaignId, workspaceId: workspaceContext.workspaceId });
      setIngestionInputs(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setIngestionError(error.message || 'No se pudieron cargar inputs guardados.');
    }
  };

  const saveIngestionInput = async () => {
    setIngestionError('');
    const inferredVideoId = parseYouTubeVideoId(ingestionDraft.videoUrl) || parseYouTubeVideoId(ingestionDraft.videoId);
    const sourceVideoId = inferredVideoId || ingestionDraft.videoId.trim();
    const sourceChannelId = ingestionDraft.channelId.trim();
    const videoSearchQuery = ingestionDraft.videoSearchQuery.trim();
    const commentsPerVideo = Number(ingestionDraft.commentsPerVideo);
    const videosLimit = ingestionDraft.videosLimit === '' ? null : Number(ingestionDraft.videosLimit);

    if (!Number.isFinite(commentsPerVideo) || commentsPerVideo <= 0) {
      setIngestionError('Comentarios por video es obligatorio y debe ser mayor que 0.');
      return;
    }
    if (videosLimit != null && (!Number.isFinite(videosLimit) || videosLimit <= 0)) {
      setIngestionError('Cantidad de videos debe ser mayor que 0 cuando se informa.');
      return;
    }

    try {
      const saved = await commentsIngestionApi.saveInput({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        name: ingestionDraft.videoUrl?.trim() || ingestionDraft.videoId?.trim() || ingestionDraft.channelId?.trim() || ingestionDraft.videoSearchQuery?.trim() || `input_${ingestionInputs.length + 1}`,
        video_url: ingestionDraft.videoUrl,
        video_id: sourceVideoId,
        channel_id: sourceChannelId,
        keyword: ingestionDraft.keyword,
        video_search_query: videoSearchQuery,
        videos_limit: videosLimit,
        comments_per_video: commentsPerVideo,
        max_comments: commentsPerVideo,
        include_replies: ingestionDraft.includeReplies,
        order: ingestionDraft.order,
      });
      setIngestionInputs((prev) => [saved, ...prev.filter((row) => row.id !== saved.id)]);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo guardar input.');
    }
  };

  const loadCommentsTable = async ({ offset = commentsTable.offset, q = commentsTable.q } = {}) => {
    try {
      setCommentsTable((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await commentsIngestionApi.listTable({
        projectId,
        campaignId,
        workspaceId: workspaceContext.workspaceId,
        limit: commentsTable.limit,
        offset,
        q,
      });
      setCommentsTable((prev) => ({
        ...prev,
        loading: false,
        items: Array.isArray(data.items) ? data.items : [],
        total: Number(data.total || 0),
        offset,
        q,
      }));
    } catch (error) {
      setCommentsTable((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar la tabla de comentarios.' }));
    }
  };

  const loadRuns = async () => {
    try {
      const data = await commentsIngestionApi.listRuns({ projectId, campaignId, workspaceId: workspaceContext.workspaceId });
      setIngestionRuns(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo cargar historial de runs.');
    }
  };

  const loadProposalReviews = async () => {
    if (COMMENT_CODE_EVOLUTION_DISABLED) {
      setProposalFeedbackSummary({});
      return;
    }
    try {
      const data = await commentsIngestionApi.listCodeProposalReviews({ projectId, campaignId, workspaceId: workspaceContext.workspaceId, limit: 2000 });
      setProposalFeedbackSummary(data?.summaryByCode && typeof data.summaryByCode === 'object' ? data.summaryByCode : {});
    } catch {
      setProposalFeedbackSummary({});
    }
  };

  const deleteRun = async (runId) => {
    if (!runId) return;
    if (!window.confirm('¿Eliminar este run? También se eliminarán su input asociado y sus comentarios de la base total.')) return;
    try {
      await commentsIngestionApi.deleteRun({ runId, projectId, campaignId, workspaceId: workspaceContext.workspaceId });
      await Promise.all([loadRuns(), loadInputs(), loadCommentsTable({ offset: 0, q: commentsTable.q })]);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo eliminar el run.');
    }
  };

  useEffect(() => {
    if (!workspaceContext.workspaceId) return;
    if (tab !== 'comments' && tab !== 'reader') return;
    loadCommentsTable({ offset: commentsTable.offset, q: commentsTable.q });
    if (commentsSubtab === 'table') loadCommentsTable({ offset: 0, q: commentsTable.q });
    if (commentsSubtab === 'ingestion') {
      loadRuns();
      loadInputs();
    }
  }, [tab, commentsSubtab, workspaceContext.workspaceId]);

  useEffect(() => {
    if (!workspaceContext.workspaceId) return;
    if (tab !== 'codes') return;
    loadProposalReviews();
  }, [tab, projectId, campaignId, workspaceContext.workspaceId]);

  useEffect(() => {
    if (!selectedReaderCommentId && readerComments.length) {
      setSelectedReaderCommentId(String(readerComments[0].id));
      return;
    }
    if (selectedReaderCommentId && !readerComments.some((item) => String(item.id) === String(selectedReaderCommentId))) {
      setSelectedReaderCommentId(readerComments[0] ? String(readerComments[0].id) : '');
    }
  }, [readerComments, selectedReaderCommentId]);

  const captureReaderSelection = () => {
    const selection = window.getSelection?.();
    const text = String(selection?.toString() || '');
    const container = readerTextContainerRef.current;
    if (!selection || !container || !selection.rangeCount || !text.trim() || !selectedReaderComment) {
      setReaderSelection({ text: '', start: null, end: null, commentId: '' });
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setReaderSelection({ text: '', start: null, end: null, commentId: '' });
      return;
    }

    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(container);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    const selectedText = range.toString();
    const end = start + selectedText.length;
    setReaderSelection({
      text: selectedText,
      start,
      end,
      commentId: String(selectedReaderComment.id || ''),
    });
  };

  const runYouTubeIngestion = async () => {
    setIngestionError('');
    const inferredVideoId = parseYouTubeVideoId(ingestionDraft.videoUrl) || parseYouTubeVideoId(ingestionDraft.videoId);
    const sourceVideoId = inferredVideoId || ingestionDraft.videoId.trim();
    const sourceChannelId = ingestionDraft.channelId.trim();
    const videoSearchQuery = ingestionDraft.videoSearchQuery.trim();

    const commentsPerVideo = Number(ingestionDraft.commentsPerVideo);
    if (!Number.isFinite(commentsPerVideo) || commentsPerVideo <= 0) {
      setIngestionError('Comentarios por video es obligatorio y debe ser mayor que 0.');
      return;
    }

    const videosLimit = ingestionDraft.videosLimit === '' ? null : Number(ingestionDraft.videosLimit);
    if (videosLimit != null && (!Number.isFinite(videosLimit) || videosLimit <= 0)) {
      setIngestionError('Cantidad de videos debe ser mayor que 0 cuando se informa.');
      return;
    }

    const maxComments = Math.min(1000, Math.max(1, Number(commentsPerVideo) || 100));
    const includeReplies = Boolean(ingestionDraft.includeReplies);
    const keyword = ingestionDraft.keyword.trim().toLowerCase();
    setIngestionBusy(true);

    try {
      await commentsIngestionApi.runIngestion({
        project_id: projectId,
        campaign_id: campaignId,
        workspace_id: workspaceContext.workspaceId,
        video_url: ingestionDraft.videoUrl,
        video_id: sourceVideoId,
        channel_id: sourceChannelId,
        video_search_query: videoSearchQuery,
        videos_limit: videosLimit,
        comments_per_video: commentsPerVideo,
        keyword,
        max_comments: maxComments,
        include_replies: includeReplies,
        order: ingestionDraft.order || 'time',
      });
      await loadRuns();
      await loadInputs();
      await loadCommentsTable({ offset: 0, q: commentsTable.q });
      setCommentsSubtab('table');
    } catch (error) {
      setIngestionError(error.message || 'No se pudo completar la ingesta.');
    } finally {
      setIngestionBusy(false);
    }
  };

  const tabs = [
    { id: 'comments', label: 'Base de comentarios', icon: MessageSquareText },
    { id: 'reader', label: 'Lector', icon: BookOpenText },
    { id: 'fragments', label: 'Fragmentos', icon: Scissors },
    { id: 'codes', label: 'Códigos', icon: Tags },
    { id: 'hypotheses', label: 'Hipótesis', icon: Lightbulb },
    { id: 'clusters', label: 'Clusters', icon: Network },
  ];


  const availableHypothesisProfiles = useMemo(() => {
    const aggregated = new Map();
    Object.values(codeMapVisualProfilesByScope || {}).forEach((scopeData) => {
      const profiles = Array.isArray(scopeData?.profiles) ? scopeData.profiles : [];
      const assignments = scopeData?.assignments && typeof scopeData.assignments === 'object' ? scopeData.assignments : {};
      const assignmentCountByProfile = Object.values(assignments).reduce((acc, profileId) => {
        const normalizedProfileId = String(profileId || '').trim();
        if (!normalizedProfileId) return acc;
        acc.set(normalizedProfileId, (acc.get(normalizedProfileId) || 0) + 1);
        return acc;
      }, new Map());

      profiles.forEach((profile) => {
        const id = String(profile?.id || '').trim();
        if (!id) return;
        const previous = aggregated.get(id);
        const nextAssignmentCount = Number(assignmentCountByProfile.get(id) || 0);
        if (!previous) {
          aggregated.set(id, {
            id,
            name: String(profile?.name || 'Perfil estratégico').trim() || 'Perfil estratégico',
            description: String(profile?.description || '').trim(),
            assignmentCount: nextAssignmentCount,
          });
          return;
        }
        aggregated.set(id, {
          ...previous,
          name: previous.name || String(profile?.name || 'Perfil estratégico').trim() || 'Perfil estratégico',
          description: previous.description || String(profile?.description || '').trim(),
          assignmentCount: Number(previous.assignmentCount || 0) + nextAssignmentCount,
        });
      });
    });

    return Array.from(aggregated.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [codeMapVisualProfilesByScope]);

  const profileById = useMemo(
    () => new Map(availableHypothesisProfiles.map((profile) => [String(profile.id), profile])),
    [availableHypothesisProfiles],
  );

  const filteredHypotheses = useMemo(() => {
    const q = String(hypothesisQuery || '').trim().toLowerCase();
    if (!q) return hypotheses;
    return hypotheses.filter((item) => {
      const title = String(item.title || '').toLowerCase();
      const description = String(item.description || '').toLowerCase();
      const contextNote = String(item.context_note || '').toLowerCase();
      const typeLabel = commentHypothesisTypeLabel(item.type).toLowerCase();
      const linkedProfilesText = (Array.isArray(item.linked_profile_ids) ? item.linked_profile_ids : [])
        .map((profileId) => profileById.get(String(profileId))?.name || '')
        .join(' ')
        .toLowerCase();
      return title.includes(q) || description.includes(q) || contextNote.includes(q) || linkedProfilesText.includes(q) || typeLabel.includes(q);
    });
  }, [hypotheses, hypothesisQuery, profileById]);

  const allowedParentHypothesesForEditor = useMemo(() => {
    const childType = normalizeCommentHypothesisType(hypothesisEditor.type);
    const requiredParentType = COMMENT_HYPOTHESIS_PARENT_TYPE_BY_CHILD[childType] || '';
    if (!requiredParentType) return [];
    return hypotheses.filter((hypothesis) => String(hypothesis.id) !== String(hypothesisEditor.id || '') && normalizeCommentHypothesisType(hypothesis.type) === requiredParentType);
  }, [hypotheses, hypothesisEditor.id, hypothesisEditor.type]);

  const evolutionLinksBySourceId = useMemo(() => hypothesisEvolutionLinks.reduce((acc, link) => {
    if (link?.deleted_at) return acc;
    const sourceId = String(link?.source_hypothesis_id || '').trim();
    if (!sourceId) return acc;
    const current = acc.get(sourceId) || [];
    current.push(link);
    acc.set(sourceId, current);
    return acc;
  }, new Map()), [hypothesisEvolutionLinks]);

  const activeEvolutionSourceHypothesis = useMemo(
    () => hypotheses.find((item) => String(item.id) === String(hypothesisEvolutionModal.sourceHypothesisId || '')) || null,
    [hypotheses, hypothesisEvolutionModal.sourceHypothesisId],
  );

  const activeEvolutionDeletionSourceHypothesis = useMemo(
    () => hypotheses.find((item) => String(item.id) === String(hypothesisEvolutionDeleteModal.sourceHypothesisId || '')) || null,
    [hypotheses, hypothesisEvolutionDeleteModal.sourceHypothesisId],
  );

  const buildEvolutionBranchHypotheses = useCallback((sourceHypothesis = null, scope = 'single') => {
    if (!sourceHypothesis) return [];
    if (scope !== 'branch') return [sourceHypothesis];

    const lineage = [];
    const seen = new Set();
    let current = sourceHypothesis;
    while (current) {
      lineage.unshift(current);
      seen.add(String(current.id || ''));
      const parentId = String(current.parent_hypothesis_id || '').trim();
      current = parentId ? hypothesisById.get(parentId) || null : null;
    }

    const queue = [sourceHypothesis];
    while (queue.length) {
      const item = queue.shift();
      const itemId = String(item?.id || '').trim();
      if (!itemId) continue;
      if (!seen.has(itemId)) {
        lineage.push(item);
        seen.add(itemId);
      }
      const children = childHypothesesByParentId.get(itemId) || [];
      children.forEach((child) => queue.push(child));
    }

    return lineage;
  }, [childHypothesesByParentId, hypothesisById]);

  const evolutionBranchHypotheses = useMemo(
    () => buildEvolutionBranchHypotheses(activeEvolutionSourceHypothesis, hypothesisEvolutionModal.scope),
    [activeEvolutionSourceHypothesis, hypothesisEvolutionModal.scope, buildEvolutionBranchHypotheses],
  );

  const hydrateEvolutionBranchDrafts = (branchHypotheses = []) => {
    const interviewDrafts = {};
    const videoDrafts = {};
    branchHypotheses.forEach((hypothesis) => {
      const id = String(hypothesis?.id || '').trim();
      if (!id) return;
      interviewDrafts[id] = createEvolutionInterviewDraftForHypothesis(hypothesis);
      videoDrafts[id] = createEvolutionVideoDraftForHypothesis(hypothesis);
    });
    setHypothesisEvolutionInterviewBranchDrafts(interviewDrafts);
    setHypothesisEvolutionVideoBranchDrafts(videoDrafts);
  };

  const describeEvolutionBranchPosition = (hypothesis = null) => {
    if (!hypothesis || !activeEvolutionSourceHypothesis) return 'Hipótesis de la rama';
    const targetId = String(hypothesis.id || '').trim();
    const sourceId = String(activeEvolutionSourceHypothesis.id || '').trim();
    if (targetId === sourceId) return 'Hipótesis seleccionada';

    let current = activeEvolutionSourceHypothesis;
    while (current) {
      const parentId = String(current.parent_hypothesis_id || '').trim();
      if (!parentId) break;
      if (parentId === targetId) return 'Ancestro necesario de la rama';
      current = hypothesisById.get(parentId) || null;
    }
    return 'Descendiente de la rama';
  };

  const collectDescendantHypothesisIds = (rootId = '') => {
    const pending = [String(rootId || '').trim()].filter(Boolean);
    const descendants = new Set();

    while (pending.length) {
      const currentId = pending.pop();
      const children = childHypothesesByParentId.get(String(currentId)) || [];
      children.forEach((child) => {
        const childId = String(child?.id || '').trim();
        if (!childId || descendants.has(childId)) return;
        descendants.add(childId);
        pending.push(childId);
      });
    }

    return descendants;
  };

  const findInvalidAncestorForHypothesis = (hypothesisId = '', excludedAncestorIds = new Set()) => {
    let current = hypothesisById.get(String(hypothesisId || '').trim());
    while (current) {
      const parentId = String(current.parent_hypothesis_id || '').trim();
      if (!parentId) return null;
      if (!excludedAncestorIds.has(parentId)) {
        const parent = hypothesisById.get(parentId);
        if (normalizeCommentHypothesisValidationStatus(parent?.validation_status) === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID) {
          return parent;
        }
        current = parent;
      } else {
        current = hypothesisById.get(parentId);
      }
    }
    return null;
  };

  const updateHypothesisValidationStatus = async (hypothesisId, nextStatus) => {
    const normalizedId = String(hypothesisId || '').trim();
    if (!normalizedId) return;

    const normalizedStatus = normalizeCommentHypothesisValidationStatus(nextStatus);
    const targetHypothesis = hypothesisById.get(normalizedId);
    if (!targetHypothesis) return;

    if (normalizedStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID) {
      const invalidAncestor = findInvalidAncestorForHypothesis(normalizedId);
      if (invalidAncestor) {
        window.alert(`No puedes validar esta hipótesis mientras su hipótesis padre "${invalidAncestor.title || 'Sin título'}" siga invalidada.`);
        return;
      }
    }

    if (normalizedStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID) {
      const confirmed = window.confirm(
        '¿Invalidar esta hipótesis? La sincronización nueva invalidará el nodo, sus equivalentes directos y toda la rama descendente cross-mode.',
      );
      if (!confirmed) return;
    }
    await syncCrossModeHypothesisStateTransition({
      projectId,
      campaignId,
      mode: 'comments',
      hypothesisId: normalizedId,
      previousState: targetHypothesis.validation_status || '',
      nextState: normalizedStatus,
      origin: 'comments_manual_update',
    });

    const nextStore = await loadCommentsModeStore(storageKey);
    if (nextStore && typeof nextStore === 'object') {
      setStore(nextStore);
    } else {
      setStore(loadCommentsStoreFromLocalStorage(storageKey));
    }
    setHypothesisMenuId('');
  };

  const activeSourceEvolutionOptions = useMemo(
    () => (evolutionLinksBySourceId.get(String(hypothesisEvolutionDeleteModal.sourceHypothesisId || '')) || []).filter((link) => !link?.deleted_at),
    [evolutionLinksBySourceId, hypothesisEvolutionDeleteModal.sourceHypothesisId],
  );

  const selectedEvolutionToDelete = useMemo(
    () => activeSourceEvolutionOptions.find((link) => String(link.id) === String(hypothesisEvolutionDeleteModal.selectedEvolutionId || '')) || null,
    [activeSourceEvolutionOptions, hypothesisEvolutionDeleteModal.selectedEvolutionId],
  );

  const stripVideoHierarchyMetadata = (value = '') => String(value || '').replace(/\s*\[hierarchy_meta\][\s\S]*?\[\/hierarchy_meta\]\s*/g, '').trim();
  const extractVideoHierarchyMetadata = (value = '') => {
    const match = String(value || '').match(/\[hierarchy_meta\]([\s\S]*?)\[\/hierarchy_meta\]/);
    if (!match) return {};
    try {
      return JSON.parse(match[1]);
    } catch {
      return {};
    }
  };
  const getVideoParentHypothesisId = (hypothesis = {}) => String(extractVideoHierarchyMetadata(hypothesis?.contexto_cualitativo || '').parent_hypothesis_id || '').trim();
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
  const getInterviewParentHypothesisId = (hypothesis = {}) => String(extractInterviewHierarchyMetadata(hypothesis?.observations || '').parent_hypothesis_id || '').trim();

  const collectEvolutionBranchIds = (items = [], rootId = '', getParentId = () => '') => {
    const normalizedRootId = String(rootId || '').trim();
    if (!normalizedRootId) return [];
    const pending = [normalizedRootId];
    const collected = new Set();
    while (pending.length) {
      const currentId = pending.shift();
      if (!currentId || collected.has(currentId)) continue;
      collected.add(currentId);
      items.forEach((item) => {
        if (String(getParentId(item) || '').trim() === currentId) pending.push(String(item.id || '').trim());
      });
    }
    return [...collected];
  };

  const openHypothesisEvolutionDeleteModal = (hypothesis) => {
    const sourceHypothesisId = String(hypothesis?.id || '').trim();
    const sourceEvolutions = (evolutionLinksBySourceId.get(sourceHypothesisId) || []).filter((link) => !link?.deleted_at);
    if (!sourceEvolutions.length) return;
    setHypothesisMenuId('');
    setHypothesisEvolutionDeleteModal({
      open: true,
      deleting: false,
      error: '',
      sourceHypothesisId,
      selectedEvolutionId: String(sourceEvolutions[0]?.id || ''),
      deleteMode: 'branch',
    });
  };

  const closeHypothesisEvolutionDeleteModal = () => {
    setHypothesisEvolutionDeleteModal({ open: false, deleting: false, error: '', sourceHypothesisId: '', selectedEvolutionId: '', deleteMode: 'branch' });
  };

  const saveHypothesisEvolutionDeletion = async () => {
    const evolution = selectedEvolutionToDelete;
    const deleteMode = String(hypothesisEvolutionDeleteModal.deleteMode || 'branch');
    if (!evolution) {
      setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, error: 'Selecciona una evolución para eliminar.' }));
      return;
    }
    setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, deleting: true, error: '' }));
    try {
      const destinationMode = String(evolution.destination_mode || '').trim();
      const rootDestinationId = String(evolution.destination_hypothesis_id || '').trim();
      let destinationHypotheses = [];
      let destinationIdsToDelete = [rootDestinationId];

      if (destinationMode === 'interviews') {
        destinationHypotheses = await interviewsModuleApi.listHypotheses(projectId, campaignId);
        const branchIds = collectEvolutionBranchIds(destinationHypotheses, rootDestinationId, getInterviewParentHypothesisId);
        destinationIdsToDelete = deleteMode === 'branch' ? branchIds : [rootDestinationId];
        const idsToDetach = branchIds.filter((id) => !destinationIdsToDelete.includes(id));
        for (const childId of idsToDetach) {
          const child = destinationHypotheses.find((item) => String(item.id) === childId);
          if (!child) continue;
          await interviewsModuleApi.updateHypothesis(childId, { observations: stripInterviewHierarchyMetadata(child.observations || '') || null });
        }
        for (const hypothesisId of [...destinationIdsToDelete].reverse()) {
          await interviewsModuleApi.deleteHypothesis(hypothesisId);
        }
      } else if (destinationMode === 'video') {
        destinationHypotheses = await fetchVideoHypotheses(campaignId);
        const branchIds = collectEvolutionBranchIds(destinationHypotheses, rootDestinationId, getVideoParentHypothesisId);
        destinationIdsToDelete = deleteMode === 'branch' ? branchIds : [rootDestinationId];
        const idsToDetach = branchIds.filter((id) => !destinationIdsToDelete.includes(id));
        for (const childId of idsToDetach) {
          const child = destinationHypotheses.find((item) => String(item.id) === childId);
          if (!child) continue;
          await updateVideoHypothesis(childId, { contexto_cualitativo: stripVideoHierarchyMetadata(child.contexto_cualitativo || '') || null });
        }
        for (const hypothesisId of [...destinationIdsToDelete].reverse()) {
          const deleted = await deleteVideoHypothesis(hypothesisId, campaignId);
          if (!deleted) throw new Error('No se pudo eliminar una hipótesis evolucionada en Modo Video.');
        }
      } else {
        throw new Error('La evolución seleccionada no tiene un modo destino válido.');
      }

      await markHypothesisEvolutionLinksDeleted({
        projectId,
        campaignId,
        destinationMode,
        destinationHypothesisIds: destinationIdsToDelete,
        deletionContext: {
          source_mode: 'comments',
          source_hypothesis_id: evolution.source_hypothesis_id,
          destination_mode: destinationMode,
          deleted_from_comments_menu: true,
          delete_mode: deleteMode,
        },
      });

      const nextEvolutionLinks = hypothesisEvolutionLinks.map((link) => (destinationIdsToDelete.includes(String(link?.destination_hypothesis_id || ''))
        ? {
          ...link,
          deleted_at: new Date().toISOString(),
          deletion_context: {
            ...link?.deletion_context,
            source_mode: 'comments',
            source_hypothesis_id: evolution.source_hypothesis_id,
            destination_mode: destinationMode,
            deleted_from_comments_menu: true,
            delete_mode: deleteMode,
          },
        }
        : link));
      persist({ ...store, hypothesisEvolutionLinks: nextEvolutionLinks });
      closeHypothesisEvolutionDeleteModal();
    } catch (error) {
      setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, deleting: false, error: error?.message || 'No se pudo eliminar la evolución seleccionada.' }));
      return;
    }
    setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, deleting: false }));
  };

  const hydrateEvolutionDrafts = (hypothesis = null) => {
    setHypothesisEvolutionInterviewDraft(createEvolutionInterviewDraftForHypothesis(hypothesis));
    setHypothesisEvolutionVideoDraft(createEvolutionVideoDraftForHypothesis(hypothesis));
  };

  const buildVideoEvolutionContext = (context = '', parentHypothesisId = '') => {
    const clean = stripVideoHierarchyMetadata(context);
    const normalizedParentId = String(parentHypothesisId || '').trim();
    if (!normalizedParentId) return clean;
    return [clean, `[hierarchy_meta]${JSON.stringify({ parent_hypothesis_id: normalizedParentId })}[/hierarchy_meta]`].filter(Boolean).join('\n\n');
  };

  const buildInterviewEvolutionObservations = (observations = '', parentHypothesisId = '') => {
    const clean = stripInterviewHierarchyMetadata(observations);
    const normalizedParentId = String(parentHypothesisId || '').trim();
    if (!normalizedParentId) return clean;
    return [clean, `[interview_hierarchy]${JSON.stringify({ parent_hypothesis_id: normalizedParentId })}[/interview_hierarchy]`].filter(Boolean).join('\n\n');
  };

  const openHypothesisEvolutionModal = async (hypothesis) => {
    if (!hypothesis) return;
    setHypothesisMenuId('');
    hydrateEvolutionDrafts(hypothesis);
    hydrateEvolutionBranchDrafts(buildEvolutionBranchHypotheses(hypothesis, 'branch'));
    setHypothesisEvolutionModal({
      open: true,
      saving: false,
      error: '',
      destinationMode: '',
      sourceHypothesisId: String(hypothesis.id || ''),
      scope: 'single',
    });
    setHypothesisEvolutionSupport((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const [audiences, clients, forms] = await Promise.all([
        interviewsModuleApi.listAudiences(campaignId),
        interviewsModuleApi.listClients(projectId, campaignId),
        interviewsModuleApi.listForms(projectId, campaignId),
      ]);
      setHypothesisEvolutionSupport({ loading: false, error: '', audiences, clients, forms });
    } catch (error) {
      setHypothesisEvolutionSupport({ loading: false, error: error?.message || 'No se pudo preparar la evolución hacia entrevistas.', audiences: [], clients: [], forms: [] });
    }
  };

  const closeHypothesisEvolutionModal = () => {
    setHypothesisEvolutionModal({ open: false, saving: false, error: '', destinationMode: '', sourceHypothesisId: '', scope: 'single' });
    setHypothesisEvolutionInterviewBranchDrafts({});
    setHypothesisEvolutionVideoBranchDrafts({});
  };

  const updateInterviewBranchDraft = (hypothesisId, patch) => {
    setHypothesisEvolutionInterviewBranchDrafts((prev) => ({
      ...prev,
      [hypothesisId]: {
        ...(prev[hypothesisId] || createEvolutionInterviewDraftForHypothesis(hypothesisById.get(String(hypothesisId || '')) || null)),
        ...patch,
      },
    }));
  };

  const updateVideoBranchDraft = (hypothesisId, patch) => {
    setHypothesisEvolutionVideoBranchDrafts((prev) => ({
      ...prev,
      [hypothesisId]: {
        ...(prev[hypothesisId] || createEvolutionVideoDraftForHypothesis(hypothesisById.get(String(hypothesisId || '')) || null)),
        ...patch,
      },
    }));
  };

  const buildEvolutionLinkRecord = ({ sourceHypothesis, destinationMode, destinationHypothesis, destinationRoute, adapterSnapshot }) => ({
    id: `hyp_evolution_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    source_mode: 'comments',
    source_hypothesis_id: String(sourceHypothesis?.id || ''),
    source_hypothesis_title: String(sourceHypothesis?.title || ''),
    source_workspace_id: workspaceContext.workspaceId || LEGACY_WORKSPACE_ID,
    destination_mode: destinationMode,
    destination_hypothesis_id: String(destinationHypothesis?.id || ''),
    destination_hypothesis_title: String(destinationHypothesis?.title || destinationHypothesis?.hypothesis_statement || destinationHypothesis?.condition || ''),
    destination_route: destinationRoute,
    evolution_type: `comments_to_${destinationMode}`,
    evolved_at: new Date().toISOString(),
    adapter_snapshot: adapterSnapshot,
  });

  const persistHypothesisEvolutionLinks = (records = []) => {
    if (!records.length) return;
    persist({
      ...store,
      hypothesisEvolutionLinks: [...records, ...hypothesisEvolutionLinks],
    });
  };

  const saveHypothesisEvolution = async () => {
    const sourceHypothesis = activeEvolutionSourceHypothesis;
    const destinationMode = String(hypothesisEvolutionModal.destinationMode || '').trim();
    const evolutionScope = String(hypothesisEvolutionModal.scope || 'single').trim() || 'single';
    if (!sourceHypothesis || !destinationMode) {
      setHypothesisEvolutionModal((prev) => ({ ...prev, error: 'Selecciona una hipótesis origen y un modo destino.' }));
      return;
    }

    setHypothesisEvolutionModal((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const sourceBranch = buildEvolutionBranchHypotheses(sourceHypothesis, evolutionScope);
      if (!sourceBranch.length) throw new Error('No se encontró la rama de hipótesis a evolucionar.');

      if (destinationMode === 'interviews') {
        const draft = hypothesisEvolutionInterviewDraft;
        if (evolutionScope === 'single' && !String(draft.title || '').trim()) throw new Error('La evolución a Entrevistas requiere un título.');
        const createdBySourceId = new Map();
        const createdRecords = [];
        for (const branchHypothesis of sourceBranch) {
          const sourceId = String(branchHypothesis.id || '').trim();
          const parentDestinationId = createdBySourceId.get(String(branchHypothesis.parent_hypothesis_id || '').trim()) || '';
          const branchDraft = evolutionScope === 'branch'
            ? (hypothesisEvolutionInterviewBranchDrafts[sourceId] || createEvolutionInterviewDraftForHypothesis(branchHypothesis))
            : draft;
          if (!String(branchDraft.title || '').trim()) {
            throw new Error(`Cada hipótesis de la rama hacia Entrevistas requiere su propio título. Falta completar: ${branchHypothesis.title || sourceId}.`);
          }
          const created = await interviewsModuleApi.createHypothesis(projectId, campaignId, {
            title: String(branchDraft.title || '').trim(),
            description: String(branchDraft.description || '').trim() || null,
            type: normalizeCommentHypothesisType(branchHypothesis.type) || String(branchDraft.type || 'problema').trim() || 'problema',
            status: String(branchDraft.status || 'exploracion').trim() || 'exploracion',
            audience_id: String(branchDraft.audience_id || '').trim() || null,
            segment: String(branchDraft.segment || '').trim() || null,
            related_client_id: String(branchDraft.related_client_id || '').trim() || null,
            interview_form_id: String(branchDraft.interview_form_id || '').trim() || null,
            min_interviews: Number(branchDraft.min_interviews || 0) || null,
            experiment_notes: [
              String(branchDraft.experiment_notes || '').trim(),
              buildCommentHypothesisTraceBlock({ sourceHypothesis: branchHypothesis, destinationMode: 'interviews', workspaceId: workspaceContext.workspaceId }),
            ].filter(Boolean).join('\n\n'),
            observations: buildInterviewEvolutionObservations(String(branchDraft.observations || '').trim(), parentDestinationId) || null,
            next_actions: String(branchDraft.next_actions || '').trim() || null,
            validation_metric_config: branchDraft.validation_metric_config,
          });
          createdBySourceId.set(sourceId, String(created?.id || ''));
          createdRecords.push(buildEvolutionLinkRecord({
            sourceHypothesis: branchHypothesis,
            destinationMode: 'interviews',
            destinationHypothesis: created,
            destinationRoute: `/projects/${projectId}/campaigns/${campaignId}/interviews`,
            adapterSnapshot: { ...draft, scope: evolutionScope },
          }));
        }
        persistHypothesisEvolutionLinks(createdRecords);
        closeHypothesisEvolutionModal();
        window.alert(evolutionScope === 'branch' ? 'Rama de hipótesis evolucionada a Modo Entrevistas con trazabilidad registrada.' : 'Hipótesis evolucionada a Modo Entrevistas con trazabilidad registrada.');
        return;
      }

      const draft = hypothesisEvolutionVideoDraft;
      if (evolutionScope === 'single' && (!String(draft.type || '').trim() || !String(draft.hypothesis_statement || '').trim() || !String(draft.metrica_objetivo_y || '').trim() || !String(draft.volumen_unidad || '').trim())) {
        throw new Error('Completa los campos clave para evolucionar la hipótesis a Modo Video.');
      }
      const createdBySourceId = new Map();
      const createdRecords = [];
      for (const branchHypothesis of sourceBranch) {
        const sourceId = String(branchHypothesis.id || '').trim();
        const parentDestinationId = createdBySourceId.get(String(branchHypothesis.parent_hypothesis_id || '').trim()) || '';
        const branchDraft = evolutionScope === 'branch'
          ? (hypothesisEvolutionVideoBranchDrafts[sourceId] || createEvolutionVideoDraftForHypothesis(branchHypothesis))
          : draft;
        if (!String(branchDraft.type || '').trim() || !String(branchDraft.hypothesis_statement || '').trim() || !String(branchDraft.metrica_objetivo_y || '').trim() || !String(branchDraft.volumen_unidad || '').trim()) {
          throw new Error(`Cada hipótesis de la rama hacia Video debe completar statement, tipo, métrica y volumen. Falta completar: ${branchHypothesis.title || sourceId}.`);
        }
        const thresholdSuffix = branchDraft.umbral_tipo === '%' ? '%' : '';
        const created = await createVideoHypothesis({
          type: normalizeCommentHypothesisType(branchHypothesis.type) || String(branchDraft.type || '').trim() || 'problema',
          hypothesis_statement: String(branchDraft.hypothesis_statement || '').trim(),
          variable_x: resolveVideoEvolutionDisplayTitle({
            explicitTitle: String(branchDraft.variable_x || '').trim(),
            fallbackTitle: String(branchHypothesis?.title || '').trim(),
            statement: String(branchDraft.hypothesis_statement || '').trim(),
          }),
          metrica_objetivo_y: String(branchDraft.metrica_objetivo_y || '').trim(),
          umbral_operador: String(branchDraft.umbral_operador || '>=').trim() || '>=',
          umbral_valor: Number(branchDraft.umbral_valor || 0),
          volumen_minimo: Number(branchDraft.volumen_minimo || 0),
          volumen_unidad: String(branchDraft.volumen_unidad || '').trim(),
          canal_principal: String(branchDraft.canal_principal || 'organic').trim() || 'organic',
          contexto_cualitativo: [
            buildVideoEvolutionContext(String(branchDraft.contexto_cualitativo || '').trim(), parentDestinationId),
            buildCommentHypothesisTraceBlock({ sourceHypothesis: branchHypothesis, destinationMode: 'video', workspaceId: workspaceContext.workspaceId }),
          ].filter(Boolean).join('\n\n'),
          campaign_id: campaignId,
          condition: `${branchDraft.metrica_objetivo_y} ${branchDraft.umbral_operador} ${branchDraft.umbral_valor}${thresholdSuffix}`,
        });
        if (!created) throw new Error('No se pudo crear una hipótesis de la rama en Modo Video.');
        createdBySourceId.set(sourceId, String(created?.id || ''));
        createdRecords.push(buildEvolutionLinkRecord({
          sourceHypothesis: branchHypothesis,
          destinationMode: 'video',
          destinationHypothesis: created,
          destinationRoute: `/projects/${projectId}/campaigns/${campaignId}/hypotheses/${created.id}`,
          adapterSnapshot: { ...draft, scope: evolutionScope },
        }));
      }
      persistHypothesisEvolutionLinks(createdRecords);
      closeHypothesisEvolutionModal();
      window.alert(evolutionScope === 'branch' ? 'Rama de hipótesis evolucionada a Modo Video con trazabilidad registrada.' : 'Hipótesis evolucionada a Modo Video con trazabilidad registrada.');
    } catch (error) {
      setHypothesisEvolutionModal((prev) => ({ ...prev, saving: false, error: error?.message || 'No se pudo evolucionar la hipótesis.' }));
      return;
    }
    setHypothesisEvolutionModal((prev) => ({ ...prev, saving: false }));
  };

  const openHypothesisEditor = (hypothesis = null) => {
    if (!hypothesis) {
      setHypothesisEditor({
        open: true,
        mode: 'create',
        id: '',
        title: '',
        description: '',
        type: 'problema',
        parentHypothesisId: '',
        context_note: '',
        linkedProfileIds: [],
        profileQuery: '',
      });
      return;
    }
    setHypothesisEditor({
      open: true,
      mode: 'edit',
      id: String(hypothesis.id || ''),
      title: String(hypothesis.title || ''),
      description: String(hypothesis.description || ''),
      type: normalizeCommentHypothesisType(hypothesis.type) || 'problema',
      parentHypothesisId: String(hypothesis.parent_hypothesis_id || ''),
      context_note: String(hypothesis.context_note || ''),
      linkedProfileIds: Array.isArray(hypothesis.linked_profile_ids) ? hypothesis.linked_profile_ids.map((profileId) => String(profileId)) : [],
      profileQuery: '',
    });
  };

  const closeHypothesisEditor = () => {
    setHypothesisEditor((prev) => ({ ...prev, open: false }));
  };

  const saveHypothesisEditor = () => {
    const title = String(hypothesisEditor.title || '').trim();
    const description = String(hypothesisEditor.description || '').trim();
    const hypothesisType = normalizeCommentHypothesisType(hypothesisEditor.type);
    const parentHypothesisId = String(hypothesisEditor.parentHypothesisId || '').trim();
    const parentHypothesis = parentHypothesisId ? hypothesisById.get(parentHypothesisId) : null;
    const contextNote = String(hypothesisEditor.context_note || '').trim();
    const linkedProfileIds = Array.from(new Set((Array.isArray(hypothesisEditor.linkedProfileIds) ? hypothesisEditor.linkedProfileIds : [])
      .map((profileId) => String(profileId).trim())
      .filter((profileId) => profileById.has(profileId))));

    if (!title || !description || !hypothesisType) {
      window.alert('Título, descripción y tipo son obligatorios para crear/editar hipótesis.');
      return;
    }

    const requiredParentType = COMMENT_HYPOTHESIS_PARENT_TYPE_BY_CHILD[hypothesisType] || '';
    if (hypothesisType === 'problema' && parentHypothesisId) {
      window.alert('Una hipótesis de tipo problema no puede tener hipótesis padre.');
      return;
    }
    if (parentHypothesis && normalizeCommentHypothesisType(parentHypothesis.type) !== requiredParentType) {
      window.alert(`La relación es inválida: una hipótesis ${commentHypothesisTypeLabel(hypothesisType).toLowerCase()} solo puede depender de una hipótesis ${commentHypothesisTypeLabel(requiredParentType).toLowerCase()}.`);
      return;
    }

    const currentChildren = childHypothesesByParentId.get(String(hypothesisEditor.id || '')) || [];
    const allowedChildType = COMMENT_HYPOTHESIS_CHILD_TYPE_BY_PARENT[hypothesisType] || '';
    const hasInvalidChildren = currentChildren.some((child) => normalizeCommentHypothesisType(child.type) !== allowedChildType);
    if (hasInvalidChildren) {
      window.alert(`No puedes guardar esta hipótesis como ${commentHypothesisTypeLabel(hypothesisType).toLowerCase()} porque rompería la jerarquía de sus hipótesis hijas.`);
      return;
    }
    if (!allowedChildType && currentChildren.length) {
      window.alert('Una hipótesis de tipo producto no puede tener hipótesis hijas.');
      return;
    }

    if (hypothesisEditor.mode === 'create') {
      const nextHypothesis = {
        id: `comment_hypothesis_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title,
        description,
        type: hypothesisType,
        validation_status: COMMENT_HYPOTHESIS_VALIDATION_STATUS.PENDING,
        parent_hypothesis_id: parentHypothesisId || '',
        context_note: contextNote,
        linked_profile_ids: linkedProfileIds,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      persist({ ...store, hypotheses: [nextHypothesis, ...hypotheses] });
      closeHypothesisEditor();
      return;
    }

    const nextHypotheses = hypotheses.map((item) => {
      if (String(item.id) !== String(hypothesisEditor.id)) return item;
      const { linked_code_slugs, ...rest } = item || {};
      return {
        ...rest,
        title,
        description,
        type: hypothesisType,
        parent_hypothesis_id: parentHypothesisId || '',
        context_note: contextNote,
        linked_profile_ids: linkedProfileIds,
        updated_at: new Date().toISOString(),
      };
    });
    persist({ ...store, hypotheses: nextHypotheses });
    closeHypothesisEditor();
  };

  const deleteHypothesis = (hypothesisId) => {
    const id = String(hypothesisId || '');
    if (!id) return;
    if (!window.confirm('¿Eliminar esta hipótesis?')) return;
    const nextHypotheses = hypotheses.filter((item) => String(item.id) !== id);
    persist({ ...store, hypotheses: nextHypotheses });
    setHypothesisMenuId('');
  };

  const renderCodeNode = (code, depth = 0) => {
    const slug = String(code.slug || '');
    const children = codeTreeRoots.childrenByParent.get(slug) || [];
    const isCollapsed = Boolean(collapsedCodeSlugs[slug]);
    const isSelected = selectedCodeSlug === slug;
    const usageCount = Number(codeUsageCount.get(slug) || 0);
    const score = codeScoreBySlug.get(slug) || {
      score_total: 0,
      score_frecuencia: 0,
      score_dispersion: 0,
      score_consistencia: 0,
      score_intensidad: 0,
    };

    return (
      <div key={slug} className="relative isolate space-y-1">
        <article
          className={`group relative rounded-xl border bg-white p-3 shadow-sm transition ${isSelected ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200 hover:shadow-md'} ${usageCount === 0 ? 'opacity-80' : ''} ${codeMenuSlug === slug ? 'z-40' : 'z-0'}`}
          style={{ marginLeft: `${depth * 18}px` }}
          onClick={() => setSelectedCodeSlug(slug)}
        >
          <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-transparent group-hover:bg-indigo-200" />
          {isSelected ? <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-indigo-500" /> : null}

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {children.length ? (
                  <button type="button" className="rounded border bg-white p-0.5 text-slate-500 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); toggleCodeCollapsed(slug); }}>
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                ) : <span className="inline-block w-5" />}
                <h3 className={`truncate ${depth === 0 ? 'text-[15px]' : 'text-sm'} font-semibold text-slate-900`}>{code.name}</h3>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getScoreColorClass(score.score_total)}`}>{score.score_total} / 100</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${usageCount > 10 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{usageCount} fragmentos</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>Nivel {depth + 1}</span>
                <span>·</span>
                <span>{code.created_at ? new Date(code.created_at).toLocaleDateString() : 'Sin fecha'}</span>
                <span>·</span>
                <span>F {score.score_frecuencia} · D {score.score_dispersion}</span>
                {Array.isArray(code.tags) && code.tags.length ? <><span>·</span><span className="line-clamp-1">{code.tags.slice(0, 3).join(', ')}</span></> : null}
              </div>
              {codeDeleteMode === 'single' ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm('¿Eliminar este código y su jerarquía?')) return;
                      deleteCodeTree(slug);
                    }}
                  >
                    Eliminar uno a uno
                  </button>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                className="rounded-md border bg-white p-1.5 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  setCodeMenuSlug((prev) => (prev === slug ? '' : slug));
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {codeMenuSlug === slug ? (
                <div className="absolute right-0 top-9 z-50 w-52 rounded-lg border bg-white p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('edit', code)}>Editar código</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('create', null, slug)}>Crear subcódigo</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('edit', code)}>Mover jerarquía</button>
                  <button type="button" className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setCodeCardSlug(slug); setCodeMenuSlug(''); setCodeCardDeleteMode('none'); }}><Eye className="h-3.5 w-3.5" />Ver tarjeta</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setCodeMapOpen(true); setCodeMenuSlug(''); }}>Ir a mapa de códigos</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => {
                    if (!window.confirm('¿Eliminar este código y su jerarquía?')) return;
                    deleteCodeTree(slug);
                  }}>Eliminar código</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {children.slice(0, 4).map((child) => (
              <span key={`${slug}_${child.slug}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{child.name}</span>
            ))}
          </div>
        </article>

        {!isCollapsed ? children.map((child) => renderCodeNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <>
      <Helmet><title>Modo comentarios</title></Helmet>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700">
                <ArrowLeft className="mr-1 h-4 w-4" /> Volver a campaña
              </Link>
              <p className="mt-2 text-sm text-slate-500">Proyecto / Campaña / Comentarios</p>
              <h1 className="text-2xl font-bold text-slate-900">Modo comentarios</h1>
              <p className="text-xs text-slate-500">Proyecto {projectId} · Campaña {campaignId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs ${activeWorkspace ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                Workspace: {activeWorkspace?.name || 'Sin seleccionar'}
              </span>
              <div className="relative">
                <Button className="bg-white border text-slate-700" onClick={() => setWorkspaceMenuOpen((prev) => !prev)}>
                  <MoreHorizontal className="mr-1 h-4 w-4" /> Opciones
                </Button>
                {workspaceMenuOpen ? (
                  <div className="absolute right-0 top-11 z-40 min-w-[180px] rounded-lg border bg-white p-1.5 shadow-lg">
                    <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => { setWorkspaceModalOpen(true); setWorkspaceMenuOpen(false); }}>Ver Workspaces</button>
                  </div>
                ) : null}
              </div>
              <Button className="bg-indigo-600 text-white" onClick={() => setTab('reader')} disabled={!workspaceContext.workspaceId}>Abrir lector</Button>
              <Button className="bg-white border text-indigo-700" onClick={() => setTab('codes')} disabled={!workspaceContext.workspaceId}>Crear código</Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Comentarios</p>
              <p className="text-2xl font-semibold text-slate-900">{commentsTable.total}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Fragmentos</p>
              <p className="text-2xl font-semibold text-slate-900">{fragments.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Códigos</p>
              <p className="text-2xl font-semibold text-slate-900">{codes.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Clusters</p>
              <p className="text-2xl font-semibold text-slate-900">{clusters.length}</p>
            </div>
          </div>

          <div className="bg-white border rounded-xl p-1 flex flex-wrap gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'comments' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Base de comentarios</h2>
              <div className="inline-flex rounded-lg border bg-slate-50 p-1">
                <button type="button" className={`rounded-md px-3 py-1.5 text-xs ${commentsSubtab === 'ingestion' ? 'bg-white text-indigo-700 border' : 'text-slate-600'}`} onClick={() => setCommentsSubtab('ingestion')}>Ingesta</button>
                <button type="button" className={`rounded-md px-3 py-1.5 text-xs ${commentsSubtab === 'table' ? 'bg-white text-indigo-700 border' : 'text-slate-600'}`} onClick={() => setCommentsSubtab('table')}>Tabla de comentarios</button>
              </div>

              {commentsSubtab === 'ingestion' ? (
              <>

              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-indigo-900">Ingesta YouTube (lógica tipo job configurable)</p>
                  <p className="text-xs text-indigo-800">Configura input, ejecuta run y genera dataset reutilizable para la base de comentarios.</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input className="rounded-lg border p-2 text-sm" placeholder="URL de video YouTube" value={ingestionDraft.videoUrl} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoUrl: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Video ID (opcional)" value={ingestionDraft.videoId} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoId: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Channel ID (opcional si no hay video)" value={ingestionDraft.channelId} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, channelId: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Palabra clave (filtro opcional)" value={ingestionDraft.keyword} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, keyword: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Búsqueda de videos en YouTube (opcional)" value={ingestionDraft.videoSearchQuery} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoSearchQuery: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" type="number" min={1} max={50} placeholder="Cantidad de videos (opcional)" value={ingestionDraft.videosLimit} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videosLimit: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" type="number" min={1} max={500} placeholder="Comentarios por video (obligatorio)" value={ingestionDraft.commentsPerVideo} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, commentsPerVideo: e.target.value }))} required />
                  <select className="rounded-lg border p-2 text-sm" value={ingestionDraft.order} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, order: e.target.value }))}>
                    <option value="time">Orden: más recientes (time)</option>
                    <option value="relevance">Orden: relevancia (relevance)</option>
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={ingestionDraft.includeReplies} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, includeReplies: e.target.checked }))} />
                  Incluir respuestas (replies)
                </label>
                {ingestionError ? <p className="text-xs text-rose-600">{ingestionError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button className="bg-white border text-slate-700" onClick={saveIngestionInput}>Guardar input</Button>
                  <Button className="bg-indigo-600 text-white" disabled={ingestionBusy} onClick={runYouTubeIngestion}>{ingestionBusy ? 'Ejecutando ingesta…' : 'Ejecutar ingesta'}</Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Inputs guardados</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                      {ingestionInputs.length === 0 ? <p className="text-xs text-slate-500">Sin configuraciones guardadas.</p> : ingestionInputs.map((input) => (
                        <button key={input.id} className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50" onClick={() => setIngestionDraft((prev) => ({
                          ...prev,
                          videoUrl: input?.config?.video_url || '',
                          videoId: input?.config?.video_id || '',
                          channelId: input?.config?.channel_id || '',
                          keyword: input?.config?.keyword || '',
                          videoSearchQuery: input?.config?.video_search_query || '',
                          videosLimit: input?.config?.videos_limit ?? '',
                          commentsPerVideo: input?.config?.comments_per_video ?? input?.config?.max_comments ?? 100,
                          includeReplies: Boolean(input?.config?.include_replies),
                          order: input?.config?.order || 'time',
                        }))}>
                          {input.name || 'Input'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Runs recientes</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                      {ingestionRuns.length === 0 ? <p className="text-xs text-slate-500">Sin ejecuciones.</p> : ingestionRuns.slice(0, 8).map((run) => (
                        <div key={run.id} className="rounded border px-2 py-1 text-xs">
                          <p className="font-medium text-slate-700">{run.status === 'succeeded' ? '✅' : run.status === 'running' ? '⏳' : '❌'} {new Date(run.created_at).toLocaleString()}</p>
                          <p className="text-slate-500">Input: {run.input_name || run.input_id || '—'} · Importados: {run.imported_count || 0}</p>
                          <div className="mt-1 flex justify-end">
                            <button type="button" className="text-[11px] text-rose-600 hover:underline" onClick={() => deleteRun(run.id)}>Eliminar run</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              </>
              ) : null}

              {commentsSubtab === 'table' ? (
                <div className="rounded-lg border bg-white overflow-hidden">
                  <div className="p-3 border-b flex flex-wrap items-center gap-2 justify-between">
                    <input className="rounded border px-2 py-1.5 text-sm w-full max-w-sm" placeholder="Buscar texto / autor / id" value={commentsTable.q} onChange={(e) => setCommentsTable((prev) => ({ ...prev, q: e.target.value }))} />
                    <Button className="bg-white border text-slate-700" onClick={() => loadCommentsTable({ offset: 0, q: commentsTable.q })}>Buscar</Button>
                  </div>
                  {commentsTable.error ? <p className="px-3 py-2 text-xs text-rose-600">{commentsTable.error}</p> : null}
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600 text-xs">
                        <tr>
                          <th className="px-3 py-2 text-left">Fuente</th>
                          <th className="px-3 py-2 text-left">Comentario</th>
                          <th className="px-3 py-2 text-left">Autor</th>
                          <th className="px-3 py-2 text-left">Video</th>
                          <th className="px-3 py-2 text-left">Likes</th>
                          <th className="px-3 py-2 text-left">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commentsTable.loading ? (
                          <tr><td className="px-3 py-3 text-slate-500" colSpan={6}>Cargando comentarios...</td></tr>
                        ) : commentsTable.items.length === 0 ? (
                          <tr><td className="px-3 py-3 text-slate-500" colSpan={6}>Sin registros en tabla.</td></tr>
                        ) : commentsTable.items.map((row) => (
                          <tr key={row.id} className="border-t align-top">
                            <td className="px-3 py-2">{row.source}</td>
                            <td className="px-3 py-2 text-slate-800 max-w-[520px]">
                              <p className="line-clamp-3">{row.text}</p>
                              <p className="text-[11px] text-slate-500 mt-1">{row.source_comment_id}</p>
                            </td>
                            <td className="px-3 py-2">{row.author_name || '—'}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.video_id || '—'}</td>
                            <td className="px-3 py-2">{row.like_count || 0}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.published_at ? new Date(row.published_at).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-3 border-t flex items-center justify-between text-xs text-slate-600">
                    <span>Total: {commentsTable.total}</span>
                    <div className="flex gap-2">
                      <Button className="bg-white border" disabled={commentsTable.offset <= 0} onClick={() => loadCommentsTable({ offset: Math.max(0, commentsTable.offset - commentsTable.limit), q: commentsTable.q })}>Anterior</Button>
                      <Button className="bg-white border" disabled={commentsTable.offset + commentsTable.limit >= commentsTable.total} onClick={() => loadCommentsTable({ offset: commentsTable.offset + commentsTable.limit, q: commentsTable.q })}>Siguiente</Button>
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
          )}

          {tab === 'reader' && (
            <div className="rounded-xl border bg-[#f8fafc] p-4 space-y-3">
              <div>
                <h2 className="font-semibold text-slate-900">Lector</h2>
                <p className="text-xs text-slate-500">Lector semántico de comentarios para extraer fragmentos desde la base de comentarios.</p>
              </div>
              <Toolbar
                collapsed={false}
                onBackToCloud={() => setTab('comments')}
                onDownloadDocument={() => loadCommentsTable({ offset: 0, q: commentsTable.q })}
                onCreateFragment={() => createCommentFragment({
                  text: readerSelection.text,
                  comment: selectedReaderComment,
                  sourceType: 'selection',
                  selectionStart: readerSelection.start,
                  selectionEnd: readerSelection.end,
                })}
                onCreateManualFragment={() => {
                  const manualText = window.prompt('Nuevo fragmento manual');
                  if (!manualText) return;
                  createCommentFragment({ text: manualText, comment: selectedReaderComment || readerComments[0], sourceType: 'manual' });
                }}
                onViewFragments={() => setTab('fragments')}
                onViewCodes={() => setTab('codes')}
                onLinkCode={() => setTab('codes')}
                onViewClusters={() => setTab('clusters')}
                onActivateAnalysis={() => setTab('comments')}
                onCreateMemo={() => {
                  const memoText = window.prompt('Memo de lectura');
                  if (!memoText) return;
                  createCommentFragment({ text: memoText, comment: selectedReaderComment || readerComments[0], sourceType: 'manual' });
                }}
                onToggleView={() => setReaderViewMode((prev) => (prev === 'document' ? 'focus' : 'document'))}
                canCreateFragment={Boolean(readerSelection.text.trim() && selectedReaderComment && readerSelection.commentId === String(selectedReaderComment.id || ''))}
                viewLabel={readerViewMode === 'focus' ? 'focus' : 'comentario'}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button className="bg-violet-600 text-white" disabled={semanticAgentBusy || commentsTable.loading} onClick={runSemanticFragmentAgent}>
                  {semanticAgentBusy ? `Fragmentando ${semanticAgentProgress.done}/${semanticAgentProgress.total || 0}…` : 'Auto-fragmentar con IA (lote)'}
                </Button>
                {semanticAgentError ? <p className="text-xs text-rose-600">{semanticAgentError}</p> : null}
              </div>
              <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="rounded-xl border bg-white p-2 max-h-[560px] overflow-auto">
                  <p className="px-2 py-1 text-xs font-semibold text-slate-500">Comentarios ({readerComments.length})</p>
                  <div className="space-y-1.5">
                    {readerComments.length === 0 ? <p className="px-2 py-3 text-xs text-slate-500">No hay comentarios cargados.</p> : readerComments.map((comment) => (
                      <button
                        type="button"
                        key={comment.id}
                        className={`w-full rounded-lg border p-2 text-left text-xs ${String(selectedReaderComment?.id) === String(comment.id) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        onClick={() => {
                          setSelectedReaderCommentId(String(comment.id));
                          setReaderSelection({ text: '', start: null, end: null, commentId: '' });
                        }}
                      >
                        <p className="line-clamp-2 text-slate-700">{comment.text || 'Sin texto'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{comment.author_name || 'Autor desconocido'} · {comment.video_id || 'sin video'}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border bg-white shadow-sm">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Comentario seleccionado</p>
                    <p className="text-xs text-slate-500">Selecciona texto y usa “Crear fragmento” en la barra de tareas.</p>
                  </div>
                  <div
                    ref={readerTextContainerRef}
                    className={`min-h-[320px] max-h-[560px] overflow-auto text-slate-800 whitespace-pre-wrap ${readerViewMode === 'focus' ? 'px-10 py-8 text-[16px] leading-8' : 'px-6 py-5 text-[14px] leading-7'}`}
                    onMouseUp={captureReaderSelection}
                  >
                    {selectedReaderComment?.text || 'Selecciona un comentario de la lista para comenzar.'}
                  </div>
                  <div className="border-t px-4 py-2 text-xs text-slate-600 flex flex-wrap items-center gap-2">
                    <span>Fuente: {selectedReaderComment?.source || 'youtube'}</span>
                    <span>·</span>
                    <span>Autor: {selectedReaderComment?.author_name || '—'}</span>
                    <span>·</span>
                    <span>Video: {selectedReaderComment?.video_id || '—'}</span>
                    {readerSelection.text ? <span className="ml-auto rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">Selección lista ({readerSelection.text.length} chars, {readerSelection.start ?? 0}-{readerSelection.end ?? 0})</span> : null}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'fragments' && (
            <div className="rounded-xl border bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Fragmentos</h2>
                  <p className="text-xs text-slate-500">Consola semántica de entidades para comentarios.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="bg-white border text-rose-700" disabled={!fragments.length} onClick={deleteAllFragments}>
                    Eliminar todo ({fragments.length})
                  </Button>
                  <Button className="bg-white border text-rose-700" disabled={!selectedFragmentIds.length} onClick={deleteSelectedFragments}>
                    Eliminar seleccionados ({selectedFragmentIds.length})
                  </Button>
                  <Button className="bg-indigo-600 text-white" onClick={() => openFragmentEditor(null, 'create')}>
                    <Plus className="mr-1 h-4 w-4" /> Crear fragmento
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm"
                    placeholder="Buscar título o extracto"
                    value={fragmentQuery}
                    onChange={(e) => setFragmentQuery(e.target.value)}
                  />
                </label>
                <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={fragmentCodeFilter} onChange={(e) => setFragmentCodeFilter(e.target.value)}>
                  <option value="">Filtrar por código</option>
                  {codes.map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                </select>
                <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={fragmentClientFilter} onChange={(e) => setFragmentClientFilter(e.target.value)}>
                  <option value="">Filtrar por cliente</option>
                  {fragmentClientOptions.map((clientId) => <option key={clientId} value={clientId}>{clientId}</option>)}
                </select>
                <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={fragmentInterviewFilter} onChange={(e) => setFragmentInterviewFilter(e.target.value)}>
                  <option value="">Filtrar por entrevista</option>
                  {fragmentInterviewOptions.map((interviewId) => <option key={interviewId} value={interviewId}>{interviewId}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                {!filteredFragments.length ? <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-slate-500">No hay fragmentos para los filtros aplicados.</p> : filteredFragments.map((fragment) => {
                  const fragmentId = String(fragment.id);
                  const selected = selectedFragmentId === fragmentId;
                  const linkedCode = codes.find((code) => (fragment.code_slugs || []).includes(code.slug));

                  return (
                    <article
                      key={fragment.id}
                      className={`group relative rounded-xl border bg-white p-4 shadow-sm transition ${selected ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200 hover:shadow-md'}`}
                      onClick={() => setSelectedFragmentId(fragmentId)}
                    >
                      <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-transparent group-hover:bg-indigo-200" />
                      {selected ? <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-indigo-500" /> : null}

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{fragment.title || 'Fragmento sin título'}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{fragment.excerpt}</p>
                        </div>
                        <div className="relative flex items-center gap-2">
                          <label className="inline-flex items-center">
                            <input
                              type="checkbox"
                              checked={selectedFragmentIds.includes(fragmentId)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleFragmentSelection(fragmentId);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="rounded-md border bg-white p-1.5 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-slate-800"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFragmentMenuId((prev) => (prev === fragmentId ? '' : fragmentId));
                            }}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {fragmentMenuId === fragmentId ? (
                            <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border bg-white p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openFragmentEditor(fragment, 'edit')}>Editar fragmento</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { goToFragmentOrigin(fragment); setFragmentMenuId(''); }}>Ir a origen</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openFragmentEditor(fragment, 'edit')}>Vincular código</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { if (!COMMENT_CODE_EVOLUTION_DISABLED) evolveFragmentToCode(fragment); setFragmentMenuId(''); }} disabled={COMMENT_CODE_EVOLUTION_DISABLED}>Evolución deshabilitada</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => { deleteSingleFragment(fragmentId); setFragmentMenuId(''); }}>Eliminar fragmento</button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {linkedCode ? <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">{linkedCode.name}</span> : <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Sin código</span>}
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">Origen: {fragment.source_comment_id || fragment.comment_id || '—'}</span>
                        <span>Tipo: {fragment.source_type || 'manual'}</span>
                        {(fragment.selection_start != null && fragment.selection_end != null) ? <span>Rango: {fragment.selection_start}-{fragment.selection_end}</span> : null}
                        <span>Cliente: {fragment.client_id || '—'}</span>
                        <span>Entrevista: {fragment.interview_id || '—'}</span>
                        <span>Fecha: {fragment.created_at ? new Date(fragment.created_at).toLocaleDateString() : '—'}</span>
                      </div>
                    </article>
                  );
                })}
              </div>

              {fragmentEditor.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
                  <div className="w-full max-w-2xl rounded-xl border bg-white shadow-xl">
                    <div className="border-b px-5 py-4">
                      <h3 className="text-sm font-semibold text-slate-900">{fragmentEditor.mode === 'create' ? 'Crear fragmento' : 'Editar fragmento'}</h3>
                      <p className="text-xs text-slate-500">Completa los campos semánticos del fragmento.</p>
                    </div>
                    <div className="space-y-3 px-5 py-4">
                      <input
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        placeholder="Título del fragmento"
                        value={fragmentEditor.title}
                        onChange={(e) => setFragmentEditor((prev) => ({ ...prev, title: e.target.value }))}
                      />
                      <textarea
                        className="h-36 w-full rounded-lg border px-3 py-2 text-sm"
                        placeholder="Texto del fragmento"
                        value={fragmentEditor.excerpt}
                        onChange={(e) => setFragmentEditor((prev) => ({ ...prev, excerpt: e.target.value }))}
                      />
                      <select
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        value={fragmentEditor.linkedCode}
                        onChange={(e) => setFragmentEditor((prev) => ({ ...prev, linkedCode: e.target.value }))}
                      >
                        <option value="">Sin código vinculado</option>
                        {codes.map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                      </select>
                      {fragmentEditor.mode === 'edit' ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
                          <p className="font-semibold text-slate-900">Trazabilidad de evidencia</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-white px-2 py-0.5 border">Comentario: {fragmentEditor.sourceCommentId || '—'}</span>
                            <span className="rounded bg-white px-2 py-0.5 border">Tipo: {fragmentEditor.sourceType || 'manual'}</span>
                            {(fragmentEditor.selectionStart != null && fragmentEditor.selectionEnd != null) ? (
                              <span className="rounded bg-white px-2 py-0.5 border">Rango: {fragmentEditor.selectionStart}-{fragmentEditor.selectionEnd}</span>
                            ) : null}
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-slate-800">Texto extraído</p>
                            <p className="rounded border bg-white px-2 py-1 whitespace-pre-wrap">{fragmentEditor.selectedText || fragmentEditor.excerpt || '—'}</p>
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-slate-800">Comentario origen (con anclaje)</p>
                            <p className="rounded border bg-white px-2 py-1 whitespace-pre-wrap">{renderFragmentSourceWithHighlight({ source_comment_text: fragmentEditor.sourceCommentText, selection_start: fragmentEditor.selectionStart, selection_end: fragmentEditor.selectionEnd })}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between border-t px-5 py-3">
                      <Button
                        className="bg-white border text-slate-700"
                        onClick={() => {
                          if (fragmentEditor.mode !== 'edit') return;
                          const target = fragments.find((fragment) => String(fragment.id) === String(fragmentEditor.fragmentId));
                          if (!target) return;
                          if (!COMMENT_CODE_EVOLUTION_DISABLED) evolveFragmentToCode({ ...target, title: fragmentEditor.title || target.title, excerpt: fragmentEditor.excerpt || target.excerpt });
                          closeFragmentEditor();
                        }}
                        disabled={fragmentEditor.mode !== 'edit'}
                      >
                        Evolución deshabilitada
                      </Button>
                      <div className="flex items-center gap-2">
                        <Button className="bg-white border text-slate-700" onClick={closeFragmentEditor}>Cancelar</Button>
                        <Button className="bg-indigo-600 text-white" onClick={saveFragmentEditor}>Guardar</Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {tab === 'codes' && (
            <div className="rounded-xl border bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Lista de códigos</h2>
                  <p className="text-xs text-slate-500">Panel de estructura semántica jerárquica.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button className="bg-violet-600 text-white" onClick={runCodeProposalAgent}>
                    Agente 2 · Clusterizar pendientes
                  </Button>
                  <Button className="bg-indigo-600 text-white" onClick={() => openCodeEditor('create')}>
                    <Plus className="mr-1 h-4 w-4" /> Crear código
                  </Button>
                  <div className="relative">
                    <Button className="bg-white border text-slate-700" onClick={() => setCodesActionsMenuOpen((prev) => !prev)}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    {codesActionsMenuOpen ? (
                      <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border bg-white p-1.5 shadow-lg">
                        <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { runGenerateCodesWithoutTraceability(); setCodesActionsMenuOpen(false); }}>Generar</button>
                        <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setCodeMapOpen(true); setCodesActionsMenuOpen(false); }}>Mapa de códigos</button>
                        <button type="button" className={`w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${codeDeleteMode === 'single' ? 'bg-slate-100 font-medium' : ''}`} onClick={() => { setCodeDeleteMode((prev) => (prev === 'single' ? 'none' : 'single')); setCodesActionsMenuOpen(false); }}>
                          Eliminar uno a uno
                        </button>
                        <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={deleteAllCodes}>
                          Eliminar todo
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {codeDeleteMode === 'single' ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Modo eliminación uno a uno activo. Haz clic en “Eliminar uno a uno” dentro de cada código para depurar sin ambigüedad.
                </div>
              ) : null}

              {codeCard ? (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                    <div>
                      <button type="button" className="mb-2 inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => { setCodeCardSlug(''); setCodeCardDeleteMode('none'); setCodeCardDeleteMenuOpen(false); }}>
                        <ArrowLeft className="h-3.5 w-3.5" /> Volver a lista de códigos
                      </button>
                      <h3 className="text-lg font-semibold text-slate-900">{codeCard.code.name}</h3>
                      <p className="mt-1 max-w-3xl text-sm text-slate-600">{codeCard.code.description || 'Sin descripción detallada para este código.'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="rounded-full border bg-slate-50 px-2 py-0.5">slug: {codeCard.code.slug}</span>
                        <span className="rounded-full border bg-slate-50 px-2 py-0.5">tipo: {codeCard.code.code_type || 'general'}</span>
                        <span className={`rounded-full border px-2 py-0.5 ${getScoreColorClass(codeCard.score.score_total)}`}>score total: {codeCard.score.score_total}/100</span>
                      </div>
                    </div>
                    <div className="relative">
                      <Button className="bg-white border text-rose-700" onClick={() => setCodeCardDeleteMenuOpen((prev) => !prev)} disabled={!codeCard.fragments.length}>
                        <Trash2 className="mr-1 h-4 w-4" /> ELIMINAR
                      </Button>
                      {codeCardDeleteMenuOpen ? (
                        <div className="absolute right-0 top-11 z-20 w-52 rounded-lg border bg-white p-1.5 shadow-lg">
                          <button type="button" className={`w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${codeCardDeleteMode === 'single' ? 'bg-slate-100 font-medium' : ''}`} onClick={() => { setCodeCardDeleteMode('single'); setCodeCardDeleteMenuOpen(false); }}>Eliminar uno a uno</button>
                          <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={removeAllFragmentsFromCodeCard}>Eliminar todo</button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"><BarChart3 className="mr-1 inline h-3.5 w-3.5" />Frecuencia</p><p className="mt-1 text-2xl font-semibold text-slate-900">{codeCard.metrics.frequency}</p><p className="text-xs text-slate-500">fragmentos totales del código</p></div>
                    <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Activity className="mr-1 inline h-3.5 w-3.5" />Sentimiento agregado</p><p className="mt-1 text-2xl font-semibold text-slate-900">{codeCard.metrics.sentimentAverage}</p><p className="text-xs text-slate-500">+{codeCard.metrics.sentimentCounts.positivo} / ={codeCard.metrics.sentimentCounts.neutral} / -{codeCard.metrics.sentimentCounts.negativo}</p></div>
                    <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Sparkles className="mr-1 inline h-3.5 w-3.5" />Coherencia / Intensidad</p><p className="mt-1 text-2xl font-semibold text-slate-900">{codeCard.metrics.coherence}% · {codeCard.metrics.intensity}%</p><p className="text-xs text-slate-500">coherencia interna e intensidad narrativa</p></div>
                    <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"><GitBranch className="mr-1 inline h-3.5 w-3.5" />Dispersión</p><p className="mt-1 text-2xl font-semibold text-slate-900">{codeCard.metrics.uniqueComments}</p><p className="text-xs text-slate-500">comentarios · {codeCard.metrics.uniqueVideos} videos · {codeCard.metrics.uniqueRuns} runs · {codeCard.metrics.uniqueSources} fuentes</p></div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Distribución temporal</p>
                      {!codeCard.metrics.distributionByMonth.length ? <p className="mt-2 text-xs text-slate-500">Sin fechas suficientes para distribución temporal.</p> : <div className="mt-2 space-y-1.5">{codeCard.metrics.distributionByMonth.map((row) => { const maxCount = Math.max(1, ...codeCard.metrics.distributionByMonth.map((item) => item.count)); const width = Math.max(8, Math.round((Number(row.count || 0) / maxCount) * 100)); return <div key={`period-${row.period}`} className="space-y-1"><div className="flex items-center justify-between text-[11px] text-slate-600"><span><CalendarClock className="mr-1 inline h-3 w-3" />{row.period}</span><span>{row.count}</span></div><div className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-indigo-500" style={{ width: `${width}%` }} /></div></div>; })}</div>}
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Jerarquía y señal semántica</p>
                      <p className="mt-2 text-xs text-slate-600">Padre: <span className="font-medium text-slate-800">{codeCard.hierarchy.parent?.name || 'Sin padre'}</span></p>
                      <p className="mt-1 text-xs text-slate-600">Hijos: <span className="font-medium text-slate-800">{codeCard.hierarchy.children.length}</span></p>
                      <p className="mt-1 text-xs text-slate-600">Riqueza semántica agregada: <span className="font-medium text-slate-800">{codeCard.metrics.semanticRichness}%</span></p>
                      <div className="mt-2 flex flex-wrap gap-1">{codeCard.topTerms.length ? codeCard.topTerms.slice(0, 8).map(([term, count]) => (<span key={`${codeCard.code.slug}-term-${term}`} className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-600">{term} ({count})</span>)) : <span className="text-xs text-slate-500">Sin términos frecuentes.</span>}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">Fragmentos del código ({codeCard.fragments.length})</p>{codeCardDeleteMode === 'single' ? <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">Modo eliminar uno a uno activo</span> : null}</div>
                    {!codeCard.fragments.length ? <p className="text-sm text-slate-500">Este código aún no tiene fragmentos asociados.</p> : <div className="grid gap-2 md:grid-cols-2">{codeCard.fragments.map((fragment) => (<article key={`code-card-fragment-${fragment.id}`} className="rounded-lg border bg-white p-3 text-sm text-slate-700 shadow-sm"><p className="line-clamp-5 whitespace-pre-wrap text-slate-800">{fragment.excerpt || fragment.selected_text || 'Sin texto disponible'}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>{fragment.author_name || 'Autor desconocido'}</span><span>·</span><span>{fragment.video_id || 'sin video'}</span><span>·</span><span>{fragment.source_type || 'origen no definido'}</span></div>{codeCardDeleteMode === 'single' ? <div className="mt-2 flex justify-end"><button type="button" className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100" onClick={() => removeFragmentFromCodeCard(fragment.id)}>Eliminar fragmento</button></div> : null}</article>))}</div>}
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm" placeholder="Buscar código o descripción" value={codeQuery} onChange={(e) => setCodeQuery(e.target.value)} />
                    </label>
                    <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={codeHypothesisFilter} onChange={(e) => setCodeHypothesisFilter(e.target.value)}>
                      <option value="">Filtrar por hipótesis</option>
                      {codeHypothesisOptions.map((hypothesisId) => <option key={hypothesisId} value={hypothesisId}>{hypothesisId}</option>)}
                    </select>
                    <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={codeClusterFilter} onChange={(e) => setCodeClusterFilter(e.target.value)}>
                      <option value="">Filtrar por cluster</option>
                      {codeClusterOptions.map((clusterId) => <option key={clusterId} value={clusterId}>{clusterId}</option>)}
                    </select>
                    <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={codeClientFilter} onChange={(e) => setCodeClientFilter(e.target.value)}>
                      <option value="">Filtrar por cliente</option>
                      {codeClientOptions.map((clientId) => <option key={clientId} value={clientId}>{clientId}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center justify-end">
                    <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={codeSortBy} onChange={(e) => setCodeSortBy(e.target.value)}>
                      <option value="score_total_desc">Ordenar por score total</option>
                      <option value="frecuencia_desc">Ordenar por frecuencia</option>
                      <option value="dispersion_desc">Ordenar por dispersión</option>
                      <option value="name_asc">Ordenar por nombre</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    {!codeTreeRoots.roots.length ? <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-slate-500">No hay códigos para los filtros aplicados.</p> : codeTreeRoots.roots.map((code) => renderCodeNode(code, 0))}
                  </div>
                </>
              )}

              <div className="rounded-xl border bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Panel Humano · Propuestas de codificación (Agente 2)</h3>
                    <p className="text-xs text-slate-500">Control humano consciente: aceptar, corregir, fusionar o rechazar sin automatización opaca.</p>
                  </div>
                  <div className="text-xs text-slate-600">
                    Total: {codeProposals.length} · Pendientes/Propuestas: {codeProposals.filter((item) => ['pendiente', 'propuesto'].includes(String(item.status || 'pendiente'))).length}
                    {codeSelectionMetrics ? (
                      <span className="ml-2 text-[11px] text-slate-500">
                        · IA seleccionó {Number(codeSelectionMetrics.total_fragments_selected || 0)} / {Number(codeSelectionMetrics.total_fragments_analyzed || 0)} · códigos {Number(codeSelectionMetrics.final_codes_count || 0)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm" placeholder="Buscar por texto de fragmento o código" value={proposalQuery} onChange={(e) => setProposalQuery(e.target.value)} />
                  </label>
                  <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={proposalStatusFilter} onChange={(e) => setProposalStatusFilter(e.target.value)}>
                    <option value="">Estados: todos</option>
                    <option value="pendiente,propuesto">Estados: pendiente + propuesto</option>
                    <option value="propuesto">Estado: propuesto</option>
                    <option value="pendiente">Estado: pendiente</option>
                    <option value="aceptado,corregido,fusionado,reasignado,rechazado">Estados revisados</option>
                  </select>
                  <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={proposalTypeFilter} onChange={(e) => setProposalTypeFilter(e.target.value)}>
                    <option value="">Tipo: todos</option>
                    <option value="reutilizacion">Solo reutilización</option>
                    <option value="nuevo">Solo nuevo candidato</option>
                  </select>
                  <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={proposalSortBy} onChange={(e) => setProposalSortBy(e.target.value)}>
                    <option value="confidence_desc">Orden: confianza (desc)</option>
                    <option value="confidence_asc">Orden: confianza (asc)</option>
                    <option value="date_desc">Orden: fecha (más reciente)</option>
                    <option value="date_asc">Orden: fecha (más antiguo)</option>
                    <option value="type">Orden: tipo</option>
                  </select>
                  <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={proposalComparisonCode} onChange={(e) => { setProposalComparisonCode(e.target.value); setProposalComparisonPage(0); }}>
                    <option value="">Vista comparativa por código</option>
                    {codes.map((code) => <option key={`comparison-${code.slug}`} value={code.slug}>{code.name}</option>)}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs">
                  <div className="text-slate-600">
                    Seleccionadas: <span className="font-semibold text-slate-900">{selectedProposalIds.length}</span> de {humanPanelProposals.length} visibles
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button className="bg-white border text-slate-700" disabled={!humanPanelProposals.length} onClick={selectAllVisibleProposals}>Seleccionar todo (visible)</Button>
                    <Button className="bg-white border text-slate-700" disabled={!selectedProposalIds.length} onClick={clearProposalSelection}>Limpiar selección</Button>
                    <Button className="bg-white border text-rose-700" disabled={!selectedProposalIds.length} onClick={deleteSelectedProposals}>Eliminar seleccionadas</Button>
                  </div>
                </div>

                {proposalComparisonCode ? (
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-700">Vista comparativa · {codes.find((code) => String(code.slug) === String(proposalComparisonCode))?.name || proposalComparisonCode}</p>
                        <p className="text-[11px] text-slate-500">Ocurrencias: {proposalComparisonRows.length} · Relación con propuestas actuales visible en la lista.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button className="bg-white border text-slate-700" disabled={proposalComparisonPage <= 0} onClick={() => setProposalComparisonPage((prev) => Math.max(0, prev - 1))}>Anterior</Button>
                        <Button className="bg-white border text-slate-700" disabled={(proposalComparisonPage + 1) * proposalComparisonPageSize >= proposalComparisonRows.length} onClick={() => setProposalComparisonPage((prev) => prev + 1)}>Siguiente</Button>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {!paginatedProposalComparisonRows.length ? <p className="text-xs text-slate-500">Sin fragmentos asociados en esta página.</p> : paginatedProposalComparisonRows.map((fragment) => (
                        <div key={`compare-fragment-${fragment.id}`} className="rounded border bg-white px-2 py-1.5 text-xs text-slate-700">
                          <p className="font-medium text-slate-800">{fragment.title || 'Fragmento sin título'}</p>
                          <p className="line-clamp-2 text-slate-600">{fragment.excerpt || 'Sin extracto'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!codeProposals.length ? (
                  <p className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">Sin propuestas aún. Ejecuta “Agente 2 · Clusterizar pendientes”.</p>
                ) : !humanPanelProposals.length ? (
                  <div className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">
                    <p>No hay propuestas para los filtros actuales.</p>
                    <button
                      type="button"
                      className="mt-2 text-indigo-600 hover:underline"
                      onClick={() => {
                        setProposalStatusFilter('');
                        setProposalTypeFilter('');
                        setProposalQuery('');
                      }}
                    >
                      Limpiar filtros y mostrar todas
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[380px] overflow-auto pr-1">
                    {humanPanelProposals.map((proposal) => {
                      const linkedFragment = fragmentById.get(String(proposal.fragment_id || ''));
                      const proposalStatus = String(proposal.status || 'pendiente');
                      const draft = getDraftForProposal(proposal.id);
                      const isSelected = selectedProposalIds.includes(String(proposal.id));
                      const similarExistingCodes = codes
                        .map((code) => ({ code, score: scoreCodeReuse(String(linkedFragment?.excerpt || proposal.fragment_excerpt || ''), code) }))
                        .filter((item) => item.score > 0.08)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 4);
                      const statusClass = proposal.status === 'aceptado'
                        ? 'bg-emerald-50 border-emerald-200'
                        : ['rechazado'].includes(proposalStatus)
                          ? 'bg-rose-50 border-rose-200'
                          : 'bg-amber-50 border-amber-200';
                      const decisionClass = proposal.decision_type === 'reutilizacion'
                        ? 'bg-blue-100 text-blue-700 border-blue-200'
                        : 'bg-violet-100 text-violet-700 border-violet-200';
                      const isExpanded = String(activeProposalId) === String(proposal.id);
                      return (
                        <article key={proposal.id} className={`rounded-lg border p-3 ${statusClass}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <label className="inline-flex items-center gap-1 rounded border bg-white px-2 py-0.5 text-slate-700">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleProposalSelection(proposal.id)} />
                                Seleccionar
                              </label>
                              <span className={`rounded-full border px-2 py-0.5 ${decisionClass}`}>
                                {proposal.decision_type === 'reutilizacion' ? 'Reutilización código existente' : 'Código nuevo candidato'}
                              </span>
                              <span className="rounded-full border bg-white px-2 py-0.5">Estado: {proposalStatus}</span>
                              <span className="rounded-full border bg-white px-2 py-0.5">Confianza: {proposal.confidence ?? '—'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-[11px] text-slate-500">Fragmento: {proposal.fragment_id}</div>
                              <Button className="bg-white border text-slate-700" onClick={() => setActiveProposalId(isExpanded ? '' : String(proposal.id))}>{isExpanded ? 'Cerrar panel' : 'Revisar propuesta'}</Button>
                              <Button className="bg-white border text-rose-700" onClick={() => deleteProposalById(proposal.id)}>Eliminar</Button>
                            </div>
                          </div>

                          <p className="mt-2 text-sm text-slate-800">{proposal.fragment_excerpt || linkedFragment?.excerpt || 'Sin texto de fragmento'}</p>
                          {linkedFragment?.source_comment_text ? <p className="mt-1 rounded border bg-white px-2 py-1 text-xs text-slate-600">Origen: {linkedFragment.source_comment_text}</p> : null}
                          <div className="mt-2 text-xs text-slate-700">
                            <span className="font-semibold">Código sugerido:</span> {proposal.suggested_code_name} <span className="text-slate-500">({proposal.suggested_code_slug})</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">{proposal.justification || 'Sin justificación.'}</div>

                          {Array.isArray(proposal.alternatives) && proposal.alternatives.length ? (
                            <div className="mt-2">
                              <p className="text-[11px] font-semibold text-slate-600">Alternativas cercanas</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {proposal.alternatives.map((alt) => (
                                  <span key={`${proposal.id}-${alt.code_slug}`} className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                    {alt.code_name} ({alt.confidence})
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {(proposal.decision_type === 'nuevo' && similarExistingCodes.length) ? (
                            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
                              <p className="text-[11px] font-semibold text-amber-800">Prevención de caos: códigos similares existentes antes de aceptar nuevo</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {similarExistingCodes.map((row) => (
                                  <span key={`${proposal.id}-similar-${row.code.slug}`} className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                    {row.code.name} ({Number(row.score).toFixed(2)})
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button className="bg-emerald-600 text-white" disabled={proposal.status === 'aceptado'} onClick={() => acceptCodeProposal(proposal)}>Aceptar</Button>
                            <Button className="bg-white border text-rose-700" disabled={proposal.status === 'rechazado'} onClick={() => rejectCodeProposal(proposal.id)}>Rechazar</Button>
                          </div>

                          {isExpanded ? (
                            <div className="mt-3 space-y-2 rounded-lg border bg-white p-3">
                              <p className="text-xs font-semibold text-slate-700">Acciones humanas de revisión</p>
                              <div className="grid gap-2 md:grid-cols-2">
                                <div className="rounded border p-2 text-xs">
                                  <p className="mb-1 font-semibold text-slate-700">Asignar otro código existente</p>
                                  <select className="w-full rounded border px-2 py-1" value={draft.assignExistingSlug} onChange={(e) => updateProposalDraft(proposal.id, { assignExistingSlug: e.target.value })}>
                                    <option value="">Seleccionar código existente</option>
                                    {codes.map((code) => <option key={`${proposal.id}-assign-${code.slug}`} value={code.slug}>{code.name}</option>)}
                                  </select>
                                  <Button className="mt-2 bg-white border text-slate-700" onClick={() => assignExistingCodeToProposal(proposal)}>Reasignar</Button>
                                </div>

                                <div className="rounded border p-2 text-xs">
                                  <p className="mb-1 font-semibold text-slate-700">Crear código manual y asignar</p>
                                  <input className="mb-1 w-full rounded border px-2 py-1" placeholder="Nombre código manual" value={draft.manualCodeName} onChange={(e) => updateProposalDraft(proposal.id, { manualCodeName: e.target.value })} />
                                  <input className="w-full rounded border px-2 py-1" placeholder="Descripción opcional" value={draft.manualCodeDescription} onChange={(e) => updateProposalDraft(proposal.id, { manualCodeDescription: e.target.value })} />
                                  <Button className="mt-2 bg-white border text-slate-700" onClick={() => createManualCodeForProposal(proposal)}>Crear manual</Button>
                                </div>

                                <div className="rounded border p-2 text-xs">
                                  <p className="mb-1 font-semibold text-slate-700">Corregir / renombrar código sugerido</p>
                                  <input className="w-full rounded border px-2 py-1" placeholder="Nuevo nombre sugerido" value={draft.renameSuggestedName} onChange={(e) => updateProposalDraft(proposal.id, { renameSuggestedName: e.target.value })} />
                                  <Button className="mt-2 bg-white border text-slate-700" onClick={() => renameSuggestedProposalCode(proposal)}>Aplicar corrección</Button>
                                </div>

                                <div className="rounded border p-2 text-xs">
                                  <p className="mb-1 font-semibold text-slate-700">Fusionar sugerido con código existente</p>
                                  <select className="w-full rounded border px-2 py-1" value={draft.mergeTargetSlug} onChange={(e) => updateProposalDraft(proposal.id, { mergeTargetSlug: e.target.value })}>
                                    <option value="">Seleccionar código destino</option>
                                    {codes.map((code) => <option key={`${proposal.id}-merge-${code.slug}`} value={code.slug}>{code.name}</option>)}
                                  </select>
                                  <Button className="mt-2 bg-white border text-slate-700" onClick={() => mergeSuggestedWithExistingCode(proposal)}>Fusionar</Button>
                                </div>

                                <div className="rounded border p-2 text-xs md:col-span-2">
                                  <p className="mb-1 font-semibold text-slate-700">Dividir sugerencia antes de aceptar</p>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <input className="w-full rounded border px-2 py-1" placeholder="Nombre división A" value={draft.splitNameA} onChange={(e) => updateProposalDraft(proposal.id, { splitNameA: e.target.value })} />
                                    <input className="w-full rounded border px-2 py-1" placeholder="Nombre división B" value={draft.splitNameB} onChange={(e) => updateProposalDraft(proposal.id, { splitNameB: e.target.value })} />
                                  </div>
                                  <Button className="mt-2 bg-white border text-slate-700" onClick={() => splitSuggestedProposalCode(proposal)}>Aplicar división</Button>
                                </div>
                              </div>

                              {Array.isArray(proposal.review_log) && proposal.review_log.length ? (
                                <div className="rounded border bg-slate-50 p-2">
                                  <p className="mb-1 text-[11px] font-semibold text-slate-700">Trazabilidad de decisiones humanas</p>
                                  <div className="max-h-28 space-y-1 overflow-auto pr-1">
                                    {proposal.review_log.slice().reverse().map((entry, idx) => (
                                      <p key={`${proposal.id}-log-${idx}`} className="text-[11px] text-slate-600">
                                        {entry.acted_at} · {entry.actor} · {entry.action} · final: {entry.final_code_name || entry.final_code_slug || '—'} · original: {entry.original_suggested_code_name || entry.original_suggested_code_slug || '—'}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>






              {codeEditor.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
                  <div className="w-full max-w-2xl rounded-xl border bg-white shadow-xl">
                    <div className="border-b px-5 py-4">
                      <h3 className="text-sm font-semibold text-slate-900">{codeEditor.mode === 'create' ? 'Crear código' : 'Editar código'}</h3>
                      <p className="text-xs text-slate-500">Define nombre, jerarquía y metadatos semánticos.</p>
                    </div>
                    <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
                      <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Nombre del código" value={codeEditor.name} onChange={(e) => setCodeEditor((prev) => ({ ...prev, name: e.target.value }))} />
                      <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Color semántico (#HEX)" value={codeEditor.color} onChange={(e) => setCodeEditor((prev) => ({ ...prev, color: e.target.value }))} />
                      <select className="rounded-lg border px-3 py-2 text-sm" value={codeEditor.parent_slug} onChange={(e) => setCodeEditor((prev) => ({ ...prev, parent_slug: e.target.value }))}>
                        <option value="">Sin padre</option>
                        {codes.filter((code) => String(code.slug) !== String(codeEditor.targetSlug)).map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                      </select>
                      <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Tags (coma separada)" value={codeEditor.tags} onChange={(e) => setCodeEditor((prev) => ({ ...prev, tags: e.target.value }))} />
                      <div className="rounded-lg border px-3 py-2 text-sm">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>Consistencia semántica</span>
                          <span>{Number(codeEditor.score_consistencia || 0)}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={Number(codeEditor.score_consistencia || 0)} onChange={(e) => setCodeEditor((prev) => ({ ...prev, score_consistencia: Number(e.target.value) || 0 }))} className="w-full" />
                      </div>
                      <div className="rounded-lg border px-3 py-2 text-sm">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>Intensidad narrativa</span>
                          <span>{Number(codeEditor.score_intensidad || 0)}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={Number(codeEditor.score_intensidad || 0)} onChange={(e) => setCodeEditor((prev) => ({ ...prev, score_intensidad: Number(e.target.value) || 0 }))} className="w-full" />
                      </div>
                      <textarea className="md:col-span-2 h-28 rounded-lg border px-3 py-2 text-sm" placeholder="Descripción opcional" value={codeEditor.description} onChange={(e) => setCodeEditor((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                      <Button className="bg-white border text-slate-700" onClick={closeCodeEditor}>Cancelar</Button>
                      <Button className="bg-indigo-600 text-white" onClick={saveCodeEditor}>Guardar</Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {codeMapOpen ? (
                <div className="fixed inset-0 z-50 bg-slate-900/55 p-4">
                  <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Mapa de códigos</h3>
                        <p className="text-xs text-slate-500">Vista de grafo para jerarquía semántica del modo comentarios.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-600">Hipótesis</label>
                        <select className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={codeHypothesisFilter} onChange={(e) => setCodeHypothesisFilter(e.target.value)}>
                          <option value="">Todas</option>
                          {codeHypothesisOptions.map((hypothesisId) => <option key={hypothesisId} value={hypothesisId}>{hypothesisId}</option>)}
                        </select>
                        <label className="text-xs text-slate-600">Zoom</label>
                        <input type="range" min={0.6} max={1.8} step={0.1} value={codeMapZoom} onChange={(e) => setCodeMapZoom(Number(e.target.value) || 1)} />
                        <Button className="bg-white border text-slate-700" onClick={createCodeMapProfile}><PanelsTopLeft className="mr-1 h-4 w-4" />Crear Perfil</Button>
                        <Button className="bg-white border text-slate-700" onClick={() => { setCodeMapPan({ x: 0, y: 0 }); setCodeMapZoom(1); }}>Reset</Button>
                        <Button className="bg-white border text-slate-700" onClick={() => setCodeMapOpen(false)}>Cerrar</Button>
                      </div>
                    </div>

                    <div
                      ref={codeMapCanvasRef}
                      className={`relative h-full overflow-hidden bg-slate-50 ${isCodeMapPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                      onMouseDown={handleCodeMapCanvasMouseDown}
                    >
                      {codeMapConnectSource ? (
                        <div className="absolute left-3 top-3 z-20 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                          Conectando desde <b>{codes.find((item) => String(item.slug) === String(codeMapConnectSource))?.name || codeMapConnectSource}</b>. Haz clic en otro nodo para asignarlo como padre.
                        </div>
                      ) : null}

                      <div
                        className="absolute h-[2200px] w-[2400px] origin-top-left"
                        style={{ transform: `translate(${codeMapPan.x}px, ${codeMapPan.y}px) scale(${codeMapZoom})` }}
                      >
                        <svg className="absolute inset-0 h-full w-full">
                          {codeMapEdges.map((edge) => {
                            const source = codeMapRenderableNodesById.get(String(edge.source));
                            const target = codeMapRenderableNodesById.get(String(edge.target));
                            if (!source || !target) return null;
                            const selected = selectedCodeMapEdge === edge.id;
                            return (
                              <line
                                key={edge.id}
                                x1={source.x + 90}
                                y1={source.y + 26}
                                x2={target.x + 90}
                                y2={target.y + 26}
                                stroke={selected ? '#4f46e5' : edge.type === 'profile_link' ? '#0f766e' : '#9CA3AF'}
                                strokeWidth={selected ? 2 : 1.5}
                                className="cursor-pointer"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedCodeMapNode('');
                                  setSelectedCodeMapEdge(edge.id);
                                }}
                              />
                            );
                          })}
                        </svg>

                        {codeMapProfileNodes.map((profile) => {
                          const isCollapsed = Boolean(codeMapProfileCollapsed[String(profile.id)]);
                          return (
                            <div
                              key={profile.id}
                              data-code-map-profile="true"
                              data-code-map-profile-id={profile.id}
                              className="absolute min-w-[160px] rounded-lg border-2 border-teal-300 bg-teal-50/90 px-3 py-2 text-[12px] text-teal-900 shadow-sm"
                              style={{ left: profile.x, top: profile.y, width: '220px' }}
                              onMouseDown={(event) => handleCodeMapProfileMouseDown(event, profile.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (profileConnectSource) {
                                  assignCodeToProfile(profileConnectSource, profile.id);
                                  setProfileConnectSource('');
                                }
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const canvasRect = codeMapCanvasRef.current?.getBoundingClientRect();
                                const relativeX = canvasRect ? event.clientX - canvasRect.left : event.clientX;
                                const relativeY = canvasRect ? event.clientY - canvasRect.top : event.clientY;
                                setCodeMapProfileContextMenu({ open: true, x: relativeX, y: relativeY, profileId: profile.id });
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold">{profile.name}</p>
                                <button type="button" className="rounded border border-teal-300 bg-white px-1.5 text-[10px]" onClick={(event) => { event.stopPropagation(); toggleCodeMapProfileCollapsed(profile.id); }}>{isCollapsed ? 'Expandir' : 'Colapsar'}</button>
                              </div>
                              <p className="mt-1 text-[11px] text-teal-800">{profile.description || 'Perfil estratégico para agrupar códigos visualmente.'}</p>
                            </div>
                          );
                        })}

                        {visibleCodeMapNodes.map((code) => {
                          const isNodeSelected = selectedCodeMapNode === code.slug;
                          const nodeWidth = Math.max(100, Math.min(220, 100 + (Number(code.scoreTotal || 0) * 1.1)));
                          return (
                            <div
                              key={code.slug}
                              data-code-map-node="true"
                              className={`absolute min-w-[90px] rounded-md border bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:border-indigo-500 hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] ${draggingCodeMapNode === code.slug || isNodeSelected ? 'border-2 border-indigo-500' : 'border-[#D0D5DD]'}`}
                              style={{ left: code.x, top: code.y, width: `${nodeWidth}px`, maxWidth: `${nodeWidth}px` }}
                              onMouseDown={(event) => handleCodeMapNodeMouseDown(event, code.slug)}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (codeMapConnectSource && codeMapConnectSource !== code.slug) {
                                  connectCodeFromSource(code.slug);
                                  return;
                                }
                                setSelectedCodeMapEdge('');
                                setSelectedCodeMapNode(code.slug);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedCodeMapNode(code.slug);
                                const canvasRect = codeMapCanvasRef.current?.getBoundingClientRect();
                                if (!canvasRect) {
                                  setCodeMapContextMenu({ open: true, x: event.clientX, y: event.clientY, slug: code.slug });
                                  return;
                                }
                                const menuWidth = 220;
                                const menuHeight = 220;
                                const relativeX = event.clientX - canvasRect.left;
                                const relativeY = event.clientY - canvasRect.top;
                                const clampedX = Math.max(8, Math.min(relativeX, canvasRect.width - menuWidth - 8));
                                const clampedY = Math.max(8, Math.min(relativeY, canvasRect.height - menuHeight - 8));
                                setCodeMapContextMenu({ open: true, x: clampedX, y: clampedY, slug: code.slug });
                              }}
                            >
                              <p className="whitespace-normal break-words leading-tight">{code.name}</p>
                              <p className="text-[10px] font-normal text-slate-500">({code.fragmentCount}) · {code.scoreTotal}/100</p>
                            </div>
                          );
                        })}
                      </div>

                      {codeMapProfileContextMenu.open ? (
                        <div
                          style={{ left: codeMapProfileContextMenu.x, top: codeMapProfileContextMenu.y }}
                          className="absolute z-30 min-w-[220px] rounded-md border border-teal-200 bg-white p-1 shadow-lg"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            const target = codeMapProfileNodes.find((item) => String(item.id) === String(codeMapProfileContextMenu.profileId));
                            setCodeMapProfileEditor({
                              open: true,
                              mode: 'edit',
                              id: String(target?.id || ''),
                              name: String(target?.name || ''),
                              description: String(target?.description || ''),
                            });
                            setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
                          }}>Editar perfil</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            toggleCodeMapProfileCollapsed(codeMapProfileContextMenu.profileId);
                            setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
                          }}>{codeMapProfileCollapsed[String(codeMapProfileContextMenu.profileId)] ? 'Expandir códigos' : 'Colapsar códigos'}</button>
                          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            const targetProfileId = codeMapProfileContextMenu.profileId;
                            setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
                            openProfileMapAiAnalysis(targetProfileId);
                          }}>
                            <BrainCircuit size={14} />
                            Análisis IA
                          </button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50" onClick={() => {
                            removeCodeMapProfile(codeMapProfileContextMenu.profileId);
                            setCodeMapProfileContextMenu({ open: false, x: 0, y: 0, profileId: '' });
                          }}>Eliminar perfil</button>
                        </div>
                      ) : null}

                      {codeMapContextMenu.open ? (
                        <div
                          style={{ left: codeMapContextMenu.x, top: codeMapContextMenu.y }}
                          className="absolute z-30 min-w-[210px] rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            const target = codes.find((item) => String(item.slug) === String(codeMapContextMenu.slug));
                            if (target) openCodeEditor('edit', target);
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Editar código</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            openCodeEditor('create', null, codeMapContextMenu.slug);
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Crear subcódigo</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            setCodeMapConnectSource(codeMapContextMenu.slug);
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Conectar con otro código</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            setCodeParent(codeMapContextMenu.slug, '');
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Quitar padre</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            setProfileConnectSource(codeMapContextMenu.slug);
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Conectar con perfil</button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            assignCodeToProfile(codeMapContextMenu.slug, '');
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Desvincular de perfil</button>
                          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => {
                            const targetSlug = codeMapContextMenu.slug;
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                            openCodeMapAiAnalysis(targetSlug);
                          }}>
                            <BrainCircuit size={14} />
                            Análisis IA
                          </button>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50" onClick={() => {
                            if (!window.confirm('¿Eliminar este código y su jerarquía?')) return;
                            deleteCodeTree(codeMapContextMenu.slug);
                            setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
                          }}>Eliminar código</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {codeMapProfileEditor.open ? (
                <div className="fixed inset-0 z-[72] flex items-center justify-center bg-slate-900/45 p-4">
                  <div className="w-full max-w-lg rounded-xl border bg-white shadow-2xl">
                    <div className="border-b px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">{codeMapProfileEditor.mode === 'create' ? 'Crear Perfil' : 'Editar Perfil'}</h3>
                      <p className="text-xs text-slate-500">Entidad visual estratégica para agrupar códigos sin afectar su semántica.</p>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nombre del perfil" value={codeMapProfileEditor.name} onChange={(event) => setCodeMapProfileEditor((prev) => ({ ...prev, name: event.target.value }))} />
                      <textarea className="h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Descripción breve (opcional)" value={codeMapProfileEditor.description} onChange={(event) => setCodeMapProfileEditor((prev) => ({ ...prev, description: event.target.value }))} />
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                      <Button className="bg-white border text-slate-700" onClick={() => setCodeMapProfileEditor({ open: false, mode: 'create', id: '', name: '', description: '' })}>Cancelar</Button>
                      <Button className="bg-teal-600 text-white" onClick={saveCodeMapProfileEditor}>Guardar Perfil</Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {codeMapAiModal.open ? (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
                  <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                    <div className="flex items-start justify-between gap-3 border-b bg-gradient-to-r from-slate-900 to-indigo-900 px-5 py-4 text-white">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-200">Chat analítico por código</p>
                        <h3 className="text-lg font-semibold">{codeMapAiModal.title || 'Análisis IA'}</h3>
                        <p className="text-xs text-indigo-100">Memoria persistente: informe base + agentes + conversación especializada del código.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          className="border border-indigo-200/70 bg-indigo-500/20 text-white hover:bg-indigo-500/30"
                          onClick={refreshCodeMapAiChat}
                          disabled={codeMapAiModal.loading || codeMapAiModal.sending}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" /> Refresh
                        </Button>
                        <Button className="border border-white/40 bg-white/10 text-white hover:bg-white/20" onClick={closeCodeMapAiModal}>Cerrar</Button>
                      </div>
                    </div>
                    <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
                      <aside className="overflow-y-auto border-r bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Informe base (bandera principal)</p>
                        <p className="mt-2 text-sm text-slate-700">{codeMapAiModal.result?.summary_absolute || 'Sin informe inicial todavía.'}</p>
                        <div className="mt-3 space-y-2">
                          {[
                            ['Dolores', codeMapAiModal.result?.dolores],
                            ['Deseos', codeMapAiModal.result?.deseos],
                            ['Placeres', codeMapAiModal.result?.placeres],
                            ['Problemas', codeMapAiModal.result?.problemas],
                            ['Soluciones', codeMapAiModal.result?.soluciones],
                          ].map(([title, section]) => (
                            <div key={title} className="rounded-lg border border-slate-200 bg-white p-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
                              <p className="mt-1 line-clamp-3 text-xs text-slate-700">{section?.analysis || 'Sin sección.'}</p>
                            </div>
                          ))}
                        </div>
                        {codeMapAiModal.loading ? (
                          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                            <p className="text-sm font-medium text-indigo-900">Generando memoria base multiagente…</p>
                            <p className="mt-1 text-xs text-indigo-700">Dolores → Deseos → Placeres → Problemas → Soluciones → Refinador → Optimizador final.</p>
                          </div>
                        ) : null}
                      </aside>

                      <div className="flex min-h-0 flex-col">
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-5 py-4">
                          {codeMapAiModal.error ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{codeMapAiModal.error}</div>
                          ) : null}
                          {(codeMapAnalysisSessions[buildCodeMapAnalysisSessionKey(codeMapAiModal.targetType, codeMapAiModal.targetId)]?.conversation_history || []).map((message) => (
                            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.role === 'user' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-slate-50 text-slate-800'}`}>
                                <p className="whitespace-pre-wrap">{message.content}</p>
                                {Array.isArray(message.citations) && message.citations.length ? (
                                  <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
                                    {message.citations.map((citation, idx) => (
                                      <p key={`${message.id}_cite_${idx}`}>[{citation.fragment_id || 'fragmento'}] {citation.excerpt || 'Sin extracto'}</p>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          {codeMapAiModal.sending ? <p className="text-xs text-slate-500">Analizando con memoria del código…</p> : null}
                        </div>
                        <div className="border-t bg-white px-5 py-3">
                          <div className="flex items-end gap-2">
                            <textarea
                              className="h-20 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                              placeholder={codeMapAiModal.targetType === 'profile' ? 'Pregunta sobre este perfil. El chat mantiene memoria del informe base, jerarquía y evidencia conjunta del perfil.' : 'Pregunta sobre este código. El chat mantiene memoria del informe base y evidencia del código.'}
                              value={codeMapAiInput}
                              onChange={(event) => setCodeMapAiInput(event.target.value)}
                            />
                            <Button className="bg-indigo-600 text-white" onClick={sendCodeMapAiMessage} disabled={codeMapAiModal.loading || codeMapAiModal.sending || !String(codeMapAiInput || '').trim()}>
                              {codeMapAiModal.sending ? 'Enviando…' : 'Enviar'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}



          {workspaceModalOpen ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4">
              <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Workspaces de campaña</h3>
                    <p className="text-xs text-slate-500">Selecciona un workspace o crea uno nuevo. Máximo {WORKSPACE_ACTIVE_LIMIT} activos.</p>
                  </div>
                  <Button className="bg-white border" onClick={() => setWorkspaceEditor({ open: true, mode: 'create', id: '', name: '', description: '', status: 'active' })}>Nuevo workspace</Button>
                </div>
                <div className="max-h-[60vh] overflow-auto p-4">
                  {workspaceError ? <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{workspaceError}</p> : null}
                  {workspaceBusy ? <p className="text-sm text-slate-600">Cargando workspaces...</p> : null}
                  <div className="space-y-2">
                    {workspaces.length === 0 ? <p className="text-sm text-slate-500">No hay workspaces todavía para esta campaña.</p> : workspaces.map((workspace) => (
                      <div key={workspace.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{workspace.name}</p>
                          <p className="text-xs text-slate-500">{workspace.description || 'Sin descripción'}</p>
                          <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] ${workspace.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{workspace.status === 'active' ? 'Activo' : 'Inactivo'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button className="bg-white border" onClick={() => setWorkspaceEditor({ open: true, mode: 'edit', id: workspace.id, name: workspace.name, description: workspace.description, status: workspace.status })}>Editar</Button>
                          <Button className="bg-indigo-600 text-white" disabled={workspace.status !== 'active'} onClick={() => selectWorkspace(workspace.id)}>Entrar</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {workspaceEditor.open ? (
            <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/50 p-4">
              <div className="w-full max-w-lg rounded-xl border bg-white shadow-xl">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">{workspaceEditor.mode === 'create' ? 'Crear Workspace' : 'Editar Workspace'}</h3>
                </div>
                <div className="space-y-3 px-4 py-4">
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nombre" value={workspaceEditor.name} onChange={(event) => setWorkspaceEditor((prev) => ({ ...prev, name: event.target.value }))} />
                  <textarea className="h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Descripción" value={workspaceEditor.description} onChange={(event) => setWorkspaceEditor((prev) => ({ ...prev, description: event.target.value }))} />
                  <select className="w-full rounded-lg border px-3 py-2 text-sm" value={workspaceEditor.status} onChange={(event) => setWorkspaceEditor((prev) => ({ ...prev, status: event.target.value }))}>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
                <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                  <Button className="bg-white border" onClick={() => setWorkspaceEditor({ open: false, mode: 'create', id: '', name: '', description: '', status: 'active' })}>Cancelar</Button>
                  <Button className="bg-indigo-600 text-white" onClick={saveWorkspaceEditor} disabled={workspaceBusy}>Guardar</Button>
                </div>
              </div>
            </div>
          ) : null}




          {codeGenerationModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-xl bg-white shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Generación automática de códigos (sin trazabilidad inicial)</h3>
                    <p className="text-xs text-slate-500">Comentarios → Clusterización → Subclusterización → Propuesta de códigos.</p>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <Button className="bg-white border text-rose-700" onClick={() => setCodeGenerationDeleteMenuOpen((prev) => !prev)}>Eliminar</Button>
                    {codeGenerationDeleteMenuOpen ? (
                      <div className="absolute right-0 top-11 z-20 w-52 rounded-lg border bg-white p-1.5 shadow-lg">
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
                          onClick={() => {
                            setGeneratedCodeProposals([]);
                            setCodeGenerationDeleteMenuOpen(false);
                          }}
                        >
                          Eliminar todo
                        </button>
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                          onClick={() => {
                            setCodeGenerationDeleteMode('single');
                            setCodeGenerationDeleteMenuOpen(false);
                          }}
                        >
                          Eliminar uno a uno
                        </button>
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100"
                          onClick={() => {
                            setCodeGenerationDeleteMode('none');
                            setCodeGenerationDeleteMenuOpen(false);
                          }}
                        >
                          Salir modo eliminar
                        </button>
                      </div>
                    ) : null}
                    <Button className="bg-white border text-slate-700" onClick={() => setCodeGenerationModalOpen(false)}>Cerrar</Button>
                  </div>
                </div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded border bg-slate-50 px-3 py-2 text-xs">1) Clusterización comentarios</div>
                    <div className="rounded border bg-slate-50 px-3 py-2 text-xs">2) Subclusterización patrones</div>
                    <div className="rounded border bg-slate-50 px-3 py-2 text-xs">3) Propuesta de códigos/subcódigos</div>
                  </div>
                  {codeGenerationBusy ? <p className="text-sm text-slate-600">Generando propuesta conceptual...</p> : null}
                  {codeGenerationError ? <p className="text-sm text-rose-600">{codeGenerationError}</p> : null}
                  {codeGenerationMetrics ? (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-indigo-900">
                        <p className="font-medium">Total comentarios procesados</p>
                        <p>{codeGenerationProgress.analyzedComments} / {codeGenerationProgress.totalComments}</p>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 transition-all duration-500"
                          style={{ width: `${codeGenerationProgress.pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-indigo-800/80">
                        <span>Progreso real del análisis de comentarios</span>
                        <span>{codeGenerationProgress.pct}%</span>
                      </div>

                      <p className="text-xs text-slate-600">
                        Total base: {Number(codeGenerationMetrics.comments_total_from_table || 0)} · Enviados a generación: {codeGenerationProgress.fetchedComments} · Analizados por IA: {codeGenerationProgress.analyzedComments} · Clusters: {Number(codeGenerationMetrics.clusters_count || 0)} · Top-level: {Number(codeGenerationMetrics.top_level_clusters_count || 0)}
                      </p>
                    </div>
                  ) : null}
                  {codeGenerationDeleteMode === 'single' ? (
                    <p className="text-xs text-rose-700">Modo eliminación uno a uno activo.</p>
                  ) : null}

                  <div className="space-y-2">
                    {!generatedCodeProposals.length ? (
                      !codeGenerationBusy ? <p className="text-sm text-slate-500">Aún no hay propuestas generadas.</p> : null
                    ) : generatedCodeProposals.map((proposal) => (
                      <div key={proposal.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{proposal.suggested_code_name}</p>
                            <p className="text-xs text-slate-500">Cluster: {proposal.cluster_name} · Confianza IA: {Math.round(Number(proposal.confidence || 0) * 100)}%</p>
                          </div>
                          <span className="rounded border bg-white px-2 py-0.5 text-xs">Sin trazabilidad inicial</span>
                        </div>
                        <p className="text-xs text-slate-700">{proposal.description}</p>
                        <p className="text-xs text-slate-500">Tamaño estimado: {proposal.size_estimate}</p>
                        {(proposal.subclusters || []).length ? (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-slate-700">Subcódigos sugeridos</p>
                            <div className="space-y-1">
                              {proposal.subclusters.map((sub, idx) => (
                                <p key={`${proposal.id}_sub_${idx}`} className="rounded border bg-white px-2 py-1 text-xs text-slate-700">
                                  {sub.suggested_subcode_name || sub.cluster_name} · conf. {Math.round(Number(sub.confidence || 0) * 100)}%
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <Button className="bg-indigo-600 text-white" onClick={() => createCodeFromGeneratedProposal(proposal)}>Crear en codebook</Button>
                          {codeGenerationDeleteMode === 'single' ? (
                            <Button className="bg-white border text-rose-700" onClick={() => setGeneratedCodeProposals((prev) => prev.filter((item) => String(item.id) !== String(proposal.id)))}>Eliminar</Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {semanticClusterModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-xl bg-white shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Modal · Propuestas de codificación asistida por clusters</h3>
                    <p className="text-xs text-slate-500">IA propone estructuras semánticas; la decisión final siempre es humana.</p>
                  </div>
                  <Button className="bg-white border text-slate-700" onClick={() => setSemanticClusterModalOpen(false)}>Cerrar</Button>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {semanticClusterCards.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay clusters pendientes de decisión.</p>
                  ) : semanticClusterCards.map((cluster) => {
                    const draft = getClusterDraft(cluster.id);
                    return (
                      <div key={cluster.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{cluster.suggested_pattern_name}</p>
                            <p className="text-xs text-slate-500">Tipo: {cluster.suggested_code_type} · Decisión IA: {cluster.suggested_decision}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="rounded bg-white px-2 py-0.5 text-xs border">conf. {Math.round(Number(cluster.confidence || 0) * 100)}%</span>
                            <span className="rounded bg-white px-2 py-0.5 text-xs border">{cluster.cluster_state}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div className="rounded border bg-white px-2 py-1">Tamaño: {cluster.size}</div>
                          <div className="rounded border bg-white px-2 py-1">Coherencia: {cluster.coherence}</div>
                          <div className="rounded border bg-white px-2 py-1">Profundidad: {cluster.depth}</div>
                          <div className="rounded border bg-white px-2 py-1">Dispersión: {cluster.source_dispersion}</div>
                          <div className="rounded border bg-white px-2 py-1">Calidad: {cluster.quality_score}</div>
                          <div className="rounded border bg-white px-2 py-1">Separación: {cluster.separation}</div>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-slate-700">Fragmentos representativos</p>
                          <div className="space-y-1">
                            {cluster.representative_fragments.slice(0, 3).map((item) => (
                              <p key={String(item.fragment_id)} className="rounded border bg-white px-2 py-1 text-xs text-slate-700">{item.excerpt}</p>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <input className="rounded border px-2 py-1 text-xs" placeholder="Editar nombre sugerido" value={draft.editedName} onChange={(e) => updateClusterDraft(cluster.id, { editedName: e.target.value })} />
                          <input className="rounded border px-2 py-1 text-xs" placeholder="Tipo conceptual" value={draft.conceptualType} onChange={(e) => updateClusterDraft(cluster.id, { conceptualType: e.target.value })} />
                        </div>
                        <select className="w-full rounded border px-2 py-1 text-xs" value={draft.targetCodeSlug} onChange={(e) => updateClusterDraft(cluster.id, { targetCodeSlug: e.target.value })}>
                          <option value="">Seleccionar código existente (reutilizar)</option>
                          {codes.map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                        </select>
                        <div className="flex flex-wrap gap-1">
                          <Button className="bg-indigo-600 text-white" onClick={() => applyClusterDecision(cluster, 'crear')}>Crear código</Button>
                          <Button className="bg-white border text-slate-700" onClick={() => applyClusterDecision(cluster, 'reutilizar')}>Reutilizar</Button>
                          <Button className="bg-white border text-slate-700" onClick={() => applyClusterDecision(cluster, 'dividir')}>Dividir</Button>
                          <Button className="bg-white border text-slate-700" onClick={() => applyClusterDecision(cluster, 'fusionar')}>Fusionar</Button>
                          <Button className="bg-white border text-slate-700" onClick={() => applyClusterDecision(cluster, 'ignorar')}>Ignorar</Button>
                          <Button className="bg-white border text-slate-700" onClick={() => applyClusterDecision(cluster, 'posponer')}>Posponer</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}


          {tab === 'hypotheses' && (
            <div className="rounded-xl border bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Hipótesis</h2>
                  <p className="text-xs text-slate-500">Entidad conceptual del Modo Comentarios estructurada únicamente por perfiles vinculados.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input className="w-64 rounded-lg border bg-white py-2 pl-9 pr-3 text-sm" placeholder="Buscar hipótesis" value={hypothesisQuery} onChange={(e) => setHypothesisQuery(e.target.value)} />
                  </label>
                  <Button className="bg-white border text-slate-700" onClick={() => setHypothesisMapOpen(true)}>
                    <Network className="mr-1 h-4 w-4" /> Mapa de hipótesis
                  </Button>
                  <Button className="bg-indigo-600 text-white" onClick={() => openHypothesisEditor(null)}>
                    <Plus className="mr-1 h-4 w-4" /> Crear hipótesis
                  </Button>
                </div>
              </div>

              {!filteredHypotheses.length ? <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-slate-500">No hay hipótesis creadas.</p> : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredHypotheses.map((hypothesis) => {
                    const linkedProfileIds = Array.isArray(hypothesis.linked_profile_ids) ? hypothesis.linked_profile_ids : [];
                    const linkedProfiles = linkedProfileIds
                      .map((profileId) => profileById.get(String(profileId)))
                      .filter(Boolean);
                    const validationStatus = normalizeCommentHypothesisValidationStatus(hypothesis.validation_status);
                    const parentHypothesis = hypothesisById.get(String(hypothesis.parent_hypothesis_id || '')) || null;
                    const childHypotheses = childHypothesesByParentId.get(String(hypothesis.id)) || [];
                    const evolutions = evolutionLinksBySourceId.get(String(hypothesis.id)) || [];
                    return (
                      <article key={hypothesis.id} className={`relative rounded-xl border bg-white p-4 shadow-sm ${validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-900">{hypothesis.title}</h3>
                            <p className="mt-1 line-clamp-3 text-sm text-slate-600">{hypothesis.description}</p>
                          </div>
                          <div className="relative">
                            <button type="button" className="rounded-md border bg-white p-1.5 text-slate-500 hover:text-slate-800" onClick={() => setHypothesisMenuId((prev) => (prev === String(hypothesis.id) ? '' : String(hypothesis.id)))}>
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {hypothesisMenuId === String(hypothesis.id) ? (
                              <div className="absolute right-0 top-9 z-40 w-44 rounded-lg border bg-white p-1.5 shadow-lg">
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openHypothesisEditor(hypothesis)}>Editar</button>
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-emerald-700 hover:bg-emerald-50" onClick={() => updateHypothesisValidationStatus(hypothesis.id, COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID)}>Marcar validada</button>
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => updateHypothesisValidationStatus(hypothesis.id, COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID)}>Invalidar rama</button>
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openHypothesisEvolutionModal(hypothesis)}>Evolucionar hipótesis</button>
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openHypothesisEvolutionDeleteModal(hypothesis)} disabled={!evolutions.length}>Eliminar evoluciones</button>
                                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => deleteHypothesis(hypothesis.id)}>Eliminar</button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {hypothesis.context_note ? <p className="mt-2 rounded border bg-slate-50 px-2 py-1 text-xs text-slate-600">{hypothesis.context_note}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">Tipo: {commentHypothesisTypeLabel(hypothesis.type)}</span>
                          <span className={`rounded-full border px-2 py-1 ${commentHypothesisValidationStatusClasses(validationStatus)}`}>Estado: {commentHypothesisValidationStatusLabel(validationStatus)}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Padre: {parentHypothesis ? parentHypothesis.title : 'Sin padre'}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Hijas: {childHypotheses.length}</span>
                          <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-teal-700">Perfiles: {linkedProfiles.length}</span>
                        </div>
                        <div className="mt-3 space-y-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                            <p><span className="font-semibold text-slate-700">Padre jerárquico:</span> {parentHypothesis ? `${parentHypothesis.title} · ${commentHypothesisTypeLabel(parentHypothesis.type)}` : 'Sin padre asignado'}</p>
                            <p className="mt-1"><span className="font-semibold text-slate-700">Estado de validación:</span> {commentHypothesisValidationStatusLabel(validationStatus)}</p>
                            <p className="mt-1"><span className="font-semibold text-slate-700">Capa hija permitida:</span> {COMMENT_HYPOTHESIS_CHILD_TYPE_BY_PARENT[normalizeCommentHypothesisType(hypothesis.type)] ? commentHypothesisTypeLabel(COMMENT_HYPOTHESIS_CHILD_TYPE_BY_PARENT[normalizeCommentHypothesisType(hypothesis.type)]) : 'No admite hijas'}</p>
                            <p className="mt-1"><span className="font-semibold text-slate-700">Hipótesis hijas:</span> {childHypotheses.length ? childHypotheses.map((child) => child.title).join(' · ') : 'Sin hijas'}</p>
                            {validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID && childHypotheses.length ? <p className="mt-1 text-rose-600">La rama descendente de esta hipótesis también queda invalidada automáticamente.</p> : null}
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Perfiles vinculados</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {!linkedProfiles.length ? <span className="text-xs text-slate-400">Sin perfiles vinculados</span> : linkedProfiles.slice(0, 6).map((profile) => (
                                <span key={`${hypothesis.id}_${profile.id}`} className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
                                  {profile.name}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Genealogía de evolución</p>
                              <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] text-indigo-700">{evolutions.length} evoluciones</span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {!evolutions.length ? <p className="text-xs text-indigo-700/70">Aún no se evolucionó esta hipótesis hacia otros modos.</p> : evolutions.slice(0, 3).map((evolution) => (
                                <button
                                  key={evolution.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg border border-indigo-100 bg-white px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-indigo-50"
                                  onClick={() => navigate(evolution.destination_route || (evolution.destination_mode === 'interviews' ? `/projects/${projectId}/campaigns/${campaignId}/interviews` : `/projects/${projectId}/campaigns/${campaignId}/hypotheses/${evolution.destination_hypothesis_id}`))}
                                >
                                  <span>
                                    <span className="block font-medium text-slate-800">{evolution.destination_mode === 'interviews' ? 'Modo Entrevistas' : 'Modo Video'}</span>
                                    <span className="block text-[11px] text-slate-500">{evolution.destination_hypothesis_title || evolution.destination_hypothesis_id || 'Hipótesis derivada'}</span>
                                  </span>
                                  <span className="text-[11px] text-slate-400">{new Date(evolution.evolved_at).toLocaleDateString()}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}



          {hypothesisMapOpen ? (
            <div className="fixed inset-0 z-50 bg-slate-900/55 p-4">
              <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Mapa de hipótesis</h3>
                    <p className="text-xs text-slate-500">Vista de grafo para jerarquía de hipótesis del modo comentarios.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-600">Hipótesis</label>
                    <select
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                      value={hypothesisMapFilter}
                      onChange={(e) => setHypothesisMapFilter(e.target.value)}
                    >
                      <option value="">Todas</option>
                      {hypothesisMapProblemFilterOptions.map((h) => (
                        <option key={h.id} value={h.id}>{h.title || h.id}</option>
                      ))}
                    </select>
                    <label className="text-xs text-slate-600">Zoom</label>
                    <input
                      type="range"
                      min={0.4}
                      max={2}
                      step={0.1}
                      value={hypothesisMapZoom}
                      onChange={(e) => setHypothesisMapZoom(Number(e.target.value) || 1)}
                    />
                    <Button
                      className="bg-white border text-slate-700"
                      onClick={() => { setHypothesisMapPan({ x: 0, y: 0 }); setHypothesisMapZoom(1); }}
                    >
                      Reset
                    </Button>
                    <Button
                      className="bg-white border text-slate-700"
                      onClick={() => setHypothesisMapOpen(false)}
                    >
                      Cerrar
                    </Button>
                  </div>
                </div>

                <div
                  ref={hypothesisMapCanvasRef}
                  className={`relative h-full overflow-hidden bg-slate-50 ${isHypothesisMapPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onMouseDown={handleHypothesisMapCanvasMouseDown}
                >
                  <div
                    className="absolute h-[2200px] w-[2400px] origin-top-left"
                    style={{ transform: `translate(${hypothesisMapPan.x}px, ${hypothesisMapPan.y}px) scale(${hypothesisMapZoom})` }}
                  >
                    <svg className="absolute inset-0 h-full w-full">
                      {hypothesisMapEdges.map((edge) => {
                        const source = hypothesisMapRenderableNodesById.get(String(edge.source));
                        const target = hypothesisMapRenderableNodesById.get(String(edge.target));
                        if (!source || !target) return null;
                        const selected = selectedHypothesisMapEdge === edge.id;
                        return (
                          <line
                            key={edge.id}
                            x1={source.x + 100}
                            y1={source.y + 28}
                            x2={target.x + 100}
                            y2={target.y + 28}
                            stroke={selected ? '#4f46e5' : '#9CA3AF'}
                            strokeWidth={selected ? 2 : 1.5}
                            className="cursor-pointer"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedHypothesisMapNode('');
                              setSelectedHypothesisMapEdge(edge.id);
                            }}
                          />
                        );
                      })}
                    </svg>

                    {hypothesisMapNodes.map((hypothesis) => {
                      const isSelected = selectedHypothesisMapNode === hypothesis.id;
                      const type = normalizeCommentHypothesisType(hypothesis.type);
                      const validationStatus = normalizeCommentHypothesisValidationStatus(hypothesis.validation_status);
                      const typeColors = {
                        problema: { bg: '#fef2f2', border: '#fca5a5', badge: '#991b1b', badgeBg: '#fee2e2' },
                        segmento: { bg: '#eff6ff', border: '#93c5fd', badge: '#1d4ed8', badgeBg: '#dbeafe' },
                        mensajes: { bg: '#f0fdf4', border: '#86efac', badge: '#166534', badgeBg: '#dcfce7' },
                        solucion: { bg: '#fefce8', border: '#fde047', badge: '#854d0e', badgeBg: '#fef9c3' },
                        producto: { bg: '#fdf4ff', border: '#d8b4fe', badge: '#6b21a8', badgeBg: '#f3e8ff' },
                      };
                      const colors = typeColors[type] || { bg: '#f8fafc', border: '#cbd5e1', badge: '#475569', badgeBg: '#f1f5f9' };
                      const parentHypothesis = hypothesisById.get(String(hypothesis.parent_hypothesis_id || '')) || null;
                      const childHypothesesForNode = childHypothesesByParentId.get(String(hypothesis.id)) || [];
                      return (
                        <div
                          key={hypothesis.id}
                          data-hypothesis-map-node="true"
                          className={`absolute rounded-md border bg-white px-2.5 py-2 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] ${draggingHypothesisMapNode === hypothesis.id || isSelected ? 'border-2 border-indigo-500' : ''}`}
                          style={{
                            left: hypothesis.x,
                            top: hypothesis.y,
                            width: '200px',
                            maxWidth: '200px',
                            borderColor: isSelected ? '#4f46e5' : colors.border,
                            backgroundColor: colors.bg,
                          }}
                          onMouseDown={(event) => handleHypothesisMapNodeMouseDown(event, hypothesis.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedHypothesisMapEdge('');
                            setSelectedHypothesisMapNode(hypothesis.id);
                          }}
                        >
                          <p className="whitespace-normal break-words leading-tight text-slate-900">{hypothesis.title || 'Sin título'}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{ color: colors.badge, backgroundColor: colors.badgeBg }}
                            >
                              {commentHypothesisTypeLabel(hypothesis.type)}
                            </span>
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID ? '#be123c' : validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID ? '#047857' : '#b45309',
                                backgroundColor: validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.INVALID ? '#ffe4e6' : validationStatus === COMMENT_HYPOTHESIS_VALIDATION_STATUS.VALID ? '#d1fae5' : '#fef3c7',
                              }}
                            >
                              {commentHypothesisValidationStatusLabel(validationStatus)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {childHypothesesForNode.length > 0 ? `${childHypothesesForNode.length} hija${childHypothesesForNode.length !== 1 ? 's' : ''}` : parentHypothesis ? 'hoja' : 'raíz'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {!hypothesisMapNodes.length ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="rounded-lg border border-dashed bg-white px-6 py-4 text-sm text-slate-500">
                        {hypotheses.length ? 'No hay hipótesis para los filtros aplicados.' : 'No hay hipótesis en este workspace todavía.'}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {hypothesisEvolutionDeleteModal.open ? (
            <div className="fixed inset-0 z-[73] overflow-y-auto bg-slate-950/55 p-4">
              <div className="mx-auto my-10 w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#fff7ed_50%,#fef2f2_100%)] px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-600">Eliminar evoluciones</p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-900">Eliminar una evolución desde Modo Comentarios</h3>
                      <p className="mt-2 text-sm text-slate-600">Selecciona cuál evolución borrar y decide si quieres eliminar solo esa hipótesis destino o toda su rama derivada en el modo destino.</p>
                    </div>
                    <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-500 hover:text-slate-900" onClick={closeHypothesisEvolutionDeleteModal}>✕</button>
                  </div>
                </div>

                <div className="space-y-5 p-6">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hipótesis origen</p>
                    <h4 className="mt-1 text-base font-semibold text-slate-900">{activeEvolutionDeletionSourceHypothesis?.title || 'Hipótesis comentarios'}</h4>
                    <p className="mt-1 text-sm text-slate-600">{activeEvolutionDeletionSourceHypothesis?.description || 'Sin descripción conceptual.'}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evoluciones disponibles</p>
                    <div className="mt-2 space-y-2">
                      {activeSourceEvolutionOptions.map((evolution) => {
                        const checked = String(hypothesisEvolutionDeleteModal.selectedEvolutionId) === String(evolution.id);
                        return (
                          <label key={evolution.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${checked ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                            <input
                              type="radio"
                              name="selected-evolution"
                              checked={checked}
                              onChange={() => setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, selectedEvolutionId: String(evolution.id), error: '' }))}
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-900">{evolution.destination_mode === 'interviews' ? 'Modo Entrevistas' : 'Modo Video'}</span>
                              <span className="mt-0.5 block text-slate-600">{evolution.destination_hypothesis_title || evolution.destination_hypothesis_id || 'Hipótesis destino'}</span>
                              <span className="mt-1 block text-xs text-slate-500">{new Date(evolution.evolved_at).toLocaleString()}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modo de eliminación</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <button
                        type="button"
                        className={`rounded-2xl border px-4 py-3 text-left transition ${hypothesisEvolutionDeleteModal.deleteMode === 'branch' ? 'border-rose-400 bg-rose-600 text-white shadow-lg shadow-rose-200' : 'border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50'}`}
                        onClick={() => setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, deleteMode: 'branch', error: '' }))}
                      >
                        <span className="block text-sm font-semibold">Eliminar evolución de rama completa</span>
                        <span className={`mt-1 block text-xs ${hypothesisEvolutionDeleteModal.deleteMode === 'branch' ? 'text-rose-100' : 'text-slate-500'}`}>Elimina la hipótesis destino seleccionada y todas sus hijas en el modo destino.</span>
                      </button>
                      <button
                        type="button"
                        className={`rounded-2xl border px-4 py-3 text-left transition ${hypothesisEvolutionDeleteModal.deleteMode === 'single' ? 'border-amber-400 bg-amber-500 text-white shadow-lg shadow-amber-200' : 'border-slate-200 bg-white text-slate-700 hover:border-amber-200 hover:bg-amber-50'}`}
                        onClick={() => setHypothesisEvolutionDeleteModal((prev) => ({ ...prev, deleteMode: 'single', error: '' }))}
                      >
                        <span className="block text-sm font-semibold">Eliminar evolución de esta hipótesis</span>
                        <span className={`mt-1 block text-xs ${hypothesisEvolutionDeleteModal.deleteMode === 'single' ? 'text-amber-100' : 'text-slate-500'}`}>Elimina solo la hipótesis destino elegida y desacopla sus hijas directas para no romper la jerarquía restante.</span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p><span className="font-semibold text-slate-900">La hipótesis origen queda intacta.</span></p>
                    <p className="mt-1">Se eliminará el vínculo activo de evolución y no se borrarán perfiles, códigos ni fragmentos del origen.</p>
                  </div>

                  {hypothesisEvolutionDeleteModal.error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{hypothesisEvolutionDeleteModal.error}</div> : null}
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
                  <div className="text-xs text-slate-500">La eliminación se ejecuta desde la hipótesis de Comentarios para mantener el control del origen conceptual.</div>
                  <div className="flex items-center gap-2">
                    <Button className="bg-white border text-slate-700" onClick={closeHypothesisEvolutionDeleteModal}>Cancelar</Button>
                    <Button className="bg-rose-600 text-white" onClick={saveHypothesisEvolutionDeletion} disabled={hypothesisEvolutionDeleteModal.deleting || !hypothesisEvolutionDeleteModal.selectedEvolutionId}>
                      {hypothesisEvolutionDeleteModal.deleting ? 'Eliminando…' : 'Eliminar evolución'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {hypothesisEvolutionModal.open ? (
            <div className="fixed inset-0 z-[72] overflow-y-auto bg-slate-950/55 p-4">
              <div className="mx-auto my-6 w-full max-w-4xl rounded-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#eef2ff_0%,#f8fafc_55%,#ecfeff_100%)] px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-600">Evolución de hipótesis</p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-900">Evolucionar hipótesis desde Modo Comentarios</h3>
                      <p className="mt-2 text-sm text-slate-600">La hipótesis destino se adapta al nuevo modo sin copiar perfiles ni códigos, manteniendo trazabilidad explícita con la hipótesis madre.</p>
                    </div>
                    <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-500 hover:text-slate-900" onClick={closeHypothesisEvolutionModal}>✕</button>
                  </div>
                </div>

                <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr,1.7fr]">
                  <aside className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hipótesis origen</p>
                      <h4 className="mt-1 text-base font-semibold text-slate-900">{activeEvolutionSourceHypothesis?.title || 'Hipótesis comentarios'}</h4>
                      <p className="mt-2 text-sm text-slate-600">{activeEvolutionSourceHypothesis?.description || 'Sin descripción conceptual.'}</p>
                      {activeEvolutionSourceHypothesis?.context_note ? <p className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">{activeEvolutionSourceHypothesis.context_note}</p> : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alcance de evolución</p>
                      <div className="mt-3 grid gap-2">
                        {[
                          ['single', 'Evolucionar solo esta hipótesis', 'Crea una única hipótesis destino a partir de la hipótesis seleccionada.'],
                          ['branch', 'Evolucionar toda la rama', 'Migra la cadena completa asociada a esta hipótesis: ancestros necesarios y descendientes de su rama hasta producto.'],
                        ].map(([value, label, description]) => {
                          const active = hypothesisEvolutionModal.scope === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              className={`rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-200' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                              onClick={() => {
                                setHypothesisEvolutionModal((prev) => ({ ...prev, scope: value, error: '' }));
                                if (value === 'branch') {
                                  hydrateEvolutionBranchDrafts(buildEvolutionBranchHypotheses(activeEvolutionSourceHypothesis, 'branch'));
                                }
                              }}
                            >
                              <span className="block text-sm font-semibold">{label}</span>
                              <span className={`mt-1 block text-xs ${active ? 'text-slate-200' : 'text-slate-500'}`}>{description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-indigo-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Modo destino</p>
                      <div className="mt-3 grid gap-2">
                        {[
                          ['interviews', 'Modo Entrevistas', 'Convierte la hipótesis en un experimento cualitativo con audiencia, formulario y umbrales de entrevistas.'],
                          ['video', 'Modo Video', 'Convierte la hipótesis en una hipótesis operativa para validación con métricas, canal y volumen.'],
                        ].map(([value, label, description]) => {
                          const active = hypothesisEvolutionModal.destinationMode === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              className={`rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-indigo-500 bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50'}`}
                              onClick={() => setHypothesisEvolutionModal((prev) => ({ ...prev, destinationMode: value, error: '' }))}
                            >
                              <span className="block text-sm font-semibold">{label}</span>
                              <span className={`mt-1 block text-xs ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Trazabilidad obligatoria</p>
                      <ul className="mt-2 space-y-1 list-disc pl-4">
                        <li>Origen: comentarios</li>
                        <li>Destino: entrevistas o video</li>
                        <li>IDs y timestamp de evolución persistidos</li>
                        <li>Sin duplicar perfiles ni códigos</li>
                      </ul>
                    </div>
                  </aside>

                  <section className="space-y-4">
                    {!hypothesisEvolutionModal.destinationMode ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">Selecciona un modo destino para completar los campos de adaptación de la hipótesis.</div>
                    ) : null}

                    {hypothesisEvolutionModal.destinationMode === 'interviews' ? (
                      <div className="space-y-4">
                        {hypothesisEvolutionModal.scope === 'branch' ? (
                          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-indigo-900">
                            Se mostrarán adaptadores individuales para las {evolutionBranchHypotheses.length} hipótesis de la rama completa.
                          </div>
                        ) : null}
                        {(hypothesisEvolutionModal.scope === 'branch' ? evolutionBranchHypotheses : [activeEvolutionSourceHypothesis]).filter(Boolean).map((branchHypothesis, index) => {
                          const branchId = String(branchHypothesis?.id || '').trim();
                          const draft = hypothesisEvolutionModal.scope === 'branch'
                            ? (hypothesisEvolutionInterviewBranchDrafts[branchId] || createEvolutionInterviewDraftForHypothesis(branchHypothesis))
                            : hypothesisEvolutionInterviewDraft;
                          const setDraft = (updater) => {
                            if (hypothesisEvolutionModal.scope === 'branch') {
                              const nextValue = typeof updater === 'function' ? updater(draft) : updater;
                              updateInterviewBranchDraft(branchId, nextValue);
                              return;
                            }
                            setHypothesisEvolutionInterviewDraft((prev) => (typeof updater === 'function' ? updater(prev) : updater));
                          };
                          return (
                      <div key={`evolution_interview_${branchId || index}`} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">Adaptador hacia Modo Entrevistas</h4>
                          <p className="mt-1 text-sm text-slate-500">Completa la ficha mínima para que la hipótesis pueda vivir correctamente en el módulo de entrevistas.</p>
                          <div className="mt-3 grid gap-2 md:grid-cols-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hipótesis</span>
                              <span className="mt-1 block text-sm font-medium text-slate-900">{branchHypothesis?.title || 'Hipótesis comentarios'}</span>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
                              <span className="mt-1 block text-sm font-medium text-slate-900">{commentHypothesisTypeLabel(branchHypothesis?.type)}</span>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lugar en la rama</span>
                              <span className="mt-1 block text-sm font-medium text-slate-900">{describeEvolutionBranchPosition(branchHypothesis)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Título" value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.type} onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))}>
                            {COMMENT_HYPOTHESIS_TYPE_OPTIONS.map((option) => <option key={`evolution_interview_${option.value}`} value={option.value}>{option.label}</option>)}
                          </select>
                          <textarea className="md:col-span-2 rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Descripción" value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} />
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.status} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}>
                            <option value="exploracion">exploración</option><option value="en_prueba">en prueba</option><option value="validada">validada</option><option value="refutada">refutada</option>
                          </select>
                          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Segmento" value={draft.segment} onChange={(e) => setDraft((prev) => ({ ...prev, segment: e.target.value }))} />
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.audience_id} onChange={(e) => setDraft((prev) => ({ ...prev, audience_id: e.target.value }))}>
                            <option value="">Audiencia objetivo</option>
                            {hypothesisEvolutionSupport.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}
                          </select>
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.related_client_id} onChange={(e) => setDraft((prev) => ({ ...prev, related_client_id: e.target.value }))}>
                            <option value="">Cliente relacionado</option>
                            {hypothesisEvolutionSupport.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                          </select>
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.interview_form_id} onChange={(e) => setDraft((prev) => ({ ...prev, interview_form_id: e.target.value }))}>
                            <option value="">Formulario asociado</option>
                            {hypothesisEvolutionSupport.forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
                          </select>
                          <input className="rounded-xl border px-3 py-2 text-sm" type="number" min="1" placeholder="Min entrevistas" value={draft.min_interviews} onChange={(e) => setDraft((prev) => ({ ...prev, min_interviews: e.target.value }))} />
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.validation_metric_config.comparison_operator} onChange={(e) => setDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, comparison_operator: e.target.value } }))}>
                            <option value=">=">Promedio métricas ≥ umbral</option><option value=">">Promedio métricas &gt; umbral</option><option value="<=">Promedio métricas ≤ umbral</option><option value="<">Promedio métricas &lt; umbral</option>
                          </select>
                          <input className="rounded-xl border px-3 py-2 text-sm" type="number" min="1" max="5" step="0.1" placeholder="Umbral" value={draft.validation_metric_config.threshold_value} onChange={(e) => setDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, threshold_value: e.target.value } }))} />
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.validation_metric_config.outcome_if_true} onChange={(e) => setDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, outcome_if_true: e.target.value } }))}>
                            <option value="validada">Si cumple → validada</option><option value="refutada">Si cumple → refutada</option><option value="señal fuerte">Si cumple → señal fuerte</option><option value="señal moderada">Si cumple → señal moderada</option><option value="señal débil">Si cumple → señal débil</option>
                          </select>
                          <select className="rounded-xl border px-3 py-2 text-sm" value={draft.validation_metric_config.outcome_if_false} onChange={(e) => setDraft((prev) => ({ ...prev, validation_metric_config: { ...prev.validation_metric_config, outcome_if_false: e.target.value } }))}>
                            <option value="refutada">Si no cumple → refutada</option><option value="validada">Si no cumple → validada</option><option value="señal fuerte">Si no cumple → señal fuerte</option><option value="señal moderada">Si no cumple → señal moderada</option><option value="señal débil">Si no cumple → señal débil</option><option value="no evaluada">Si no cumple → no evaluada</option>
                          </select>
                          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Métricas de validación</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {[
                                ['problem_score_avg', 'Problema promedio'],
                                ['solution_interest_avg', 'Interés en solución'],
                                ['problem_frequency_avg', 'Frecuencia del problema'],
                                ['problem_urgency_avg', 'Urgencia'],
                              ].map(([value, label]) => {
                                const selected = draft.validation_metric_config.selected_metrics.includes(value);
                                return (
                                  <label key={value} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={(event) => setDraft((prev) => {
                                        const current = prev.validation_metric_config.selected_metrics || [];
                                        const next = event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
                                        return { ...prev, validation_metric_config: { ...prev.validation_metric_config, selected_metrics: next } };
                                      })}
                                    />
                                    <span>{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <textarea className="rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Notas del experimento" value={draft.experiment_notes} onChange={(e) => setDraft((prev) => ({ ...prev, experiment_notes: e.target.value }))} />
                          <textarea className="rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Observaciones" value={draft.observations} onChange={(e) => setDraft((prev) => ({ ...prev, observations: e.target.value }))} />
                          <textarea className="md:col-span-2 rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Próximas acciones" value={draft.next_actions} onChange={(e) => setDraft((prev) => ({ ...prev, next_actions: e.target.value }))} />
                        </div>
                      </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {hypothesisEvolutionModal.destinationMode === 'video' ? (
                      <div className="space-y-4">
                        {hypothesisEvolutionModal.scope === 'branch' ? (
                          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-indigo-900">
                            Se mostrarán adaptadores individuales para las {evolutionBranchHypotheses.length} hipótesis de la rama completa.
                          </div>
                        ) : null}
                        {(hypothesisEvolutionModal.scope === 'branch' ? evolutionBranchHypotheses : [activeEvolutionSourceHypothesis]).filter(Boolean).map((branchHypothesis, index) => {
                          const branchId = String(branchHypothesis?.id || '').trim();
                          const draft = hypothesisEvolutionModal.scope === 'branch'
                            ? (hypothesisEvolutionVideoBranchDrafts[branchId] || createEvolutionVideoDraftForHypothesis(branchHypothesis))
                            : hypothesisEvolutionVideoDraft;
                          const setDraft = (updater) => {
                            if (hypothesisEvolutionModal.scope === 'branch') {
                              const nextValue = typeof updater === 'function' ? updater(draft) : updater;
                              updateVideoBranchDraft(branchId, nextValue);
                              return;
                            }
                            setHypothesisEvolutionVideoDraft((prev) => (typeof updater === 'function' ? updater(prev) : updater));
                          };
                          return (
                            <div key={`evolution_video_${branchId || index}`} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900">Adaptador hacia Modo Video</h4>
                                <p className="mt-1 text-sm text-slate-500">Completa la hipótesis operativa con statement, variable, métrica, umbral, volumen y canal.</p>
                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hipótesis</span>
                                    <span className="mt-1 block font-medium text-slate-900">{branchHypothesis?.title || 'Hipótesis comentarios'}</span>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
                                    <span className="mt-1 block font-medium text-slate-900">{commentHypothesisTypeLabel(branchHypothesis?.type)}</span>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lugar en la rama</span>
                                    <span className="mt-1 block font-medium text-slate-900">{describeEvolutionBranchPosition(branchHypothesis)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Título de la hipótesis a evolucionar</span>
                                  <span className="mt-1 block font-medium text-slate-900">{branchHypothesis?.title || 'Hipótesis comentarios'}</span>
                                </div>
                                <select className="rounded-xl border px-3 py-2 text-sm" value={draft.type} onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))}>
                                  {COMMENT_HYPOTHESIS_TYPE_OPTIONS.map((option) => <option key={`evolution_video_${option.value}`} value={option.value}>{option.label}</option>)}
                                </select>
                                <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Variable X" value={draft.variable_x} onChange={(e) => setDraft((prev) => ({ ...prev, variable_x: e.target.value }))} />
                                <textarea className="md:col-span-2 rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Hypothesis statement (Si X entonces Y)" value={draft.hypothesis_statement} onChange={(e) => setDraft((prev) => ({ ...prev, hypothesis_statement: e.target.value }))} />
                                <select className="rounded-xl border px-3 py-2 text-sm" value={draft.metrica_objetivo_y} onChange={(e) => setDraft((prev) => ({ ...prev, metrica_objetivo_y: e.target.value }))}>
                                  <option value="ctr">CTR</option><option value="cpc">CPC</option><option value="clicks">Clicks</option><option value="views">Views</option><option value="likes">Likes</option><option value="comments">Comments</option><option value="shares">Shares</option><option value="retencion_pct">Retention %</option>
                                </select>
                                <select className="rounded-xl border px-3 py-2 text-sm" value={draft.canal_principal} onChange={(e) => setDraft((prev) => ({ ...prev, canal_principal: e.target.value }))}>
                                  <option value="paid">paid</option><option value="organic">organic</option><option value="live">live</option>
                                </select>
                                <select className="rounded-xl border px-3 py-2 text-sm" value={draft.umbral_operador} onChange={(e) => setDraft((prev) => ({ ...prev, umbral_operador: e.target.value }))}>
                                  <option value=">=">&gt;=</option><option value=">">&gt;</option><option value="<=">&lt;=</option><option value="<">&lt;</option>
                                </select>
                                <div className="grid grid-cols-[1fr,120px] gap-3">
                                  <input className="rounded-xl border px-3 py-2 text-sm" type="number" placeholder="Umbral" value={draft.umbral_valor} onChange={(e) => setDraft((prev) => ({ ...prev, umbral_valor: e.target.value }))} />
                                  <select className="rounded-xl border px-3 py-2 text-sm" value={draft.umbral_tipo} onChange={(e) => setDraft((prev) => ({ ...prev, umbral_tipo: e.target.value }))}>
                                    <option value="entero">entero</option><option value="decimal">decimal</option><option value="%">%</option>
                                  </select>
                                </div>
                                <div className="grid grid-cols-[1fr,160px] gap-3">
                                  <input className="rounded-xl border px-3 py-2 text-sm" type="number" placeholder="Volumen mínimo" value={draft.volumen_minimo} onChange={(e) => setDraft((prev) => ({ ...prev, volumen_minimo: e.target.value }))} />
                                  <select className="rounded-xl border px-3 py-2 text-sm" value={draft.volumen_unidad} onChange={(e) => setDraft((prev) => ({ ...prev, volumen_unidad: e.target.value }))}>
                                    <option value="views">Views</option><option value="clicks">Clicks</option><option value="ctr">CTR</option><option value="cpc">CPC</option><option value="purchase_rate">Purchase Rate</option>
                                  </select>
                                </div>
                                <textarea className="md:col-span-2 rounded-xl border px-3 py-2 text-sm" rows={3} placeholder="Contexto cualitativo" value={draft.contexto_cualitativo} onChange={(e) => setDraft((prev) => ({ ...prev, contexto_cualitativo: e.target.value }))} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {hypothesisEvolutionSupport.loading ? <p className="text-sm text-slate-500">Preparando opciones del adaptador…</p> : null}
                    {hypothesisEvolutionSupport.error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{hypothesisEvolutionSupport.error}</div> : null}
                    {hypothesisEvolutionModal.error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{hypothesisEvolutionModal.error}</div> : null}
                  </section>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
                  <div className="text-xs text-slate-500">La evolución crea una nueva hipótesis destino y conserva la original en Comentarios.</div>
                  <div className="flex items-center gap-2">
                    <Button className="bg-white border text-slate-700" onClick={closeHypothesisEvolutionModal}>Cancelar</Button>
                    <Button className="bg-indigo-600 text-white" onClick={saveHypothesisEvolution} disabled={!hypothesisEvolutionModal.destinationMode || hypothesisEvolutionModal.saving}>
                      {hypothesisEvolutionModal.saving ? 'Evolucionando…' : 'Confirmar evolución'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {hypothesisEditor.open ? (
            <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-900/40 p-4">
              <div className="mx-auto my-6 w-full max-w-2xl rounded-xl border bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-5 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">{hypothesisEditor.mode === 'create' ? 'Crear hipótesis' : 'Editar hipótesis'}</h3>
                  <button type="button" className="text-slate-500" onClick={closeHypothesisEditor}>✕</button>
                </div>
                <div className="grid max-h-[calc(100vh-13rem)] gap-3 overflow-y-auto p-5">
                  <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Título de la hipótesis" value={hypothesisEditor.title} onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, title: e.target.value }))} />
                  <textarea className="h-24 rounded-lg border px-3 py-2 text-sm" placeholder="Descripción conceptual" value={hypothesisEditor.description} onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, description: e.target.value }))} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo de hipótesis</p>
                      <select className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={hypothesisEditor.type} onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, type: e.target.value, parentHypothesisId: '' }))}>
                        {COMMENT_HYPOTHESIS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <p className="mt-2 text-[11px] text-slate-500">Cadena válida: problema → segmento → mensajes → solución → producto.</p>
                    </div>
                    <div className="rounded-lg border bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hipótesis padre</p>
                      <select className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={hypothesisEditor.parentHypothesisId} onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, parentHypothesisId: e.target.value }))} disabled={!COMMENT_HYPOTHESIS_PARENT_TYPE_BY_CHILD[normalizeCommentHypothesisType(hypothesisEditor.type)]}>
                        <option value="">{COMMENT_HYPOTHESIS_PARENT_TYPE_BY_CHILD[normalizeCommentHypothesisType(hypothesisEditor.type)] ? 'Sin padre' : 'Este tipo no admite padre'}</option>
                        {allowedParentHypothesesForEditor.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title} · {commentHypothesisTypeLabel(hypothesis.type)}</option>)}
                      </select>
                      <p className="mt-2 text-[11px] text-slate-500">Solo puedes vincular esta hipótesis con padres del tipo inmediatamente anterior en la jerarquía.</p>
                    </div>
                  </div>
                  <textarea className="h-20 rounded-lg border px-3 py-2 text-sm" placeholder="Contexto o nota conceptual (opcional)" value={hypothesisEditor.context_note} onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, context_note: e.target.value }))} />

                  <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Perfiles vinculados</p>
                        <p className="text-[11px] text-teal-700/80">Agrupan y estructuran la hipótesis dentro del Modo Comentarios.</p>
                      </div>
                      <label className="relative block min-w-[220px] flex-1">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-teal-500" />
                        <input
                          className="w-full rounded-lg border border-teal-200 bg-white py-2 pl-9 pr-3 text-sm"
                          placeholder="Buscar perfiles existentes"
                          value={hypothesisEditor.profileQuery}
                          onChange={(e) => setHypothesisEditor((prev) => ({ ...prev, profileQuery: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {!hypothesisEditor.linkedProfileIds.length ? <span className="text-xs text-slate-500">Sin perfiles vinculados todavía.</span> : hypothesisEditor.linkedProfileIds.map((profileId) => {
                        const profile = profileById.get(String(profileId));
                        if (!profile) return null;
                        return (
                          <button
                            key={`hyp-profile-chip-${profile.id}`}
                            type="button"
                            className="rounded-full border border-teal-200 bg-white px-2 py-1 text-[11px] text-teal-700 hover:bg-teal-100"
                            onClick={() => setHypothesisEditor((prev) => ({
                              ...prev,
                              linkedProfileIds: prev.linkedProfileIds.filter((item) => String(item) !== String(profile.id)),
                            }))}
                          >
                            {profile.name} <span aria-hidden="true">×</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 max-h-56 space-y-1 overflow-auto">
                      {!availableHypothesisProfiles.length ? <p className="text-xs text-slate-500">No hay perfiles disponibles aún en este workspace del Modo Comentarios.</p> : availableHypothesisProfiles
                        .filter((profile) => {
                          const q = String(hypothesisEditor.profileQuery || '').trim().toLowerCase();
                          if (!q) return true;
                          return String(profile.name || '').toLowerCase().includes(q) || String(profile.description || '').toLowerCase().includes(q);
                        })
                        .map((profile) => {
                          const checked = hypothesisEditor.linkedProfileIds.includes(String(profile.id));
                          return (
                            <label key={`hyp-profile-${profile.id}`} className="flex items-start gap-2 rounded border border-teal-100 bg-white px-2 py-1.5 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setHypothesisEditor((prev) => ({
                                  ...prev,
                                  linkedProfileIds: e.target.checked
                                    ? [...prev.linkedProfileIds, String(profile.id)]
                                    : prev.linkedProfileIds.filter((profileId) => String(profileId) !== String(profile.id)),
                                }))}
                              />
                              <span>
                                <span className="font-medium text-slate-800">{profile.name}</span>
                                <span className="mt-0.5 block text-[11px] text-slate-500">{profile.description || 'Perfil conceptual disponible para agrupar códigos.'}{profile.assignmentCount ? ` · ${profile.assignmentCount} códigos asignados` : ''}</span>
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                </div>
                <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-white px-5 py-3">
                  <Button className="bg-white border text-slate-700" onClick={closeHypothesisEditor}>Cancelar</Button>
                  <Button className="bg-indigo-600 text-white" onClick={saveHypothesisEditor}>Guardar</Button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'clusters' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Clusters</h2>
              <p className="text-sm text-slate-600">Se calculan automáticamente por uso de códigos en fragmentos de comentarios.</p>
              {clusters.length === 0 ? <p className="text-sm text-slate-500">Aún no hay clusters detectados.</p> : clusters.map((cluster) => (
                <div key={cluster.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">{cluster.name}</p>
                  <p className="text-xs text-slate-500">Fragmentos: {cluster.fragments_count}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CommentsModePage;
