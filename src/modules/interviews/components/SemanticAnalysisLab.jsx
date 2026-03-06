import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getLeanProblemScore, getLeanSolutionScore } from '@/modules/interviews/components/LeanEvaluationPanel';
import { buildSemanticAnalysis } from '@/modules/interviews/services/semanticAnalysis';

const card = 'rounded-xl border border-slate-200 bg-white p-4';

export const SemanticAnalysisLab = ({ sessions = [], audiences = [], forms = [], clients = [], onOpenSession }) => {
  const [filters, setFilters] = useState({ audience_id: '', form_id: '', client_id: '', from: '', to: '', minProblem: '', minSolution: '' });
  const [openClusterId, setOpenClusterId] = useState(null);
  const [openThemeId, setOpenThemeId] = useState(null);
  const [openTopicId, setOpenTopicId] = useState(null);

  const filteredSessions = useMemo(() => sessions.filter((session) => {
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
  }).map((session) => {
    const evaluation = session.responses_json?.__lean_evaluation || {};
    return {
      ...session,
      __problemScore: getLeanProblemScore(evaluation),
      __solutionScore: getLeanSolutionScore(evaluation),
    };
  }), [sessions, filters]);

  const audiencesById = useMemo(() => Object.fromEntries(audiences.map((audience) => [String(audience.id), audience])), [audiences]);
  const formsById = useMemo(() => Object.fromEntries(forms.map((form) => [String(form.id), form])), [forms]);
  const clientsById = useMemo(() => Object.fromEntries(clients.map((client) => [String(client.id), client])), [clients]);

  const analysis = useMemo(() => buildSemanticAnalysis({
    sessions: filteredSessions,
    audiencesById,
    formsById,
    clientsById,
  }), [filteredSessions, audiencesById, formsById, clientsById]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="text-base font-semibold text-slate-900">Laboratorio de análisis semántico</h3>
        <p className="text-xs text-slate-500">Capa analítica híbrida sobre evidencia existente (lingüística clásica + heurística semántica tipo embeddings).</p>
        <div className="mt-3 grid md:grid-cols-7 gap-2">
          <select className="border rounded p-2" value={filters.audience_id} onChange={(e) => setFilters((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select className="border rounded p-2" value={filters.form_id} onChange={(e) => setFilters((prev) => ({ ...prev, form_id: e.target.value }))}><option value="">Formulario</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
          <select className="border rounded p-2" value={filters.client_id} onChange={(e) => setFilters((prev) => ({ ...prev, client_id: e.target.value }))}><option value="">Cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className="border rounded p-2" type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} />
          <input className="border rounded p-2" type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} />
          <select className="border rounded p-2" value={filters.minProblem} onChange={(e) => setFilters((prev) => ({ ...prev, minProblem: e.target.value }))}><option value="">Min score problema</option>{[1,2,3,4,5].map((n)=><option key={n} value={n}>{n}+</option>)}</select>
          <select className="border rounded p-2" value={filters.minSolution} onChange={(e) => setFilters((prev) => ({ ...prev, minSolution: e.target.value }))}><option value="">Min score solución</option>{[1,2,3,4,5].map((n)=><option key={n} value={n}>{n}+</option>)}</select>
        </div>
      </div>

      <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className={card}><p className="text-xs text-slate-500">Entrevistas analizadas</p><p className="text-2xl font-semibold">{analysis.dashboard.interviewsAnalyzed}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Respuestas abiertas</p><p className="text-2xl font-semibold">{analysis.dashboard.openResponses}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Audiencias incluidas</p><p className="text-2xl font-semibold">{analysis.dashboard.audiencesIncluded.length}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Formularios incluidos</p><p className="text-2xl font-semibold">{analysis.dashboard.formsIncluded.length}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Temas principales</p><p className="text-sm font-semibold">{analysis.dashboard.mainThemes.slice(0, 2).join(' · ') || '—'}</p></div>
        <div className={card}><p className="text-xs text-slate-500">Nivel emocional promedio</p><p className="text-2xl font-semibold">{analysis.dashboard.averageEmotionLevel ?? '—'}</p></div>
      </div>

      <div className={card}>
        <h4 className="font-semibold">Clusters semánticos</h4>
        <div className="mt-2 space-y-2">
          {!analysis.clusters.length ? <p className="text-sm text-slate-500">Sin clusters con los filtros actuales.</p> : analysis.clusters.map((cluster) => (
            <div key={cluster.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{cluster.name}</p>
                  <p className="text-xs text-slate-500">{cluster.count} respuestas · Audiencias: {cluster.audiences.join(', ') || '—'}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">Problema {cluster.problemScore ?? '—'}</span>
                  <span className="px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700">Solución {cluster.solutionScore ?? '—'}</span>
                  <Button className="bg-white border" onClick={() => setOpenClusterId((prev) => prev === cluster.id ? null : cluster.id)}>{openClusterId === cluster.id ? 'Cerrar' : 'Abrir'}</Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-700">Frases representativas: {cluster.representativePhrases.join(' · ') || '—'}</p>
              {openClusterId === cluster.id && (
                <div className="mt-3 space-y-2">
                  {cluster.rows.map((row, idx) => (
                    <div key={`${cluster.id}_${idx}`} className="bg-slate-50 border rounded p-2 text-sm">
                      <p>{row.text}</p>
                      <div className="mt-1 flex gap-2">
                        <Button className="bg-white border" onClick={() => onOpenSession?.(row.session.id)}>Abrir entrevista</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}>
          <h4 className="font-semibold">Análisis de sentimientos</h4>
          <p className="text-sm text-slate-600 mt-1">Polaridad promedio: <b>{analysis.sentiment.averagePolarity ?? '—'}</b> · Intensidad promedio: <b>{analysis.sentiment.averageIntensity ?? '—'}</b></p>
          <p className="text-sm text-slate-600 mt-1">Palabras emocionales dominantes: {analysis.sentiment.dominantEmotionalWords.map((item) => item.term).join(', ') || '—'}</p>
          <div className="mt-3 space-y-2">
            {analysis.sentiment.interviewsHighIntensity.map((session) => (
              <div key={session.id} className="flex items-center justify-between border rounded p-2 text-sm">
                <p>{session.client_name} · {session.form_title}</p>
                <Button className="bg-white border" onClick={() => onOpenSession?.(session.id)}>Ver evidencia</Button>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h4 className="font-semibold">Análisis temático</h4>
          <div className="mt-2 space-y-2">
            {analysis.themes.slice(0, 8).map((theme) => (
              <div key={theme.id} className="border rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{theme.name}</p>
                  <Button className="bg-white border" onClick={() => setOpenThemeId((prev) => prev === theme.id ? null : theme.id)}>{openThemeId === theme.id ? 'Cerrar' : 'Explorar'}</Button>
                </div>
                <p className="text-xs text-slate-500">Frecuencia: {theme.frequency} · Problema {theme.problemScore ?? '—'} · Solución {theme.solutionScore ?? '—'}</p>
                <p className="text-xs text-slate-500">Keywords: {theme.keywords.join(', ') || '—'}</p>
                {openThemeId === theme.id && <p className="text-sm mt-1">Ejemplos: {theme.examples.join(' · ') || '—'}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={card}>
        <h4 className="font-semibold">Topic modeling (embeddings semánticos, aproximación local)</h4>
        <div className="mt-2 space-y-2">
          {analysis.topics.map((topic) => (
            <div key={topic.id} className="border rounded p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{topic.label}</p>
                <Button className="bg-white border" onClick={() => setOpenTopicId((prev) => prev === topic.id ? null : topic.id)}>{openTopicId === topic.id ? 'Cerrar' : 'Abrir topic'}</Button>
              </div>
              <p className="text-xs text-slate-500">Keywords: {topic.keywords.join(', ') || '—'}</p>
              {openTopicId === topic.id && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm">Frases: {topic.phrases.join(' · ') || '—'}</p>
                  <p className="text-xs text-slate-500">Audiencias: {topic.audiences.join(', ') || '—'}</p>
                  <div className="flex flex-wrap gap-1">
                    {topic.relatedSessions.slice(0, 6).map((session) => <Button key={session.id} className="bg-white border" onClick={() => onOpenSession?.(session.id)}>{session.client_name || `Sesión ${session.id}`}</Button>)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h4 className="font-semibold">Lenguaje real del mercado</h4>
        <div className="grid lg:grid-cols-2 gap-3 mt-2">
          <div className="border rounded p-3">
            <p className="text-sm font-medium">Frases más repetidas</p>
            <ul className="text-sm mt-1 list-disc pl-4">{analysis.marketLanguage.repeatedPhrases.slice(0, 8).map((item) => <li key={item.term}>{item.term} ({item.count})</li>)}</ul>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm font-medium">Expresiones emocionales dominantes</p>
            <ul className="text-sm mt-1 list-disc pl-4">{analysis.marketLanguage.dominantEmotionalExpressions.slice(0, 8).map((item, idx) => <li key={`${item.phrase}_${idx}`}>{item.phrase}</li>)}</ul>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm font-medium">Frases asociadas a score problema alto</p>
            <ul className="text-sm mt-1 list-disc pl-4">{analysis.marketLanguage.highProblemPhrases.slice(0, 8).map((phrase, idx) => <li key={`${phrase}_${idx}`}>{phrase}</li>)}</ul>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm font-medium">Frases asociadas a score solución alto</p>
            <ul className="text-sm mt-1 list-disc pl-4">{analysis.marketLanguage.highSolutionPhrases.slice(0, 8).map((phrase, idx) => <li key={`${phrase}_${idx}`}>{phrase}</li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
};
