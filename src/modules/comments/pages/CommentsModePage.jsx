import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, BookOpenText, MessageSquareText, Tags, Network, Scissors, Search, MoreHorizontal, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { commentsIngestionApi } from '@/services/commentsIngestionApi';
import { Toolbar } from '@/modules/interviews/components/editor-toolbar/Toolbar';

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
  const [commentsTable, setCommentsTable] = useState({ loading: false, error: '', items: [], total: 0, limit: 100, offset: 0, q: '' });
  const [readerViewMode, setReaderViewMode] = useState('document');
  const [readerSelectionText, setReaderSelectionText] = useState('');
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
  });

  const [store, setStore] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      };
    } catch {
      return { fragments: [], codes: [] };
    }
  });

  const persist = (next) => {
    setStore(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const fragments = store.fragments || [];
  const codes = store.codes || [];
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
    });
  };

  const closeFragmentEditor = () => {
    setFragmentEditor((prev) => ({ ...prev, open: false }));
  };

  const saveFragmentEditor = () => {
    const title = String(fragmentEditor.title || '').trim();
    const excerpt = String(fragmentEditor.excerpt || '').trim();
    const linkedCode = String(fragmentEditor.linkedCode || '').trim();
    const codeSlugs = linkedCode ? [linkedCode] : [];

    if (!excerpt) return;

    if (fragmentEditor.mode === 'create') {
      const nextFragment = {
        id: `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title,
        excerpt,
        code_slugs: codeSlugs,
        created_at: new Date().toISOString(),
      };
      persist({ ...store, fragments: [nextFragment, ...fragments] });
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

  const evolveFragmentToCode = (fragment) => {
    const baseName = String(fragment.title || fragment.excerpt || '').trim();
    if (!baseName) return;
    const baseSlug = slugify(baseName).slice(0, 50) || `code-${Date.now()}`;
    let candidate = baseSlug;
    let suffix = 1;
    while (codes.some((code) => code.slug === candidate)) {
      suffix += 1;
      candidate = `${baseSlug}-${suffix}`;
    }

    const nextCode = {
      id: `code_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: baseName,
      slug: candidate,
      parent_slug: null,
    };

    const mergedCodeSlugs = Array.from(new Set([...(fragment.code_slugs || []), candidate]));

    persist({
      ...store,
      codes: [nextCode, ...codes],
      fragments: fragments.map((item) => (String(item.id) === String(fragment.id) ? { ...item, code_slugs: mergedCodeSlugs } : item)),
    });
  };

  const createCommentFragment = ({ text, comment }) => {
    const excerpt = String(text || '').trim();
    if (!excerpt || !comment) return;
    const nextFragment = {
      id: `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      title: '',
      excerpt,
      comment_id: comment.id,
      source_comment_id: comment.source_comment_id,
      video_id: comment.video_id || null,
      code_slugs: [],
      created_at: new Date().toISOString(),
    };
    persist({
      ...store,
      fragments: [nextFragment, ...fragments],
    });
    setReaderSelectionText('');
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
    const text = String(selection?.toString() || '').trim();
    setReaderSelectionText(text);
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
                onCreateFragment={() => createCommentFragment({ text: readerSelectionText, comment: selectedReaderComment })}
                onCreateManualFragment={() => {
                  const manualText = window.prompt('Nuevo fragmento manual');
                  if (!manualText) return;
                  createCommentFragment({ text: manualText, comment: selectedReaderComment || readerComments[0] });
                }}
                onViewFragments={() => setTab('fragments')}
                onViewCodes={() => setTab('codes')}
                onLinkCode={() => setTab('codes')}
                onViewClusters={() => setTab('clusters')}
                onActivateAnalysis={() => setTab('comments')}
                onCreateMemo={() => {
                  const memoText = window.prompt('Memo de lectura');
                  if (!memoText) return;
                  createCommentFragment({ text: memoText, comment: selectedReaderComment || readerComments[0] });
                }}
                onToggleView={() => setReaderViewMode((prev) => (prev === 'document' ? 'focus' : 'document'))}
                canCreateFragment={Boolean(readerSelectionText && selectedReaderComment)}
                viewLabel={readerViewMode === 'focus' ? 'focus' : 'comentario'}
              />
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
                          setReaderSelectionText('');
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
                    {readerSelectionText ? <span className="ml-auto rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">Selección lista ({readerSelectionText.length} chars)</span> : null}
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
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => openFragmentEditor(fragment, 'edit')}>Vincular código</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { evolveFragmentToCode(fragment); setFragmentMenuId(''); }}>Evolucionar a código</button>
                              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => { deleteSingleFragment(fragmentId); setFragmentMenuId(''); }}>Eliminar fragmento</button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {linkedCode ? <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">{linkedCode.name}</span> : <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Sin código</span>}
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
                    </div>
                    <div className="flex items-center justify-between border-t px-5 py-3">
                      <Button
                        className="bg-white border text-slate-700"
                        onClick={() => {
                          if (fragmentEditor.mode !== 'edit') return;
                          const target = fragments.find((fragment) => String(fragment.id) === String(fragmentEditor.fragmentId));
                          if (!target) return;
                          evolveFragmentToCode({ ...target, title: fragmentEditor.title || target.title, excerpt: fragmentEditor.excerpt || target.excerpt });
                          closeFragmentEditor();
                        }}
                        disabled={fragmentEditor.mode !== 'edit'}
                      >
                        Evolucionar a código
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
                  <Button className="bg-white border text-slate-700" title="Mapa de códigos" onClick={() => setCodeMapOpen(true)}>
                    🕸️ Mapa de códigos
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
                      className={`relative h-full overflow-hidden bg-slate-50 ${isCodeMapPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                      onMouseDown={handleCodeMapCanvasMouseDown}
                    >
                      {codeMapConnectSource ? (
                        <div className="absolute left-3 top-3 z-20 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                          Conectando desde <b>{codes.find((item) => String(item.slug) === String(codeMapConnectSource))?.name || codeMapConnectSource}</b>. Haz clic en otro nodo para completar.
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
                                  setCodeParent(code.slug, codeMapConnectSource);
                                  setCodeMapConnectSource('');
                                }
                                setSelectedCodeMapEdge('');
                                setSelectedCodeMapNode(code.slug);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedCodeMapNode(code.slug);
                                setCodeMapContextMenu({ open: true, x: event.clientX, y: event.clientY, slug: code.slug });
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
