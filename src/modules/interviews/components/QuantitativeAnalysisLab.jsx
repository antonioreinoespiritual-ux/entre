import React, { useMemo, useState } from 'react';
import { BarChart3, Filter, Sigma } from 'lucide-react';
import { leanProblemVariables, leanSolutionVariables, getLeanProblemScore, getLeanSolutionScore } from '@/modules/interviews/components/LeanEvaluationPanel';
import { Button } from '@/components/ui/button';

const allVariables = [...leanProblemVariables, ...leanSolutionVariables];

const average = (values = []) => {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return Number((clean.reduce((acc, value) => acc + value, 0) / clean.length).toFixed(2));
};

const scoreLabel = (problem, solution) => {
  if (problem == null || solution == null) return 'Muestra insuficiente';
  if (problem >= 4 && solution >= 4) return 'Hipótesis prometedora';
  if (problem >= 4 && solution < 3) return 'Problema fuerte, solución débil';
  if (problem < 3 && solution >= 4) return 'Solución fuerte, dolor débil';
  if (problem < 3 && solution < 3) return 'Segmento poco convincente';
  return 'Señal moderada';
};

const BarComparison = ({ title, rows = [], keyName = 'name', metric = 'problemScore', color = 'bg-indigo-500' }) => {
  const max = Math.max(...rows.map((row) => Number(row[metric] || 0)), 1);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.id || row[keyName]}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
              <span className="truncate">{row[keyName]}</span>
              <span className="font-semibold">{Number(row[metric] || 0).toFixed(2)}</span>
            </div>
            <div className="h-2 rounded bg-slate-100">
              <div className={`h-2 rounded ${color}`} style={{ width: `${Math.max(6, (Number(row[metric] || 0) / max) * 100)}%` }} />
            </div>
          </div>
        ))}
        {!rows.length ? <p className="text-xs text-slate-500">Sin datos para visualizar.</p> : null}
      </div>
    </div>
  );
};

