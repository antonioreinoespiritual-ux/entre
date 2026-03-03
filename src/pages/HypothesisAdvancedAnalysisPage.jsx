import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildVolumeSnapshot } from '@/lib/analysis/volume';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

const defaultConfig = {
  primary_metric: 'ctr',
  secondary_metrics: ['clicks', 'purchase'],
  analysis_unit: 'video',
  comparison_mode: 'threshold',
  method: 'hybrid',
  correction: 'fdr_bh',
  alpha: 0.05,
  power: 0.8,
  mde: 0.1,
  threshold_operator: '>=',
  threshold_value: 0,
  video_type: '',
  date_from: '',
  date_to: '',
};

function getAccessToken() {
  try {
    const raw = localStorage.getItem(sessionStorageKey);
    return raw ? JSON.parse(raw)?.access_token : null;
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  const token = getAccessToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Request failed');
  return json;
}

const HypothesisAdvancedAnalysisPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(defaultConfig);
  const [hypothesis, setHypothesis] = useState(null);
  const [videos, setVideos] = useState([]);
  const [runs, setRuns] = useState([]);
  const [results, setResults] = useState(null);
  const [volume, setVolume] = useState(null);
  const [audienceBreakdown, setAudienceBreakdown] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (config.video_type) query.set('video_type', config.video_type);
      if (config.date_from) query.set('date_from', config.date_from);
      if (config.date_to) query.set('date_to', config.date_to);
      if (config.primary_metric) query.set('primary_metric', config.primary_metric);
      if (config.threshold_operator) query.set('threshold_operator', config.threshold_operator);
      query.set('threshold_value', String(Number(config.threshold_value || 0)));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const data = await apiRequest(`/api/hypotheses/${hypothesisId}/analysis-data${suffix}`, { method: 'GET' });
      setHypothesis(data.hypothesis);
      setVideos(data.videos || []);
      setRuns(data.runs || []);
      setVolume(data.volume || buildVolumeSnapshot({
        videos: data.videos || [],
        minimum: data.hypothesis?.volumen_minimo || 0,
        unit: data.hypothesis?.volumen_unidad || 'videos',
        hypothesisId,
      }));
      setAudienceBreakdown(data.audience_breakdown || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [hypothesisId, config.video_type, config.date_from, config.date_to, config.primary_metric, config.threshold_operator, config.threshold_value]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runAnalysis = async () => {
    setRunning(true);
    setError('');
    try {
      const payload = {
        ...config,
        threshold_value: Number(config.threshold_value || 0),
        alpha: Number(config.alpha || 0.05),
        power: Number(config.power || 0.8),
        mde: Number(config.mde || 0.1),
      };
      const response = await apiRequest(`/api/hypotheses/${hypothesisId}/analyze`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResults(response.results);
      setVolume(response.volume || null);
      await loadData();
    } catch (runError) {
      setError(runError.message);
    } finally {
      setRunning(false);
    }
  };

  const statusBadgeClass = useMemo(() => {
    const status = results?.verdict?.status || hypothesis?.validation_status || 'Inconclusa';
    if (status === 'Validada') return 'bg-green-100 text-green-700';
    if (status === 'No validada') return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  }, [results, hypothesis]);

  const resolvedVolume = useMemo(
    () => volume || buildVolumeSnapshot({
      videos,
      minimum: hypothesis?.volumen_minimo || 0,
      unit: hypothesis?.volumen_unidad || 'videos',
      hypothesisId,
    }),
    [volume, videos, hypothesis, hypothesisId],
  );


  const formatMetricValue = (metricKey, value) => {
    if (value == null) return '-';
    const metric = String(metricKey || '').toLowerCase();
    if (['ctr', 'initiate_checkout_rate', 'view_content_rate', 'lead_rate', 'purchase_rate'].includes(metric)) {
      return `${(Number(value) * 100).toFixed(2)}%`;
    }
    if (['retencion_pct', 'retention_pct', 'views_finish_pct'].includes(metric)) {
      return `${Number(value).toFixed(2)}%`;
    }
    if (['cpc', 'tiempo_prom_seg', 'engagement', 'viewers_prom'].includes(metric)) {
      return Number(value).toFixed(2);
    }
    return Number(value).toFixed(0);
  };

  const breakdownLabel = (status) => {
    if (status === 'pass') return 'Cumplió';
    if (status === 'fail') return 'No cumplió';
    return 'Sin datos';
  };

  const breakdownClass = (status) => {
    if (status === 'pass') return 'bg-emerald-100 text-emerald-700';
    if (status === 'fail') return 'bg-red-100 text-red-700';
    return 'bg-gray-200 text-gray-700';
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white"><div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-400 border-t-transparent" /></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Hypothesis Advanced Analysis</title></Helmet>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}`)} className="bg-gray-800 hover:bg-gray-700 text-white border border-gray-600"><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6 text-indigo-300" />Hypothesis Advanced Analysis</h1>
        </div>

        {error && <div className="rounded-xl border border-red-400 bg-red-900/30 px-4 py-3 text-red-200">{error}</div>}

        <section className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Resumen de hipótesis</h2>
              <p className="text-sm text-gray-300 mt-2">Tipo: {hypothesis?.type || '-'} · Canal: {hypothesis?.canal_principal || '-'}</p>
              <p className="mt-2">{hypothesis?.hypothesis_statement || hypothesis?.condition || 'Sin statement'}</p>
              <p className="text-sm text-gray-300 mt-2">Variable X: {hypothesis?.variable_x || '-'}</p>
              <p className="text-sm text-gray-300">Objetivo hipótesis (Y): {hypothesis?.metrica_objetivo_y || '-'}</p>
              <p className="text-sm text-gray-300">Primary metric (análisis): {config.primary_metric}</p>
              <p className="text-sm text-gray-300">Umbral: {hypothesis?.umbral_operador || config.threshold_operator} {hypothesis?.umbral_valor ?? config.threshold_value}</p>
              <p className="text-sm text-gray-300">Volumen mínimo: {resolvedVolume.minimum} {resolvedVolume.unit}</p>
              <p className="text-sm text-gray-300">Volumen actual: {resolvedVolume.current} {resolvedVolume.unit} · videos: {resolvedVolume.count_videos}</p>
              <p className="text-sm text-gray-400 mt-1">Ventana de análisis: {config.date_from || 'inicio'} → {config.date_to || 'actual'}</p>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${statusBadgeClass}`}>{results?.verdict?.status || hypothesis?.validation_status || 'Inconclusa'}</span>
              {!resolvedVolume.meets_minimum && <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">Muestra insuficiente</span>}
              <Button onClick={runAnalysis} disabled={running} className="bg-indigo-600 hover:bg-indigo-700 text-white"><RefreshCw className={`w-4 h-4 mr-2 ${running ? 'animate-spin' : ''}`} />Recalcular</Button>
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Panel de configuración</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm mb-1">Primary metric</label><select value={config.primary_metric} onChange={(e) => setConfig({ ...config, primary_metric: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="ctr">CTR</option><option value="clicks">clicks</option><option value="views">views</option><option value="purchase">purchase</option><option value="initiatest">initiatest</option></select></div>
              <div><label className="block text-sm mb-1">Método</label><select value={config.method} onChange={(e) => setConfig({ ...config, method: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="frequentist">Frecuentista</option><option value="bayesian">Bayesiano</option><option value="hybrid">Híbrido</option></select></div>
              <div><label className="block text-sm mb-1">Unidad de análisis</label><select value={config.analysis_unit} onChange={(e) => setConfig({ ...config, analysis_unit: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="video">Por video</option><option value="day">Por día</option><option value="session">Por session/ad_id</option></select></div>
              <div><label className="block text-sm mb-1">Comparación</label><select value={config.comparison_mode} onChange={(e) => setConfig({ ...config, comparison_mode: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="ab">Baseline vs Treatment</option><option value="threshold">Umbral absoluto</option><option value="historical">Histórico</option></select></div>
              <div><label className="block text-sm mb-1">Corrección</label><select value={config.correction} onChange={(e) => setConfig({ ...config, correction: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="fdr_bh">Benjamini-Hochberg</option><option value="bonferroni">Bonferroni</option><option value="none">None</option></select></div>
              <div><label className="block text-sm mb-1">Video type</label><select value={config.video_type} onChange={(e) => setConfig({ ...config, video_type: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2"><option value="">Todos</option><option value="paid">Paid</option><option value="organic">Organic</option><option value="live">Live</option></select></div>
              <div><label className="block text-sm mb-1">Alpha</label><input type="number" step="0.01" value={config.alpha} onChange={(e) => setConfig({ ...config, alpha: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" /></div>
              <div><label className="block text-sm mb-1">Power</label><input type="number" step="0.05" value={config.power} onChange={(e) => setConfig({ ...config, power: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" /></div>
              <div><label className="block text-sm mb-1">MDE</label><input type="number" step="0.01" value={config.mde} onChange={(e) => setConfig({ ...config, mde: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" /></div>
              <div><label className="block text-sm mb-1">Umbral</label><div className="flex gap-2"><select value={config.threshold_operator} onChange={(e) => setConfig({ ...config, threshold_operator: e.target.value })} className="rounded-lg bg-gray-900 border border-gray-600 p-2"><option>{'>='}</option><option>{'>'}</option><option>{'<='}</option><option>{'<'}</option></select><input type="number" value={config.threshold_value} onChange={(e) => setConfig({ ...config, threshold_value: e.target.value })} className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" /></div></div>
            </div>
            <div className="flex gap-2"><Button onClick={loadData} className="bg-gray-700 hover:bg-gray-600 text-white">Actualizar dataset</Button><Button onClick={runAnalysis} disabled={running} className="bg-indigo-600 hover:bg-indigo-700 text-white">Ejecutar análisis</Button></div>
          </div>

          <div className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
            <h3 className="text-lg font-semibold mb-3">Diagnóstico de datos</h3>
            {!results?.diagnostics ? (
              <p className="text-gray-400">Ejecuta “Recalcular” para ver checks de calidad.</p>
            ) : (
              <div className="space-y-2">
                {results.diagnostics.checks.map((check) => (
                  <div key={check.check} className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-2">
                    <div className="flex items-center gap-2"><AlertTriangle className={`w-4 h-4 ${check.status === 'ok' ? 'text-green-400' : 'text-yellow-400'}`} /><span className="text-sm">{check.check}</span></div>
                    <span className="text-xs text-gray-300">{check.detail}</span>
                  </div>
                ))}
                <div className="text-sm text-gray-300 pt-2">Histograma simple ({results.diagnostics.histogram.metric}): min {results.diagnostics.histogram.min?.toFixed?.(4)} · mean {results.diagnostics.histogram.mean?.toFixed?.(4)} · max {results.diagnostics.histogram.max?.toFixed?.(4)}</div>
              </div>
            )}
          </div>
        </section>

        <section className="grid lg:grid-cols-3 gap-6">
          <div className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
            <h3 className="text-lg font-semibold mb-3">Frecuentista</h3>
            {results?.frequentist ? (
              <div className="space-y-2 text-sm">
                <p>p-value: <b>{Number(results.frequentist.p_value || 0).toFixed(6)}</b></p>
                <p>CI95: [{Number(results.frequentist.ci_95?.[0] || 0).toFixed(4)}, {Number(results.frequentist.ci_95?.[1] || 0).toFixed(4)}]</p>
                <p>Delta abs: {Number(results.frequentist.delta_absolute || 0).toFixed(4)}</p>
                <p>Efecto: {Number(results.frequentist.effect_size || 0).toFixed(4)}</p>
                <p>Conclusión: {results.frequentist.passes ? 'pasa umbral' : 'no pasa umbral'}</p>
              </div>
            ) : <p className="text-gray-400">Sin resultados</p>}
          </div>

          <div className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
            <h3 className="text-lg font-semibold mb-3">Bayesiano</h3>
            {results?.bayesian ? (
              <div className="space-y-2 text-sm">
                <p>P(mejora &gt; 0): <b>{(Number(results.bayesian.p_improvement_gt_0 || 0) * 100).toFixed(1)}%</b></p>
                <p>P(mejora &gt; umbral): <b>{(Number(results.bayesian.p_improvement_gt_threshold || 0) * 100).toFixed(1)}%</b></p>
                <p>Credible 95%: [{Number(results.bayesian.credible_interval_95?.[0] || 0).toFixed(4)}, {Number(results.bayesian.credible_interval_95?.[1] || 0).toFixed(4)}]</p>
                <p>Recomendación: {results.bayesian.recommendation}</p>
              </div>
            ) : <p className="text-gray-400">Sin resultados</p>}
          </div>

          <div className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
            <h3 className="text-lg font-semibold mb-3">Secuencial</h3>
            {results?.sequential ? (
              <div className="space-y-2 text-sm">
                <p>Regla: {results.sequential.stopping_rule}</p>
                <p>¿Se puede parar ya?: <b>{results.sequential.can_stop ? 'Sí' : 'No'}</b></p>
                <p>{results.sequential.risk_note}</p>
              </div>
            ) : <p className="text-gray-400">Sin resultados</p>}
          </div>
        </section>


        <section className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
          <h3 className="text-lg font-semibold mb-3">Desglose por público</h3>
          {videos.length === 0 ? (
            <p className="text-gray-400">Sin datos</p>
          ) : audienceBreakdown.length === 0 ? (
            <p className="text-gray-400">Sin datos</p>
          ) : (
            <div className="space-y-2">
              {audienceBreakdown.map((row) => (
                <div key={row.audience_id || 'sin-publico'} className="rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-2 text-sm flex flex-wrap items-center gap-3">
                  <span className="font-medium text-gray-200 min-w-[160px]">{row.audience_name || 'Sin público'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${breakdownClass(row.status)}`}>{breakdownLabel(row.status)}</span>
                  <span className="text-gray-300">Videos: <b>{row.videos_count || 0}</b></span>
                  <span className="text-gray-300">Valor: <b>{formatMetricValue(config.primary_metric, row.metric_value)}</b></span>
                  <span className="text-gray-300">Umbral: <b>{config.threshold_operator} {Number(config.threshold_value || 0)}</b></span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
          <h3 className="text-lg font-semibold mb-3">Decisión / Veredicto</h3>
          {!results?.verdict ? (
            <p className="text-gray-400">Ejecuta análisis para generar veredicto.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-base font-semibold">{results.verdict.status}</p>
              <p>{results.verdict.summary}</p>
              <p>Confianza (Bayes): {(Number(results.verdict.confidence?.bayesian_probability || 0) * 100).toFixed(1)}%</p>
              <p>Volumen actual: {results.verdict.confidence?.volume_current ?? resolvedVolume.current} {results.verdict.confidence?.volume_unit ?? resolvedVolume.unit}</p>
              <p>Volumen mínimo: {results.verdict.confidence?.volume_minimum ?? resolvedVolume.minimum} {results.verdict.confidence?.volume_unit ?? resolvedVolume.unit}</p>
              <p>Volumen mínimo cumplido: {results.verdict.confidence?.volume_ok ? 'Sí' : 'No'}</p>
              <p>Recomendación: <b>{results.verdict.recommendation}</b></p>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-gray-800/80 border border-gray-700 p-5">
          <h3 className="text-lg font-semibold mb-3">Auditoría</h3>
          {runs.length === 0 ? (
            <p className="text-gray-400">No hay corridas todavía.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-2 text-xs">
                  <p>ID: {run.id}</p>
                  <p>Timestamp: {run.created_at}</p>
                  <p>Dataset hash: {run.dataset_hash}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HypothesisAdvancedAnalysisPage;
