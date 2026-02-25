import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const AudienceAbTestPage = () => {
  const { projectId, campaignId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const audienceAId = searchParams.get('audienceA') || '';

  const [audiences, setAudiences] = useState([]);
  const [audienceBId, setAudienceBId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [config, setConfig] = useState({ primaryMetric: 'ctr', videoType: 'all', alpha: 0.05, mde: 0.1, method: 'hybrid', minExposure: 1000 });

  useEffect(() => {
    const load = async () => {
      const response = await fetch(`${apiBaseUrl}/api/db/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ table: 'audiences', operation: 'select', filters: [{ field: 'campaign_id', value: campaignId }] }),
      });
      if (response.ok) {
        const json = await response.json();
        setAudiences(json.data || []);
      }
    };
    load();
  }, [campaignId]);

  const audienceA = useMemo(() => audiences.find((audience) => audience.id === audienceAId), [audiences, audienceAId]);
  const candidatesB = useMemo(() => audiences.filter((audience) => audience.id !== audienceAId), [audiences, audienceAId]);

  const runTest = async () => {
    setError('');
    if (!audienceAId || !audienceBId) return;
    const response = await fetch(`${apiBaseUrl}/api/audiences/ab-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ audienceAId, audienceBId, ...config }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error || 'Error ejecutando test');
      return;
    }
    setResult(json);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Audience A/B Test</title></Helmet>
      <div className="max-w-6xl mx-auto space-y-6">
        <Button className="bg-gray-800 border border-gray-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/audiences/${audienceAId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h1 className="text-2xl font-bold">Prueba A/B Audiencia vs Audiencia</h1>
          <p className="text-sm text-gray-300 mt-1">A: {audienceA?.name || audienceAId || 'No definida'}</p>
          {error && <p className="text-yellow-300 mt-2">⚠ {error}</p>}
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5 grid md:grid-cols-2 gap-4">
          <div><label className="block text-sm mb-1">Audience B</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={audienceBId} onChange={(e) => setAudienceBId(e.target.value)}><option value="">Selecciona B</option>{candidatesB.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select></div>
          <div><label className="block text-sm mb-1">Primary metric</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={config.primaryMetric} onChange={(e) => setConfig({ ...config, primaryMetric: e.target.value })}><option value="ctr">CTR</option><option value="purchase_rate">purchase_rate</option><option value="clicks_per_1000_views">clicks_per_1000_views</option></select></div>
          <div><label className="block text-sm mb-1">Tipo de videos</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={config.videoType} onChange={(e) => setConfig({ ...config, videoType: e.target.value })}><option value="all">Todos</option><option value="paid">Paid</option><option value="organic">Organic</option><option value="live">Live</option></select></div>
          <div><label className="block text-sm mb-1">Método</label><select className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" value={config.method} onChange={(e) => setConfig({ ...config, method: e.target.value })}><option value="frequentist">Frecuentista</option><option value="bayesian">Bayesiano</option><option value="hybrid">Híbrido</option></select></div>
          <div><label className="block text-sm mb-1">Alpha</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" step="0.01" value={config.alpha} onChange={(e) => setConfig({ ...config, alpha: Number(e.target.value) })} /></div>
          <div><label className="block text-sm mb-1">MDE</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" step="0.01" value={config.mde} onChange={(e) => setConfig({ ...config, mde: Number(e.target.value) })} /></div>
          <div><label className="block text-sm mb-1">Mínimo exposición (views)</label><input className="w-full rounded-lg bg-gray-900 border border-gray-600 p-2" type="number" value={config.minExposure} onChange={(e) => setConfig({ ...config, minExposure: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={runTest}>Ejecutar comparación</Button></div>
        </section>

        {result?.results && (
          <>
            <section className="grid lg:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Frecuentista</h3><p className="text-sm">p-value: {Number(result.results.frequentist?.p_value || 0).toFixed(6)}</p><p className="text-sm">Uplift: {Number(result.results.frequentist?.uplift_absolute || 0).toFixed(4)}</p><p className="text-sm">Winner: {result.results.frequentist?.winner}</p></div>
              <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Bayesiano</h3><p className="text-sm">P(B &gt; A): {(Number(result.results.bayesian?.p_b_gt_a || 0) * 100).toFixed(1)}%</p><p className="text-sm">P(uplift &gt; MDE): {(Number(result.results.bayesian?.p_uplift_gt_mde || 0) * 100).toFixed(1)}%</p></div>
              <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5"><h3 className="font-semibold mb-2">Secuencial</h3><p className="text-sm">Exposure ok: {result.results.sequential?.exposure_ok ? 'Sí' : 'No'}</p><p className="text-sm">Decisión: {result.results.sequential?.decision}</p></div>
            </section>
            <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
              <h3 className="font-semibold mb-2">Decisión final</h3>
              <p className="text-sm">{result.results.decision}</p>
              <ul className="list-disc list-inside text-sm text-gray-300 mt-2">{(result.results.recommendations || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default AudienceAbTestPage;
