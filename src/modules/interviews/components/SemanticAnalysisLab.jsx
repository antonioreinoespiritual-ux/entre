import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Braces, Hash, Link2, Sparkles, Tag } from 'lucide-react';
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
  });

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
    const rows = analysis.fragments.filter((fragment) => {
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
  }, [analysis.fragments, fragmentFilters, interviewById]);

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
        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-indigo-600" /> Fragmentos semánticos</h4>
                  <p className="text-xs text-slate-500 mt-1">Unidades de evidencia documentada con metadata escaneable y estado de codificación.</p>
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

              <div className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {pagedFragments.rows.map((fragment) => {
                  const interview = interviewById[String(fragment.interview_id)];
                  const isSelected = selectedFragmentId === fragment.id;
                  const isCoded = fragment.codeSlugs.length > 0;
                  return (
                    <div
                      key={fragment.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedFragmentId(fragment.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedFragmentId(fragment.id); } }}
                      className={`group rounded-xl border p-3 transition ${isSelected ? 'border-indigo-300 bg-indigo-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Hash className="h-3.5 w-3.5" />
                          <span>Frag. {fragment.id}</span>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isCoded ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{isCoded ? 'Codificado' : 'Sin código'}</span>
                      </div>

                      <p className="text-sm leading-5 text-slate-800">{fragment.text}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{interview?.clientName || 'Sin entrevista'} · pos {fragment.position} · origen {fragment.sourceType}</p>
                      <p className="text-[11px] text-slate-500">doc {fragment.document_id || fragment.metadata?.document_node_id || '—'} · {fragment.created_at ? formatDate(fragment.created_at) : 'sin fecha'}</p>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {fragment.codeSlugs.map((slug) => (
                          <span key={slug} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700"><Tag className="h-3 w-3" />{slug}</span>
                        ))}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        {fragment.interview_id ? <Button className="h-7 bg-white border text-xs" onClick={(event) => { event.stopPropagation(); onOpenSession?.(fragment.interview_id); }}>Abrir entrevista</Button> : <span />}
                        {fragment.document_id || fragment.metadata?.document_node_id ? <span className="text-[10px] text-slate-500">{fragment.document_id || fragment.metadata?.document_node_id}</span> : null}
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

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Link2 className="h-4 w-4 text-indigo-600" /> Codificación del fragmento</h4>
              <p className="text-xs text-slate-500 mt-1">Asigna y gestiona códigos con trazabilidad directa al fragmento seleccionado.</p>
            </div>

            <div className="p-4">
              {!selectedFragment && <p className="text-sm text-slate-500">Selecciona un fragmento para asignarle códigos.</p>}
              {selectedFragment && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm text-slate-700">{selectedFragment.text}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Fragmento: {selectedFragment.id}</p>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                    {analysis.codes.map((code) => {
                      const checked = selectedFragment.codeSlugs.includes(code.slug);
                      return (
                        <label key={code.slug} className={`flex items-start gap-2 rounded-xl border p-2.5 transition ${checked ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFragmentCode(selectedFragment.id, code.slug)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="text-sm font-medium text-slate-800">{code.name}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{code.category} · {code.description || 'Sin descripción'}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
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