const Heatmap = ({ title, rows = [], columns = [] }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
    <div className="mt-3 overflow-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-2 text-left">Variable</th>
            {columns.map((column) => <th key={column.id} className="p-2 text-left">{column.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100">
              <td className="sticky left-0 bg-white p-2 font-medium text-slate-700">{row.label}</td>
              {columns.map((column) => {
                const value = row.values[column.id];
                const opacity = value == null ? 0.08 : Math.max(0.15, Number(value) / 5);
                return (
                  <td key={`${row.key}_${column.id}`} className="p-2">
                    <div className="rounded px-2 py-1 text-center text-[11px]" style={{ background: `rgba(79,70,229,${opacity})`, color: value == null ? '#64748b' : '#111827' }}>
                      {value == null ? '—' : Number(value).toFixed(2)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const QuantitativeAnalysisLab = ({ sessions = [], audiences = [], forms = [], clients = [], hypotheses = [], onOpenSession }) => {
  const [groupBy, setGroupBy] = useState('interview');
  const [detailRowId, setDetailRowId] = useState('');
  const [filters, setFilters] = useState({
    hypothesisId: '',
    audienceId: '',
    clientId: '',
    formId: '',
    from: '',
    to: '',
    minProblem: '',
    minSolution: '',
  });

  const catalogs = useMemo(() => ({
    audiencesById: Object.fromEntries(audiences.map((item) => [String(item.id), item])),
    clientsById: Object.fromEntries(clients.map((item) => [String(item.id), item])),
    formsById: Object.fromEntries(forms.map((item) => [String(item.id), item])),
    hypothesesById: Object.fromEntries(hypotheses.map((item) => [String(item.id), item])),
  }), [audiences, clients, forms, hypotheses]);

  const interviewRows = useMemo(() => sessions.map((session) => {
    const evaluation = session.responses_json?.__lean_evaluation || {};
    const problemScore = getLeanProblemScore(evaluation);
    const solutionScore = getLeanSolutionScore(evaluation);
    const variableScores = Object.fromEntries(allVariables.map(([key]) => [key, Number(evaluation[key] || 0) || null]));
    return {
      id: String(session.id),
      sessionId: String(session.id),
      clientId: String(session.client_id || ''),
      audienceId: String(session.audience_id || ''),
      formId: String(session.form_id || ''),
      hypothesisId: String(session.interview_hypothesis_id || ''),
      date: session.created_at || null,
      clientName: catalogs.clientsById[String(session.client_id || '')]?.name || session.client_name || 'Sin cliente',
      audienceName: catalogs.audiencesById[String(session.audience_id || '')]?.name || session.audience_name || 'Sin audiencia',
      formName: catalogs.formsById[String(session.form_id || '')]?.title || session.form_title || 'Sin formulario',
      hypothesisName: catalogs.hypothesesById[String(session.interview_hypothesis_id || '')]?.title || session.hypothesis_title || 'Sin hipótesis',
      problemScore,
      solutionScore,
      variableScores,
    };
  }).filter((row) => row.problemScore != null || row.solutionScore != null), [catalogs, sessions]);

  const filteredInterviews = useMemo(() => interviewRows.filter((row) => {
    if (filters.hypothesisId && row.hypothesisId !== String(filters.hypothesisId)) return false;
    if (filters.audienceId && row.audienceId !== String(filters.audienceId)) return false;
    if (filters.clientId && row.clientId !== String(filters.clientId)) return false;
    if (filters.formId && row.formId !== String(filters.formId)) return false;
    const createdAt = row.date ? new Date(row.date).getTime() : null;
    if (filters.from && createdAt && createdAt < new Date(filters.from).getTime()) return false;
    if (filters.to && createdAt && createdAt > (new Date(filters.to).getTime() + 86400000)) return false;
    if (filters.minProblem && (row.problemScore == null || row.problemScore < Number(filters.minProblem))) return false;
    if (filters.minSolution && (row.solutionScore == null || row.solutionScore < Number(filters.minSolution))) return false;
    return true;
  }), [filters, interviewRows]);

  const groupConfig = {
    interview: { label: 'Entrevistas', key: (row) => row.id, name: (row) => `Entrevista ${row.sessionId}` },
    client: { label: 'Clientes', key: (row) => row.clientId || `client:${row.clientName}`, name: (row) => row.clientName },
    audience: { label: 'Audiencias', key: (row) => row.audienceId || `aud:${row.audienceName}`, name: (row) => row.audienceName },
    form: { label: 'Formularios', key: (row) => row.formId || `form:${row.formName}`, name: (row) => row.formName },
    hypothesis: { label: 'Hipótesis', key: (row) => row.hypothesisId || `hyp:${row.hypothesisName}`, name: (row) => row.hypothesisName },
  };

  const groupedRows = useMemo(() => {
    const config = groupConfig[groupBy] || groupConfig.interview;
    const map = new Map();
    filteredInterviews.forEach((row) => {
      const id = String(config.key(row));
      if (!map.has(id)) {
        map.set(id, { id, name: config.name(row), interviews: [] });
      }
      map.get(id).interviews.push(row);
    });

    return [...map.values()].map((item) => {
      const problemScore = average(item.interviews.map((row) => row.problemScore));
      const solutionScore = average(item.interviews.map((row) => row.solutionScore));
      const variableAverages = Object.fromEntries(allVariables.map(([key]) => [key, average(item.interviews.map((row) => row.variableScores[key]))]));
      return {
        ...item,
        interviewsCount: item.interviews.length,
        problemScore,
        solutionScore,
        variableAverages,
        quickReading: scoreLabel(problemScore, solutionScore),
      };
    }).sort((a, b) => (b.problemScore || 0) - (a.problemScore || 0));
  }, [filteredInterviews, groupBy]);

  const kpis = useMemo(() => {
    const bestAudienceProblem = [...groupedRows].filter((row) => row.problemScore != null && groupBy === 'audience').sort((a, b) => b.problemScore - a.problemScore)[0];
    const bestAudienceSolution = [...groupedRows].filter((row) => row.solutionScore != null && groupBy === 'audience').sort((a, b) => b.solutionScore - a.solutionScore)[0];
    const hypothesisRows = (() => {
      const map = new Map();
      filteredInterviews.forEach((row) => {
        const id = row.hypothesisId || `hyp:${row.hypothesisName}`;
        if (!map.has(id)) map.set(id, { id, name: row.hypothesisName, rows: [] });
        map.get(id).rows.push(row);
      });
      return [...map.values()].map((item) => ({
        ...item,
        problemScore: average(item.rows.map((row) => row.problemScore)),
        solutionScore: average(item.rows.map((row) => row.solutionScore)),
      }));
    })();

    const bestHypothesisProblem = [...hypothesisRows].filter((row) => row.problemScore != null).sort((a, b) => b.problemScore - a.problemScore)[0];
    const bestHypothesisSolution = [...hypothesisRows].filter((row) => row.solutionScore != null).sort((a, b) => b.solutionScore - a.solutionScore)[0];

    return {
      interviewsCount: filteredInterviews.length,
      avgProblem: average(filteredInterviews.map((row) => row.problemScore)),
      avgSolution: average(filteredInterviews.map((row) => row.solutionScore)),
      bestAudienceProblem: bestAudienceProblem?.name || '—',
      bestAudienceSolution: bestAudienceSolution?.name || '—',
      bestHypothesisProblem: bestHypothesisProblem?.name || '—',
      bestHypothesisSolution: bestHypothesisSolution?.name || '—',
    };
  }, [filteredInterviews, groupedRows, groupBy]);

  const audienceComparisons = useMemo(() => {
    const map = new Map();
    filteredInterviews.forEach((row) => {
      const id = row.audienceId || `aud:${row.audienceName}`;
      if (!map.has(id)) map.set(id, { id, name: row.audienceName, rows: [] });
      map.get(id).rows.push(row);
    });
    return [...map.values()].map((item) => ({
      id: item.id,
      name: item.name,
      problemScore: average(item.rows.map((row) => row.problemScore)),
      solutionScore: average(item.rows.map((row) => row.solutionScore)),
    })).sort((a, b) => (b.problemScore || 0) - (a.problemScore || 0));
  }, [filteredInterviews]);

  const hypothesisComparisons = useMemo(() => {
    const map = new Map();
    filteredInterviews.forEach((row) => {
      const id = row.hypothesisId || `hyp:${row.hypothesisName}`;
      if (!map.has(id)) map.set(id, { id, name: row.hypothesisName, rows: [] });
      map.get(id).rows.push(row);
    });
    return [...map.values()].map((item) => ({
      id: item.id,
      name: item.name,
      problemScore: average(item.rows.map((row) => row.problemScore)),
      solutionScore: average(item.rows.map((row) => row.solutionScore)),
    })).sort((a, b) => (b.problemScore || 0) - (a.problemScore || 0));
  }, [filteredInterviews]);

  const distribution = useMemo(() => {
    const buckets = [1, 2, 3, 4, 5].map((value) => ({ value, problem: 0, solution: 0 }));
    filteredInterviews.forEach((row) => {
      const p = Math.round(Number(row.problemScore || 0));
      const s = Math.round(Number(row.solutionScore || 0));
      const pBucket = buckets.find((item) => item.value === p);
      const sBucket = buckets.find((item) => item.value === s);
      if (pBucket) pBucket.problem += 1;
      if (sBucket) sBucket.solution += 1;
    });
    return buckets;
  }, [filteredInterviews]);

  const heatmapRowsByAudience = useMemo(() => allVariables.map(([key, label]) => ({
    key,
    label,
    values: Object.fromEntries(audienceComparisons.map((audience) => [audience.id, average(filteredInterviews.filter((row) => (row.audienceId || `aud:${row.audienceName}`) === audience.id).map((row) => row.variableScores[key]))])),
  })), [audienceComparisons, filteredInterviews]);

  const heatmapRowsByHypothesis = useMemo(() => allVariables.map(([key, label]) => ({
    key,
    label,
    values: Object.fromEntries(hypothesisComparisons.map((hypothesis) => [hypothesis.id, average(filteredInterviews.filter((row) => (row.hypothesisId || `hyp:${row.hypothesisName}`) === hypothesis.id).map((row) => row.variableScores[key]))])),
  })), [filteredInterviews, hypothesisComparisons]);

  const selectedDetail = groupedRows.find((row) => row.id === detailRowId) || null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sigma className="h-4 w-4 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">Análisis cuantitativo</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-8">
          <select className="rounded border p-2 text-sm" value={filters.hypothesisId} onChange={(e) => setFilters((prev) => ({ ...prev, hypothesisId: e.target.value }))}><option value="">Hipótesis</option>{hypotheses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <select className="rounded border p-2 text-sm" value={filters.audienceId} onChange={(e) => setFilters((prev) => ({ ...prev, audienceId: e.target.value }))}><option value="">Audiencia</option>{audiences.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="rounded border p-2 text-sm" value={filters.clientId} onChange={(e) => setFilters((prev) => ({ ...prev, clientId: e.target.value }))}><option value="">Cliente</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="rounded border p-2 text-sm" value={filters.formId} onChange={(e) => setFilters((prev) => ({ ...prev, formId: e.target.value }))}><option value="">Formulario</option>{forms.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <input className="rounded border p-2 text-sm" type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} />
          <input className="rounded border p-2 text-sm" type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} />
          <select className="rounded border p-2 text-sm" value={filters.minProblem} onChange={(e) => setFilters((prev) => ({ ...prev, minProblem: e.target.value }))}><option value="">Min score problema</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
          <select className="rounded border p-2 text-sm" value={filters.minSolution} onChange={(e) => setFilters((prev) => ({ ...prev, minSolution: e.target.value }))}><option value="">Min score solución</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Entrevistas evaluadas', kpis.interviewsCount],
          ['Promedio score problema', kpis.avgProblem ?? '—'],
          ['Promedio score solución', kpis.avgSolution ?? '—'],
          ['Mejor audiencia (problema)', kpis.bestAudienceProblem],
          ['Mejor audiencia (solución)', kpis.bestAudienceSolution],
          ['Mejor hipótesis (problema)', kpis.bestHypothesisProblem],
          ['Mejor hipótesis (solución)', kpis.bestHypothesisSolution],
          ['Lectura general', scoreLabel(kpis.avgProblem, kpis.avgSolution)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Filter className="h-4 w-4 text-indigo-600" />Tabla analítica</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Agrupar por</span>
            <select className="rounded border p-1.5 text-xs" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="interview">Entrevistas</option>
              <option value="client">Clientes</option>
              <option value="audience">Audiencias</option>
              <option value="form">Formularios</option>
              <option value="hypothesis">Hipótesis</option>
            </select>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="px-2 py-2">Entidad</th>
                <th className="px-2 py-2">Entrevistas</th>
                <th className="px-2 py-2">Score problema</th>
                <th className="px-2 py-2">Score solución</th>
                <th className="px-2 py-2">Lectura</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-b hover:bg-slate-50" onClick={() => setDetailRowId(row.id)}>
                  <td className="px-2 py-2 font-medium text-slate-900">{row.name}</td>
                  <td className="px-2 py-2">{row.interviewsCount}</td>
                  <td className="px-2 py-2">{row.problemScore ?? '—'}</td>
                  <td className="px-2 py-2">{row.solutionScore ?? '—'}</td>
                  <td className="px-2 py-2 text-xs text-slate-600">{row.quickReading}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!groupedRows.length ? <p className="py-3 text-sm text-slate-500">No hay datos para los filtros seleccionados.</p> : null}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <BarComparison title="Score problema por audiencia" rows={audienceComparisons.slice(0, 8)} metric="problemScore" color="bg-indigo-500" />
        <BarComparison title="Score solución por audiencia" rows={audienceComparisons.slice(0, 8)} metric="solutionScore" color="bg-sky-500" />
        <BarComparison title="Score problema por hipótesis" rows={hypothesisComparisons.slice(0, 8)} metric="problemScore" color="bg-violet-500" />
        <BarComparison title="Score solución por hipótesis" rows={hypothesisComparisons.slice(0, 8)} metric="solutionScore" color="bg-emerald-500" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Heatmap title="Heatmap: Variables vs Audiencias" rows={heatmapRowsByAudience} columns={audienceComparisons.slice(0, 6).map((row) => ({ id: row.id, name: row.name }))} />
        <Heatmap title="Heatmap: Variables vs Hipótesis" rows={heatmapRowsByHypothesis} columns={hypothesisComparisons.slice(0, 6).map((row) => ({ id: row.id, name: row.name }))} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BarChart3 className="h-4 w-4 text-indigo-600" />Distribución de entrevistas por score</h4>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          {distribution.map((bucket) => (
            <div key={bucket.value} className="rounded border border-slate-200 p-2 text-center">
              <p className="text-xs text-slate-500">Score {bucket.value}</p>
              <p className="text-xs text-slate-700">Problema: <b>{bucket.problem}</b></p>
              <p className="text-xs text-slate-700">Solución: <b>{bucket.solution}</b></p>
            </div>
          ))}
        </div>
      </div>

      {selectedDetail ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-slate-900">Detalle cuantitativo: {selectedDetail.name}</h4>
                <p className="text-xs text-slate-500">{selectedDetail.interviewsCount} entrevistas · {selectedDetail.quickReading}</p>
              </div>
              <Button className="bg-white border" onClick={() => setDetailRowId('')}>Cerrar</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Promedio score problema</p>
                <p className="text-lg font-semibold text-indigo-700">{selectedDetail.problemScore ?? '—'}</p>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Promedio score solución</p>
                <p className="text-lg font-semibold text-sky-700">{selectedDetail.solutionScore ?? '—'}</p>
              </div>
            </div>
            <div className="mt-3 rounded border border-slate-200 p-3">
              <h5 className="text-sm font-semibold text-slate-900">Promedios por variable</h5>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {allVariables.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                    <span>{label}</span>
                    <span className="font-semibold">{selectedDetail.variableAverages[key] ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 rounded border border-slate-200 p-3">
              <h5 className="text-sm font-semibold text-slate-900">Entrevistas incluidas</h5>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                {selectedDetail.interviews.map((interview) => (
                  <div key={interview.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                    <div>
                      <p className="font-medium text-slate-900">Entrevista {interview.sessionId} · {interview.clientName}</p>
                      <p className="text-slate-500">{interview.audienceName} · {interview.formName} · {interview.hypothesisName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>P {interview.problemScore ?? '—'}</span>
                      <span>S {interview.solutionScore ?? '—'}</span>
                      {onOpenSession ? <Button className="h-7 bg-white border px-2 text-xs" onClick={() => onOpenSession(interview.sessionId)}>Abrir</Button> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

