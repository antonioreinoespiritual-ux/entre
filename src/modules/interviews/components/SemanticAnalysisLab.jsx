import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Braces, Code2, Hash, Link2, MoreHorizontal, Pencil, Sparkles, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getLeanProblemScore, getLeanSolutionScore } from '@/modules/interviews/components/LeanEvaluationPanel';
import { buildSemanticAnalysis, defaultSemanticClusters, defaultSemanticCodebook } from '@/modules/interviews/services/semanticAnalysis';

const card = 'rounded-xl border border-slate-200 bg-white p-4';
const tabButton = 'rounded-lg px-3 py-1.5 text-sm border transition-colors';
const STORAGE_KEY = 'interviews.semantic.lab.workspace.v1';

const defaultFilters = {
  audience_id: '',
  form_id: '',
  client_id: '',
  from: '',
  to: '',
  minProblem: '',
  minSolution: '',
};

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString();
};

const emptyNewCode = { name: '', slug: '', category: 'interpretacion', description: '' };

const codeCategoryTone = {
  tipo_problema: 'border-rose-200 bg-rose-50 text-rose-700',
  interpretacion: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  emocion: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
  comportamiento: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  intento_solucion: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export const SemanticAnalysisLab = ({ sessions = [], audiences = [], forms = [], clients = [], persistedFragments = [], onOpenSession, onCreateFragment }) => {
  const [filters, setFilters] = useState(defaultFilters);
  const [activeTab, setActiveTab] = useState('interviews');
  const [openInterviewId, setOpenInterviewId] = useState(null);
  const [openCluster, setOpenCluster] = useState(null);
  const [selectedFragmentId, setSelectedFragmentId] = useState(null);
  const [newCode, setNewCode] = useState(emptyNewCode);
  const [fragmentFilters, setFragmentFilters] = useState({ q: '', audience: '', interview: '', document: '', source: '', sort: 'created_desc' });
  const [fragmentPage, setFragmentPage] = useState(1);
  const [workspace, setWorkspace] = useState({
    customCodebook: [],
    codeAssignments: {},
    clusterNameOverrides: {},
    fragmentMetaById: {},
    deletedFragmentIds: [],
  });
  const [fragmentModalOpen, setFragmentModalOpen] = useState(false);
  const [fragmentModalDraft, setFragmentModalDraft] = useState({ id: null, title: '', description: '', linkedCode: '' });
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [activeCodeSlug, setActiveCodeSlug] = useState('');

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setWorkspace((prev) => ({ ...prev, ...parsed }));
    } catch (error) {
      // Ignore corrupt local workspace and keep defaults.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch (error) {
      // Ignore storage errors in constrained environments.
    }
  }, [workspace]);

  const filteredSessions = useMemo(
    () => sessions
      .filter((session) => {
        if (filters.audience_id && String(session.audience_id || '') !== String(filters.audience_id)) return false;
        if (filters.form_id && String(session.form_id || '') !== String(filters.form_id)) return false;
        if (filters.client_id && String(session.client_id || '') !== String(filters.client_id)) return false;
        const time = new Date(session.created_at).getTime();
        if (filters.from && time < new Date(filters.from).getTime()) return false;
        if (filters.to && time > (new Date(filters.to).getTime() + 86400000)) return false;
        const evaluation = session.responses_json?.__lean_evaluation || {};
        const problemScore = getLeanProblemScore(evaluation);
        const solutionScore = getLeanSolutionScore(evaluation);
        if (filters.minProblem && (problemScore == null || problemScore < Number(filters.minProblem))) return false;
        if (filters.minSolution && (solutionScore == null || solutionScore < Number(filters.minSolution))) return false;
        return true;
      })
      .map((session) => {
        const evaluation = session.responses_json?.__lean_evaluation || {};
        return {
          ...session,
          __problemScore: getLeanProblemScore(evaluation),
          __solutionScore: getLeanSolutionScore(evaluation),
        };
      }),
    [sessions, filters],
  );

  const normalizedFragments = useMemo(() => (persistedFragments || []).map((fragment, index) => ({
    id: String(fragment.id),
    interview_id: fragment.interview_session_id || fragment.interview_id || null,
    document_id: fragment.document_node_id || fragment.document_id || null,
    text: String(fragment.selected_text || fragment.text || '').trim(),
    position: Number(fragment.position ?? fragment.start_offset ?? index + 1) || (index + 1),
    originRef: fragment.originRef || (fragment.document_node_id ? `cloud:${fragment.document_node_id}` : `cloud#${index + 1}`),
    sourceType: fragment.source_type || fragment.sourceType || 'manual',
    created_at: fragment.created_at || null,
    start_offset: fragment.start_offset ?? null,
    end_offset: fragment.end_offset ?? null,
    document_node_id: fragment.document_node_id || null,
    campaign_id: fragment.campaign_id || null,
    project_id: fragment.project_id || null,
  })).filter((fragment) => fragment.text), [persistedFragments]);

  const audiencesById = useMemo(() => Object.fromEntries(audiences.map((audience) => [String(audience.id), audience])), [audiences]);
  const formsById = useMemo(() => Object.fromEntries(forms.map((form) => [String(form.id), form])), [forms]);
  const clientsById = useMemo(() => Object.fromEntries(clients.map((client) => [String(client.id), client])), [clients]);

  const analysis = useMemo(
    () => buildSemanticAnalysis({
      sessions: filteredSessions,
      audiencesById,
      formsById,
      clientsById,
      fragments: normalizedFragments,
      customCodebook: workspace.customCodebook,
      codeAssignments: workspace.codeAssignments,
      clusterNameOverrides: workspace.clusterNameOverrides,
    }),
    [filteredSessions, audiencesById, formsById, clientsById, normalizedFragments, workspace],
  );

  const interviewById = useMemo(() => Object.fromEntries(analysis.interviews.map((interview) => [String(interview.id), interview])), [analysis.interviews]);
  const selectedInterview = openInterviewId ? interviewById[String(openInterviewId)] : null;
  const selectedFragment = selectedFragmentId ? analysis.fragments.find((fragment) => fragment.id === selectedFragmentId) : null;

  const visibleFragments = useMemo(() => {
    const q = fragmentFilters.q.trim().toLowerCase();
    const deletedIds = new Set((workspace.deletedFragmentIds || []).map((id) => String(id)));
    const rows = analysis.fragments.filter((fragment) => {
      if (deletedIds.has(String(fragment.id))) return false;
      const interview = interviewById[String(fragment.interview_id)];
      if (fragmentFilters.source && String(fragment.sourceType || '') !== String(fragmentFilters.source)) return false;
      if (fragmentFilters.interview && String(fragment.interview_id || '') !== String(fragmentFilters.interview)) return false;
      if (fragmentFilters.audience && String(interview?.audienceId || '') !== String(fragmentFilters.audience)) return false;
      if (fragmentFilters.document && String(fragment.document_id || fragment.metadata?.document_node_id || '') !== String(fragmentFilters.document)) return false;
      if (q && !`${fragment.text || ''} ${fragment.originRef || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    return [...rows].sort((a, b) => {
      if (fragmentFilters.sort === 'created_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (fragmentFilters.sort === 'document_asc') return String(a.document_id || a.metadata?.document_node_id || '').localeCompare(String(b.document_id || b.metadata?.document_node_id || ''));
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [analysis.fragments, fragmentFilters, interviewById, workspace.deletedFragmentIds]);

  const pagedFragments = useMemo(() => {
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(visibleFragments.length / pageSize));
    const safePage = Math.min(fragmentPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      rows: visibleFragments.slice(start, start + pageSize),
      pageSize,
      totalPages,
      currentPage: safePage,
      total: visibleFragments.length,
    };
  }, [fragmentPage, visibleFragments]);



  useEffect(() => {
    setFragmentPage(1);
  }, [fragmentFilters.q, fragmentFilters.audience, fragmentFilters.interview, fragmentFilters.document, fragmentFilters.source, fragmentFilters.sort]);

  const toggleFragmentCode = (fragmentId, codeSlug) => {
    setWorkspace((prev) => {
      const current = prev.codeAssignments[fragmentId] || [];
      const next = current.includes(codeSlug)
        ? current.filter((slug) => slug !== codeSlug)
        : [...current, codeSlug];
      return {
        ...prev,
        codeAssignments: {
          ...prev.codeAssignments,
          [fragmentId]: next,
        },
      };
    });
  };

  const createCode = () => {
    const name = newCode.name.trim();
    if (!name) return;
    const slug = (newCode.slug || name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '_');

    if (!slug || analysis.codes.some((code) => code.slug === slug)) return;

    setWorkspace((prev) => ({
      ...prev,
      customCodebook: [...prev.customCodebook, {
        slug,
        name,
        category: newCode.category || 'interpretacion',
        description: newCode.description.trim(),
      }],
    }));
    setNewCode(emptyNewCode);
  };


  const buildCodeFromFragment = (title, text, existingCodes = []) => {
    const preferredName = String(title || '').trim() || String(text || '').trim().split(/\s+/).slice(0, 6).join(' ') || 'Código de fragmento';
    const baseSlug = preferredName
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'codigo_fragmento';

    const slugs = new Set(existingCodes.map((code) => String(code.slug)));
    let slug = baseSlug;
    let idx = 2;
    while (slugs.has(slug)) {
      slug = `${baseSlug}_${idx}`;
      idx += 1;
    }

    return { slug, name: preferredName };
  };

  const openFragmentModal = (fragment) => {
    if (!fragment) return;
    setSelectedFragmentId(fragment.id);
    const meta = workspace.fragmentMetaById?.[String(fragment.id)] || {};
    setFragmentModalDraft({
      id: fragment.id,
      title: meta.title || '',
      description: fragment.text || '',
      linkedCode: fragment.codeSlugs?.[0] || '',
    });
    setFragmentModalOpen(true);
  };

  const saveFragmentMeta = () => {
    if (!fragmentModalDraft.id) return;
    const fragmentId = String(fragmentModalDraft.id);
    setWorkspace((prev) => ({
      ...prev,
      fragmentMetaById: {
        ...(prev.fragmentMetaById || {}),
        [fragmentId]: {
          title: String(fragmentModalDraft.title || '').trim(),
        },
      },
    }));
  };

  const deleteFragment = (fragmentId) => {
    if (!window.confirm('¿Eliminar fragmento? Esta acción lo ocultará de la lista y removerá sus vínculos de código.')) return;
    const id = String(fragmentId);
    setWorkspace((prev) => {
      const nextAssignments = { ...(prev.codeAssignments || {}) };
      delete nextAssignments[id];
      return {
        ...prev,
        codeAssignments: nextAssignments,
        deletedFragmentIds: Array.from(new Set([...(prev.deletedFragmentIds || []), id])),
      };
    });
    setFragmentModalOpen(false);
  };

  const evolveFragmentToCodeFromModal = () => {
    if (!fragmentModalDraft.id) return;
    const built = buildCodeFromFragment(fragmentModalDraft.title, fragmentModalDraft.description, analysis.codes);
    setWorkspace((prev) => ({
      ...prev,
      customCodebook: prev.customCodebook.some((code) => code.slug === built.slug)
        ? prev.customCodebook
        : [...prev.customCodebook, { slug: built.slug, name: built.name, category: 'interpretacion', description: 'Código evolucionado desde fragmento.' }],
      codeAssignments: {
        ...(prev.codeAssignments || {}),
        [String(fragmentModalDraft.id)]: [built.slug],
      },
      fragmentMetaById: {
        ...(prev.fragmentMetaById || {}),
        [String(fragmentModalDraft.id)]: { title: String(fragmentModalDraft.title || '').trim() || built.name },
      },
    }));
    setFragmentModalDraft((prev) => ({ ...prev, linkedCode: built.slug, title: String(prev.title || '').trim() || built.name }));
  };

  const openCodeModal = (codeSlug) => {
    setActiveCodeSlug(String(codeSlug || ''));
    setCodeModalOpen(true);
  };

  const activeCode = analysis.codes.find((code) => code.slug === activeCodeSlug) || null;
  const activeCodeIsCustom = Boolean(workspace.customCodebook.some((code) => code.slug === activeCodeSlug));
  const activeCodeFragments = useMemo(() => analysis.fragments.filter((fragment) => String(fragment.codeSlugs || '').includes(activeCodeSlug) || fragment.codeSlugs?.includes(activeCodeSlug)).filter((fragment) => !(workspace.deletedFragmentIds || []).map(String).includes(String(fragment.id))), [activeCodeSlug, analysis.fragments, workspace.deletedFragmentIds]);

  const updateActiveCustomCode = (patch) => {
    if (!activeCodeIsCustom || !activeCodeSlug) return;
    setWorkspace((prev) => ({
      ...prev,
      customCodebook: prev.customCodebook.map((code) => (code.slug === activeCodeSlug ? { ...code, ...patch } : code)),
    }));
  };

  const deleteActiveCode = () => {
    if (!activeCodeSlug) return;
    if (!window.confirm('¿Eliminar código? Se desvinculará de todos los fragmentos.')) return;
    setWorkspace((prev) => {
      const nextAssignments = Object.fromEntries(Object.entries(prev.codeAssignments || {}).map(([fragmentId, slugs]) => [fragmentId, (slugs || []).filter((slug) => slug !== activeCodeSlug)]));
      return {
        ...prev,
        customCodebook: prev.customCodebook.filter((code) => code.slug !== activeCodeSlug),
        codeAssignments: nextAssignments,
      };
    });
    setCodeModalOpen(false);
  };

  const updateClusterName = (slug, name) => {
    setWorkspace((prev) => ({
      ...prev,
      clusterNameOverrides: {
        ...prev.clusterNameOverrides,
        [slug]: name,
      },
    }));
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="text-base font-semibold text-slate-900">Laboratorio semántico cualitativo</h3>
        <p className="text-xs text-slate-500">Flujo científico: entrevista → fragmentos → códigos → clusters → distribución → mapa semántico. Toda conclusión mantiene trazabilidad a evidencia.</p>
        <div className="mt-3 grid md:grid-cols-7 gap-2">
          <select className="border rounded p-2" value={filters.audience_id} onChange={(e) => setFilters((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="border rounded p-2" value={filters.form_id} onChange={(e) => setFilters((prev) => ({ ...prev, form_id: e.target.value }))}><option value="">Formulario</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
          <select className="border rounded p-2" value={filters.client_id} onChange={(e) => setFilters((prev) => ({ ...prev, client_id: e.target.value }))}><option value="">Cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className="border rounded p-2" type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} />
          <input className="border rounded p-2" type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} />
          <select className="border rounded p-2" value={filters.minProblem} onChange={(e) => setFilters((prev) => ({ ...prev, minProblem: e.target.value }))}><option value="">Min score problema</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
          <select className="border rounded p-2" value={filters.minSolution} onChange={(e) => setFilters((prev) => ({ ...prev, minSolution: e.target.value }))}><option value="">Min score solución</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
        </div>
      </div>

      <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className={card}><p className="text-xs text-slate-500">Entrevistas</p><p className="text-2xl font-semibold">{analysis.dashboard.interviewsAnalyzed}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Fragmentos analizados</p><p className="text-2xl font-semibold">{analysis.dashboard.fragmentsAnalyzed}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Fragmentos codificados</p><p className="text-2xl font-semibold">{analysis.dashboard.codedFragments}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Clusters activos</p><p className="text-2xl font-semibold">{analysis.dashboard.clustersDetected}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Audiencias incluidas</p><p className="text-sm font-semibold">{analysis.dashboard.audiencesIncluded.length || 0}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Formularios incluidos</p><p className="text-sm font-semibold">{analysis.dashboard.formsIncluded.length || 0}</p></div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex flex-wrap gap-2">
        {[
          { id: 'interviews', label: 'Entrevistas' },
          { id: 'fragments', label: 'Fragmentos' },
          { id: 'codes', label: 'Códigos' },
          { id: 'clusters', label: 'Clusters' },
          { id: 'distribution', label: 'Distribución / mapa' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${tabButton} ${activeTab === tab.id ? 'bg-white border-slate-300 text-slate-900' : 'bg-transparent border-transparent text-slate-600 hover:bg-white'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'interviews' && (
        <div className="grid lg:grid-cols-[1.1fr_1.4fr] gap-4">
          <div className={card}>
            <h4 className="font-semibold text-slate-900">Entrevistas fuente</h4>
            <p className="text-xs text-slate-500 mt-1">Selecciona una entrevista para extraer fragmentos semánticos con trazabilidad.</p>
            <div className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {analysis.interviews.map((interview) => (
                <button
                  key={interview.id}
                  type="button"
                  onClick={() => setOpenInterviewId(interview.id)}
                  className={`w-full text-left rounded-lg border p-3 transition ${openInterviewId === interview.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <p className="font-medium text-slate-900">{interview.clientName}</p>
                  <p className="text-xs text-slate-500">{interview.audienceName} · {interview.formName}</p>
                  <p className="text-xs text-slate-500">{formatDate(interview.date)} · {interview.interviewer}</p>
                  <p className="mt-1 text-xs text-slate-600">Contexto: {interview.context || 'Sin contexto cargado'}</p>
                </button>
              ))}
              {!analysis.interviews.length && <p className="text-sm text-slate-500">No hay entrevistas para los filtros actuales.</p>}
            </div>
          </div>

          <div className={card}>
            <h4 className="font-semibold text-slate-900">Extracción de fragmentos</h4>
            {!selectedInterview && <p className="text-sm text-slate-500 mt-2">Elige una entrevista para revisar transcripción y crear fragmentos.</p>}
            {selectedInterview && (
              <div className="space-y-3 mt-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-700"><b>Entrevistado:</b> {selectedInterview.clientName}</p>
                  <p className="text-sm text-slate-700"><b>Segmento:</b> {selectedInterview.audienceName}</p>
                  <p className="text-sm text-slate-700"><b>Transcripción:</b> {selectedInterview.transcript ? 'Disponible' : 'Solo respuestas abiertas'}</p>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {selectedInterview.responseTexts.flatMap((response) => response.text.split(/[\n.!?]+/g).map((sentence, idx) => ({
                    sentence: sentence.trim(),
                    questionId: response.questionId,
                    idx,
                  }))).filter((row) => row.sentence.length > 0).map((row) => (
                    <div key={`${row.questionId}_${row.idx}_${row.sentence.slice(0, 12)}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm text-slate-700">{row.sentence}</p>
                      <div className="mt-2 flex justify-end">
                        <Button className="bg-white border" onClick={() => onCreateFragment?.({ interview_id: selectedInterview.id, text: row.sentence, source: 'selection' })}>Convertir en fragmento</Button>
                      </div>
                    </div>
                  ))}
                  {!selectedInterview.responseTexts.length && <p className="text-sm text-slate-500">No hay respuestas abiertas disponibles.</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'fragments' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-indigo-600" /> Fragmentos semánticos</h4>
                <p className="text-xs text-slate-500 mt-1">Lista principal de entidades. Toda edición/codificación/eliminación se resuelve por modal.</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">{pagedFragments.total} fragmentos</span>
            </div>
          </div>

          <div className="p-4">
            <div className="grid gap-2 md:grid-cols-3">
              <input className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" placeholder="Buscar fragmento..." value={fragmentFilters.q} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, q: e.target.value }))} />
              <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={fragmentFilters.audience} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, audience: e.target.value }))}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={fragmentFilters.interview} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, interview: e.target.value }))}><option value="">Entrevista</option>{analysis.interviews.map((i) => <option key={i.id} value={i.id}>{i.clientName}</option>)}</select>
              <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={fragmentFilters.document} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, document: e.target.value }))}><option value="">Documento</option>{[...new Set((normalizedFragments || []).map((f) => String(f.document_id || f.document_node_id || '')).filter(Boolean))].map((docId) => <option key={docId} value={docId}>{docId}</option>)}</select>
              <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={fragmentFilters.source} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, source: e.target.value }))}><option value="">Origen</option><option value="selection">selection</option><option value="manual">manual</option></select>
              <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={fragmentFilters.sort} onChange={(e) => setFragmentFilters((prev) => ({ ...prev, sort: e.target.value }))}><option value="created_desc">Fecha desc</option><option value="created_asc">Fecha asc</option><option value="document_asc">Documento</option></select>
            </div>

            <p className="mt-3 text-xs text-slate-500">Página {pagedFragments.currentPage}/{pagedFragments.totalPages}</p>
            <div className="mt-3 space-y-2 max-h-[540px] overflow-y-auto pr-1">
              {pagedFragments.rows.map((fragment) => {
                const interview = interviewById[String(fragment.interview_id)];
                const isSelected = selectedFragmentId === fragment.id;
                const isCoded = fragment.codeSlugs.length > 0;
                const customTitle = workspace.fragmentMetaById?.[String(fragment.id)]?.title;
                return (
                  <div key={fragment.id} className={`rounded-xl border p-3 transition ${isSelected ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-500">Frag. {fragment.id}</p>
                        <p className="text-sm font-medium text-slate-900">{customTitle || 'Fragmento sin título'}</p>
                      </div>
                      <button type="button" className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50" onClick={() => openFragmentModal(fragment)} title="Gestionar fragmento">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>

                    <p className="mt-1 text-sm leading-5 text-slate-800">{fragment.text}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{interview?.clientName || 'Sin entrevista'} · pos {fragment.position} · origen {fragment.sourceType}</p>
                    <p className="text-[11px] text-slate-500">doc {fragment.document_id || fragment.metadata?.document_node_id || '—'} · {fragment.created_at ? formatDate(fragment.created_at) : 'sin fecha'}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isCoded ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{isCoded ? 'Codificado' : 'Sin código'}</span>
                      {fragment.codeSlugs.map((slug) => (
                        <button key={slug} type="button" onClick={() => openCodeModal(slug)} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100">
                          <Tag className="h-3 w-3" />{slug}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <Button className="bg-white border" onClick={() => setFragmentPage((p) => Math.max(1, p - 1))} disabled={pagedFragments.currentPage <= 1}>Anterior</Button>
              <Button className="bg-white border" onClick={() => setFragmentPage((p) => Math.min(pagedFragments.totalPages, p + 1))} disabled={pagedFragments.currentPage >= pagedFragments.totalPages}>Siguiente</Button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'codes' && (
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BookOpen className="h-4 w-4 text-indigo-600" /> Codebook</h4>
              <p className="text-xs text-slate-500 mt-1">Diccionario de conceptos semánticos con trazabilidad de uso.</p>
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto p-4 pr-3">
              {analysis.codes.map((code) => (
                <div key={code.slug} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{code.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500"><Braces className="h-3.5 w-3.5" />{code.slug}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${codeCategoryTone[code.category] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{code.category}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{code.description || 'Sin descripción'}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="rounded bg-slate-100 px-2 py-0.5">{code.fragmentCount} fragmentos</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5">{code.interviewCount} entrevistas</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Tag className="h-4 w-4 text-indigo-600" /> Crear código</h4>
              <p className="text-xs text-slate-500 mt-1">Extiende el modelo semántico con una entidad consistente y trazable.</p>
            </div>

            <div className="p-4">
              <div className="grid gap-2">
                <input className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={newCode.name} onChange={(e) => setNewCode((prev) => ({ ...prev, name: e.target.value }))} placeholder="Nombre visible" />
                <input className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={newCode.slug} onChange={(e) => setNewCode((prev) => ({ ...prev, slug: e.target.value }))} placeholder="slug_estable (opcional)" />
                <select className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" value={newCode.category} onChange={(e) => setNewCode((prev) => ({ ...prev, category: e.target.value }))}>
                  {['tipo_problema', 'interpretacion', 'emocion', 'comportamiento', 'intento_solucion'].map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <textarea className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-300 focus:bg-white" rows={4} value={newCode.description} onChange={(e) => setNewCode((prev) => ({ ...prev, description: e.target.value }))} placeholder="Descripción opcional" />
                <Button className="bg-slate-900 text-white" onClick={createCode}>Agregar al codebook</Button>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p>Códigos base cargados: <span className="font-semibold text-slate-800">{defaultSemanticCodebook.length}</span>.</p>
                <p className="mt-1">Clusters base disponibles: <span className="font-semibold text-slate-800">{defaultSemanticClusters.length}</span>.</p>
              </div>
            </div>
          </div>
        </div>
      )}


      {fragmentModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-900">Gestionar fragmento</h4>
              <Button className="bg-white border" onClick={() => setFragmentModalOpen(false)}>Cerrar</Button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título</p>
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={fragmentModalDraft.title} onChange={(e) => setFragmentModalDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="Título del fragmento" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción / texto</p>
                <textarea className="mt-1 h-24 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" value={fragmentModalDraft.description} readOnly />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Códigos vinculados</p>
                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {(analysis.codes || []).map((code) => {
                    const fragment = analysis.fragments.find((row) => String(row.id) === String(fragmentModalDraft.id));
                    const checked = Boolean(fragment?.codeSlugs?.includes(code.slug));
                    return (
                      <label key={code.slug} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
                        <input type="checkbox" checked={checked} onChange={() => toggleFragmentCode(String(fragmentModalDraft.id), code.slug)} />
                        <span className="font-medium text-slate-700">{code.name}</span>
                        <button type="button" className="ml-auto text-indigo-600 hover:text-indigo-700" onClick={() => openCodeModal(code.slug)}>ver</button>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button className="bg-white border" onClick={saveFragmentMeta}><Pencil className="mr-1 h-4 w-4" />Guardar</Button>
                <Button className="bg-white border" onClick={evolveFragmentToCodeFromModal}><Code2 className="mr-1 h-4 w-4" />Evolucionar a código</Button>
                <Button className="bg-white border text-rose-700" onClick={() => deleteFragment(fragmentModalDraft.id)}><Trash2 className="mr-1 h-4 w-4" />Eliminar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {codeModalOpen && activeCode ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-900">Gestionar código</h4>
              <Button className="bg-white border" onClick={() => setCodeModalOpen(false)}>Cerrar</Button>
            </div>

            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre</p>
                  <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={activeCode.name} onChange={(e) => updateActiveCustomCode({ name: e.target.value })} readOnly={!activeCodeIsCustom} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slug</p>
                  <input className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" value={activeCode.slug} readOnly />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</p>
                <textarea className="mt-1 h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={activeCode.description || ''} onChange={(e) => updateActiveCustomCode({ description: e.target.value })} readOnly={!activeCodeIsCustom} />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fragmentos vinculados</p>
                <div className="mt-1 max-h-36 space-y-1 overflow-y-auto pr-1">
                  {activeCodeFragments.map((fragment) => (
                    <div key={fragment.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
                      <span className="line-clamp-1 text-slate-700">{fragment.text}</span>
                      <button type="button" className="ml-auto text-indigo-600" onClick={() => { setCodeModalOpen(false); openFragmentModal(fragment); }}>abrir</button>
                    </div>
                  ))}
                  {!activeCodeFragments.length ? <p className="text-xs text-slate-500">Sin fragmentos vinculados.</p> : null}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button className="bg-white border text-rose-700" onClick={deleteActiveCode} disabled={!activeCodeIsCustom}><Trash2 className="mr-1 h-4 w-4" />Eliminar código</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'clusters' && (
        <div className={card}>
          <h4 className="font-semibold text-slate-900">Clusters semánticos</h4>
          <p className="text-xs text-slate-500 mt-1">Cada cluster agrupa códigos y evidencia narrativa trazable.</p>
          <div className="mt-3 space-y-3">
            {analysis.clusters.map((cluster) => (
              <div key={cluster.slug} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <input
                    className="text-base font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-slate-300 focus:outline-none"
                    value={cluster.name}
                    onChange={(e) => updateClusterName(cluster.slug, e.target.value)}
                  />
                  <Button className="bg-white border" onClick={() => setOpenCluster((prev) => (prev === cluster.slug ? null : cluster.slug))}>{openCluster === cluster.slug ? 'Cerrar' : 'Explorar'}</Button>
                </div>
                <p className="text-sm text-slate-600">{cluster.description}</p>
                <p className="mt-1 text-xs text-slate-500">{cluster.interviewCount} entrevistas · {cluster.fragmentCount} fragmentos · audiencias: {cluster.audiences.join(', ') || '—'}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {cluster.dominantCodes.map((entry) => (
                    <span key={entry.slug} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{entry.slug} ({entry.count})</span>
                  ))}
                </div>
                {openCluster === cluster.slug && (
                  <div className="mt-3 grid lg:grid-cols-2 gap-3">
                    <div className="rounded border border-slate-200 p-2 bg-slate-50">
                      <p className="text-xs font-medium text-slate-700">Fragmentos relacionados</p>
                      <div className="mt-2 space-y-2 max-h-52 overflow-y-auto pr-1">
                        {cluster.fragments.slice(0, 20).map((fragment) => (
                          <button
                            key={fragment.id}
                            type="button"
                            onClick={() => {
                              setActiveTab('fragments');
                              setSelectedFragmentId(fragment.id);
                            }}
                            className="w-full text-left rounded border border-slate-200 bg-white p-2 text-sm hover:border-slate-300"
                          >
                            {fragment.text}
                            <span className="block text-[11px] text-slate-500 mt-1">{fragment.originRef}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 p-2 bg-slate-50">
                      <p className="text-xs font-medium text-slate-700">Entrevistas fuente</p>
                      <div className="mt-2 space-y-2">
                        {cluster.interviews.slice(0, 12).map((interview) => (
                          <div key={interview.id} className="rounded border border-slate-200 bg-white p-2 text-sm flex items-center justify-between gap-2">
                            <div>
                              <p className="text-slate-800">{interview.clientName}</p>
                              <p className="text-xs text-slate-500">{interview.audienceName} · {formatDate(interview.date)}</p>
                            </div>
                            <Button className="bg-white border" onClick={() => onOpenSession?.(interview.id)}>Abrir entrevista</Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'distribution' && (
        <div className="grid xl:grid-cols-[1.1fr_1fr] gap-4">
          <div className={card}>
            <h4 className="font-semibold text-slate-900">Distribución de clusters</h4>
            <div className="mt-3 space-y-2">
              {analysis.distribution.map((item) => (
                <div key={item.slug} className="rounded border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.interviews} entrevistas · {item.fragments} fragmentos</p>
                  <p className="text-xs text-slate-500">Audiencias: {item.audiences.join(', ') || '—'}</p>
                </div>
              ))}
            </div>
            <h5 className="font-semibold text-slate-900 mt-4">Saturación semántica por audiencia</h5>
            <div className="mt-2 space-y-2">
              {analysis.saturationByAudience.map((entry) => (
                <div key={entry.audienceName} className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{entry.audienceName}</p>
                  <p className="text-xs text-slate-500">{entry.interviews} entrevistas · {entry.fragments} fragmentos · señal de saturación: {entry.hasSaturationSignal ? 'Sí' : 'No'}</p>
                  <p className="text-xs text-slate-500">Clusters repetidos: {entry.repeatedClusters.map((cluster) => `${cluster.slug} (${cluster.count})`).join(', ') || '—'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={card}>
            <h4 className="font-semibold text-slate-900">Mapa semántico del mercado</h4>
            <p className="text-xs text-slate-500 mt-1">Relación cluster ↔ código con peso por evidencia.</p>
            <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {analysis.semanticMap.edges.map((edge) => (
                <div key={`${edge.from}_${edge.to}`} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  {edge.from.replace('cluster:', '')} → {edge.to.replace('code:', '')} · peso {edge.weight}
                </div>
              ))}
            </div>
            <h5 className="font-semibold text-slate-900 mt-4">Output analítico</h5>
            <div className="mt-2 space-y-2 text-sm">
              <p><b>Problemas dominantes:</b> {analysis.output.dominantProblems.map((item) => item.name).join(', ') || '—'}</p>
              <p><b>Emociones principales:</b> {analysis.output.dominantEmotions.map((item) => item.name).join(', ') || '—'}</p>
              <p><b>Comportamientos recurrentes:</b> {analysis.output.recurrentBehaviors.map((item) => item.name).join(', ') || '—'}</p>
              <p><b>Narrativas del mercado:</b> {analysis.output.marketNarratives.map((item) => item.name).join(', ') || '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
