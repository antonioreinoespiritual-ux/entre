import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compareVideos } from '@/lib/analysis/abTestEngine';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const AbTestPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const videoAId = searchParams.get('videoA') || '';

  const [videos, setVideos] = useState([]);
  const [videoBId, setVideoBId] = useState('');
  const [config, setConfig] = useState({ primaryMetric: 'ctr', method: 'hybrid', alpha: 0.05, mde: 0.1, exposureUnit: 'views', minExposure: 1000 });
  const [serverResult, setServerResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const r = await fetch(`${apiBaseUrl}/api/hypotheses/${hypothesisId}/analysis-data`, { headers: { Authorization: `Bearer ${token()}` } });
      if (r.ok) {
        const json = await r.json();
        setVideos(json.videos || []);
      }
    };
    load();
  }, [hypothesisId]);

  const videoA = useMemo(() => videos.find((video) => video.id === videoAId), [videos, videoAId]);
  const candidateB = useMemo(() => videos.filter((video) => video.id !== videoAId && (!videoA || video.video_type === videoA.video_type)), [videos, videoAId, videoA]);
  const videoB = useMemo(() => videos.find((video) => video.id === videoBId), [videos, videoBId]);

  const localResult = useMemo(() => {
    if (!videoA || !videoB) return null;
    return compareVideos(videoA, videoB, config);
  }, [videoA, videoB, config]);

  const runServerTest = async () => {
    setError('');
    if (!videoAId || !videoBId) return;
    if (videoA?.video_type !== videoB?.video_type) {
      setError('No se permite mezclar tipos de video en A/B (paid/organic/live).');
      return;
    }
    const r = await fetch(`${apiBaseUrl}/api/ab-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ videoAId, videoBId, ...config }),
    });
    const json = await r.json();
    if (!r.ok) setError(json.error || 'Error ejecutando A/B');
    else setServerResult(json);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Prueba A/B</title></Helmet>
      <div className="max-w-6xl mx-auto space-y-6">
        <Button className="bg-gray-800 border border-gray-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h1 className="text-2xl font-bold">Prueba A/B: Video A vs Video B</h1>
          <p className="text-sm text-gray-300 mt-1">Video A: {videoA?.title || videoAId || 'No seleccionado'}</p>
          {error && <p className="text-yellow-300 mt-2">⚠ {error}</p>}
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5 grid md:grid-cols-2 gap-4">
          <div><label className="block text-sm mb-1">Video B</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={videoBId} onChange={(e) => setVideoBId(e.target.value)}><option value="">Selecciona video B</option>{candidateB.map((video) => <option key={video.id} value={video.id}>{video.title} ({video.video_type})</option>)}</select></div>
          <div><label className="block text-sm mb-1">Primary metric</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={config.primaryMetric} onChange={(e) => setConfig({ ...config, primaryMetric: e.target.value })}><option value="ctr">CTR</option><option value="purchase_rate">purchase_rate</option><option value="clicks">clicks</option></select></div>
          <div><label className="block text-sm mb-1">MDE</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" step="0.01" value={config.mde} onChange={(e) => setConfig({ ...config, mde: Number(e.target.value) })} /></div>
          <div><label className="block text-sm mb-1">Alpha</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" step="0.01" value={config.alpha} onChange={(e) => setConfig({ ...config, alpha: Number(e.target.value) })} /></div>
          <div><label className="block text-sm mb-1">Método</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={config.method} onChange={(e) => setConfig({ ...config, method: e.target.value })}><option value="frequentist">Frecuentista</option><option value="bayesian">Bayes</option><option value="hybrid">Híbrido</option></select></div>
          <div><label className="block text-sm mb-1">Min exposure</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" value={config.minExposure} onChange={(e) => setConfig({ ...config, minExposure: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={runServerTest}>Ejecutar Prueba A/B</Button></div>
        </section>

        {localResult && (
          <section className="grid lg:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Frecuentista</h3><p className="text-sm">p-value: {Number(localResult.frequentist?.p_value || 0).toFixed(6)}</p><p className="text-sm">Uplift: {Number(localResult.frequentist?.uplift_absolute || 0).toFixed(4)}</p><p className="text-sm">Winner: {localResult.frequentist?.winner}</p></div>
            <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Bayesiano</h3><p className="text-sm">P(B &gt; A): {(Number(localResult.bayesian?.p_b_gt_a || 0) * 100).toFixed(1)}%</p><p className="text-sm">P(uplift &gt; MDE): {(Number(localResult.bayesian?.p_uplift_gt_mde || 0) * 100).toFixed(1)}%</p></div>
            <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Secuencial</h3><p className="text-sm">Exposure ok: {localResult.sequential?.exposure_ok ? 'Sí' : 'No'}</p><p className="text-sm">Decisión: {localResult.decision}</p></div>
          </section>
        )}

        {(serverResult || localResult) && (
          <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
            <h3 className="font-semibold mb-2">Decisión</h3>
            <p className="text-sm">{(serverResult?.results || localResult)?.decision || 'Inconcluso'}</p>
            <ul className="list-disc list-inside text-sm text-gray-300 mt-2">
              {((serverResult?.results || localResult)?.recommendations || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};

export default AbTestPage;
