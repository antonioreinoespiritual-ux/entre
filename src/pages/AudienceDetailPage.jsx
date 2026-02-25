import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Beaker, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const AudienceDetailPage = () => {
  const { projectId, campaignId, audienceId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [videoType, setVideoType] = useState('all');
  const [data, setData] = useState(null);

  const load = async () => {
    setLoading(true);
    const response = await fetch(`${apiBaseUrl}/api/audiences/${audienceId}/dashboard?video_type=${videoType}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (response.ok) {
      setData(await response.json());
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [audienceId, videoType]);

  const audience = data?.audience;
  const videos = data?.videos || [];
  const sums = data?.sums || {};
  const rates = data?.rates || {};

  const tabs = useMemo(() => ['all', 'paid', 'organic', 'live'], []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800"><div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-400 border-t-transparent" /></div>;
  }

  if (!audience) {
    return <div className="min-h-screen flex items-center justify-center">Audience no encontrada</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Audience Detail Dashboard</title></Helmet>
      <div className="max-w-7xl mx-auto space-y-6">
        <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/audiences`)} className="bg-gray-800 border border-gray-600 text-white"><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{audience.name}</h1>
              <p className="text-gray-300 mt-1">{audience.description || 'Sin descripción'}</p>
              <p className="text-sm text-gray-400 mt-2">Campaign: {audience.campaign_id} · Creado: {audience.created_at || '-'}</p>
              <p className="text-sm text-gray-400">Contexto: {audience.contexto || '-'} · Segmentación: {audience.targeting || '-'}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={load} className="bg-gray-700 text-white"><RefreshCw className="w-4 h-4 mr-2" />Actualizar</Button>
              <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/audiences/ab-test?audienceA=${audienceId}`)} className="bg-indigo-600 hover:bg-indigo-700 text-white"><Beaker className="w-4 h-4 mr-2" />Prueba A/B</Button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Acumulados / KPIs del público</h2>
          <div className="grid md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Total videos: <b>{data?.counts?.videos || 0}</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Total views: <b>{sums.views || 0}</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Total clicks: <b>{sums.clicks || 0}</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Total purchase: <b>{sums.purchase || 0}</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">CTR global: <b>{((rates.ctr || 0) * 100).toFixed(2)}%</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Purchase rate: <b>{((rates.purchase_rate || 0) * 100).toFixed(2)}%</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Lead rate: <b>{((rates.lead_rate || 0) * 100).toFixed(2)}%</b></div>
            <div className="rounded-lg bg-gray-900/40 border border-gray-700 p-3">Initiate rate: <b>{((rates.initiate_rate || 0) * 100).toFixed(2)}%</b></div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Calidad de datos</h2>
          {!(data?.warnings || []).length ? <p className="text-sm text-green-300">Sin warnings críticos.</p> : (
            <ul className="list-disc list-inside text-sm text-yellow-300 space-y-1">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Interpretación</h2>
          <ul className="list-disc list-inside text-sm text-gray-200 space-y-1">{(data?.insights || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Videos asociados</h2>
            <div className="flex gap-2">{tabs.map((tab) => <Button key={tab} className={videoType===tab ? 'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'} onClick={() => setVideoType(tab)}>{tab === 'all' ? 'Todos' : tab}</Button>)}</div>
          </div>
          {videos.length === 0 ? <p className="text-sm text-gray-400">No hay videos asociados.</p> : (
            <div className="space-y-2">
              {videos.map((video) => (
                <div key={video.id} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{video.title}</p>
                      <p className="text-gray-400">tipo: {video.video_type} · views: {video.views || 0} · clicks: {video.clicks || 0} · ctr: {video.ctr || 0}</p>
                    </div>
                    <Link className="text-indigo-300 hover:underline" to={`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${video.hypothesis_id}/videos/${video.id}`}>Ver detalle</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AudienceDetailPage;
