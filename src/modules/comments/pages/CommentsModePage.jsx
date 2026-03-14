import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, BookOpenText, MessageSquareText, Tags, Network, Scissors, Search, MoreHorizontal, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { commentsIngestionApi } from '@/services/commentsIngestionApi';
import { Toolbar } from '@/modules/interviews/components/editor-toolbar/Toolbar';
import { loadCommentsModeStore, saveCommentsModeStore } from '@/modules/comments/services/commentsModeStore';

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

const CommentsModePage = () => {
  const { projectId, campaignId } = useParams();
  const storageKey = `comments-mode:${projectId}:${campaignId}`;

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
  const codeMapCanvasRef = useRef(null);
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

  const [store, setStore] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
        codeProposals: Array.isArray(parsed.codeProposals) ? parsed.codeProposals : [],
      };
    } catch {
      return { fragments: [], codes: [], codeProposals: [] };
    }
  });

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

  const guardCodeEvolution = () => {
    if (!COMMENT_CODE_EVOLUTION_DISABLED) return false;
    setSemanticAgentError('La evolución de fragmentos a códigos está deshabilitada en Modo Comentarios.');
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateStore = async () => {
      try {
        const indexedState = await loadCommentsModeStore(storageKey);
        if (cancelled || !indexedState || typeof indexedState !== 'object') return;
        setStore({
          fragments: Array.isArray(indexedState.fragments) ? indexedState.fragments : [],
          codes: Array.isArray(indexedState.codes) ? indexedState.codes : [],
          codeProposals: Array.isArray(indexedState.codeProposals) ? indexedState.codeProposals : [],
        });
      } catch {
        // Si no se puede leer IndexedDB, se mantiene fallback de localStorage.
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
  const readerComments = commentsTable.items || [];

  const selectedReaderComment = useMemo(() => {
    if (!readerComments.length) return null;
    const selected = readerComments.find((item) => String(item.id) === String(selectedReaderCommentId));
    return selected || readerComments[0] || null;
  }, [readerComments, selectedReaderCommentId]);

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
    persist({ ...store, codes: nextCodes, fragments: nextFragments });
    setSelectedCodeSlug('');
    setCodeMenuSlug('');
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
    return codes.filter((code) => {
      const name = String(code.name || '').toLowerCase();
      const description = String(code.description || '').toLowerCase();
      const tags = Array.isArray(code.tags) ? code.tags.join(' ').toLowerCase() : String(code.tags || '').toLowerCase();
      const matchesQuery = !query || name.includes(query) || description.includes(query) || tags.includes(query);
      const matchesHypothesis = !codeHypothesisFilter || String(code.hypothesis_id || '') === codeHypothesisFilter;
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

  const codeMapVisibleCodes = useMemo(() => {
    if (!codeHypothesisFilter) return codes;
    return codes.filter((code) => String(code.hypothesis_id || '') === String(codeHypothesisFilter));
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

  const codeMapEdges = useMemo(() => codeMapVisibleCodes
    .filter((code) => code.parent_slug && String(code.parent_slug) !== String(code.slug))
    .filter((code) => codeMapVisibleSlugSet.has(String(code.slug)) && codeMapVisibleSlugSet.has(String(code.parent_slug)))
    .map((code) => ({
      id: `edge_${code.parent_slug}_${code.slug}`,
      source: String(code.parent_slug),
      target: String(code.slug),
    })), [codeMapVisibleCodes, codeMapVisibleSlugSet]);

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

    const onUp = () => {
      setDraggingCodeMapNode('');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCodeMapCanvasMouseDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('[data-code-map-node="true"]')) return;
    setSelectedCodeMapNode('');
    setSelectedCodeMapEdge('');
    setCodeMapContextMenu({ open: false, x: 0, y: 0, slug: '' });
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
      setCodeParent(edge.target, '');
      setSelectedCodeMapEdge('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [codeMapOpen, selectedCodeMapEdge, codeMapEdges]);

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
    const linkedCode = COMMENT_CODE_EVOLUTION_DISABLED ? '' : String(fragmentEditor.linkedCode || '').trim();
    const codeSlugs = linkedCode ? [linkedCode] : [];

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
      const [enrichedFragment] = await enrichFragmentsForIaSelection([nextFragment]);
      const fragmentToStore = enrichedFragment || nextFragment;
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
      const pageSize = 500;
      let offset = 0;
      let total = null;
      const allComments = [];

      while (total == null || offset < total) {
        const page = await commentsIngestionApi.listTable({ projectId, campaignId, limit: pageSize, offset, q: '' });
        const items = Array.isArray(page?.items) ? page.items : [];
        total = Number(page?.total || 0);
        allComments.push(...items);
        if (!items.length) break;
        offset += items.length;
      }

      const seen = new Set();
      const commentsForGeneration = allComments.filter((item) => {
        const id = String(item?.id || item?.comment_id || item?.source_comment_id || '');
        const text = String(item?.text || item?.comment_text || item?.body || item?.content || '').trim();
        const key = id || text.slice(0, 180).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return Boolean(text);
      });

      const response = await commentsIngestionApi.runCodeGenerationAgent({
        project_id: projectId,
        campaign_id: campaignId,
        comments: commentsForGeneration,
      });

      const proposals = Array.isArray(response?.proposals) ? response.proposals : [];
      setGeneratedCodeProposals(proposals.map((proposal, index) => ({
        id: `generated_code_proposal_${Date.now()}_${index + 1}`,
        cluster_name: String(proposal.cluster_name || `Cluster ${index + 1}`),
        suggested_code_name: String(proposal.suggested_code_name || `Código ${index + 1}`),
        description: String(proposal.description || 'Propuesta conceptual generada sin trazabilidad inicial.'),
        confidence: Number(proposal.confidence || 0),
        size_estimate: Number(proposal.size_estimate || 0),
        subclusters: Array.isArray(proposal.subclusters) ? proposal.subclusters : [],
        generated_without_traceability: true,
      })));
      setCodeGenerationMetrics({
        ...(response?.metrics || {}),
        comments_fetched_for_generation: commentsForGeneration.length,
        comments_total_from_table: total == null ? commentsForGeneration.length : total,
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

      const createdFragments = [];
      let failed = 0;
      setSemanticAgentProgress({ done: 0, total: pendingComments.length });

      for (let index = 0; index < pendingComments.length; index += 1) {
        const comment = pendingComments[index];
        const sourceCommentId = String(comment.source_comment_id || comment.id || '').trim();
        const sourceText = String(comment.text || '').trim();
        if (!sourceCommentId || !sourceText) {
          failed += 1;
          setSemanticAgentProgress({ done: index + 1, total: pendingComments.length });
          continue;
        }

        try {
          const response = await commentsIngestionApi.extractSemanticFragments({
            comment_id: sourceCommentId,
            source_id: String(comment.source || 'youtube'),
            texto_completo_del_comentario: sourceText,
          });

          const generatedFragments = Array.isArray(response.fragments) ? response.fragments : [];
          const timestamp = new Date().toISOString();
          for (const fragment of generatedFragments) {
            const text = String(fragment?.fragment_text || '').trim();
            if (!text) continue;
            createdFragments.push({
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
              source_type: 'semantic_agent',
              source_run_id: comment.source_run_id || null,
              author_name: comment.author_name || null,
              video_id: comment.video_id || null,
              code_slugs: [],
              created_at: timestamp,
            });
          }
        } catch {
          failed += 1;
        }

        setSemanticAgentProgress({ done: index + 1, total: pendingComments.length });
      }

      if (!createdFragments.length) {
        setSemanticAgentError('La IA no pudo extraer fragmentos semánticos de los comentarios pendientes.');
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
      const data = await commentsIngestionApi.listInputs({ projectId, campaignId });
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
      const data = await commentsIngestionApi.listRuns({ projectId, campaignId });
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
      const data = await commentsIngestionApi.listCodeProposalReviews({ projectId, campaignId, limit: 2000 });
      setProposalFeedbackSummary(data?.summaryByCode && typeof data.summaryByCode === 'object' ? data.summaryByCode : {});
    } catch {
      setProposalFeedbackSummary({});
    }
  };

  const deleteRun = async (runId) => {
    if (!runId) return;
    if (!window.confirm('¿Eliminar este run? También se eliminarán su input asociado y sus comentarios de la base total.')) return;
    try {
      await commentsIngestionApi.deleteRun({ runId, projectId, campaignId });
      await Promise.all([loadRuns(), loadInputs(), loadCommentsTable({ offset: 0, q: commentsTable.q })]);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo eliminar el run.');
    }
  };

  useEffect(() => {
    if (tab !== 'comments' && tab !== 'reader') return;
    loadCommentsTable({ offset: commentsTable.offset, q: commentsTable.q });
    if (commentsSubtab === 'table') loadCommentsTable({ offset: 0, q: commentsTable.q });
    if (commentsSubtab === 'ingestion') {
      loadRuns();
      loadInputs();
    }
  }, [tab, commentsSubtab]);

  useEffect(() => {
    if (tab !== 'codes') return;
    loadProposalReviews();
  }, [tab, projectId, campaignId]);

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
    { id: 'clusters', label: 'Clusters', icon: Network },
  ];

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
      <div key={slug} className="space-y-1">
        <article
          className={`group relative rounded-xl border bg-white p-3 shadow-sm transition ${isSelected ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200 hover:shadow-md'} ${usageCount === 0 ? 'opacity-80' : ''}`}
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
                <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border bg-white p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('edit', code)}>Editar código</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('create', null, slug)}>Crear subcódigo</button>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openCodeEditor('edit', code)}>Mover jerarquía</button>
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
            <div className="flex flex-wrap gap-2">
              <Button className="bg-indigo-600 text-white" onClick={() => setTab('reader')}>Abrir lector</Button>
              <Button className="bg-white border text-indigo-700" onClick={() => setTab('codes')}>Crear código</Button>
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
                  <Button className="bg-white border text-slate-700" title="Mapa de códigos" onClick={() => setCodeMapOpen(true)}>
                    🕸️ Mapa de códigos
                  </Button>
                  <Button className="bg-emerald-600 text-white" onClick={runGenerateCodesWithoutTraceability}>
                    Generar
                  </Button>
                  <Button className="bg-indigo-600 text-white" onClick={() => openCodeEditor('create')}>
                    <Plus className="mr-1 h-4 w-4" /> Crear código
                  </Button>
                </div>
              </div>

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
                            const source = codeMapNodes.find((node) => String(node.slug) === String(edge.source));
                            const target = codeMapNodes.find((node) => String(node.slug) === String(edge.target));
                            if (!source || !target) return null;
                            const selected = selectedCodeMapEdge === edge.id;
                            return (
                              <line
                                key={edge.id}
                                x1={source.x + 90}
                                y1={source.y + 26}
                                x2={target.x + 90}
                                y2={target.y + 26}
                                stroke={selected ? '#4f46e5' : '#9CA3AF'}
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

                        {codeMapNodes.map((code) => {
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
                              <p className="truncate">{code.name}</p>
                              <p className="text-[10px] font-normal text-slate-500">({code.fragmentCount}) · {code.scoreTotal}/100</p>
                            </div>
                          );
                        })}
                      </div>

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
            </div>
          )}



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
                    <p className="text-xs text-slate-500">
                      Comentarios consultados: {Number(codeGenerationMetrics.comments_total_from_table || 0)} · enviados a generación: {Number(codeGenerationMetrics.comments_fetched_for_generation || 0)} · analizados por IA: {Number(codeGenerationMetrics.comments_analyzed || 0)} · Clusters: {Number(codeGenerationMetrics.clusters_count || 0)} · Top-level: {Number(codeGenerationMetrics.top_level_clusters_count || 0)}
                    </p>
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
