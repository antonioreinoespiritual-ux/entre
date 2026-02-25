import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Beaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { computeDerivedMetrics } from '@/lib/analysis/abTestEngine';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function getToken() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const VideoDetailPage = () => {
  const { projectId, campaignId, hypothesisId, videoId } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [videos, setVideos] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const load = async () => {
      const token = getToken();
      const [videoRes, allRes, histRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/videos/${videoId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/api/hypotheses/${hypothesisId}/analysis-data`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/api/videos/${videoId}/ab-tests`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (videoRes.ok) setVideo((await videoRes.json()).video);
      if (allRes.ok) setVideos((await allRes.json()).videos || []);
      if (histRes.ok) setHistory((await histRes.json()).data || []);
    };
    load();
  }, [videoId, hypothesisId]);

  const derived = useMemo(() => (video ? computeDerivedMetrics(video) : null), [video]);
  const comparables = useMemo(() => videos.filter((v) => v.id !== videoId && (v.video_type || '') === (video?.video_type || '')).slice(0, 3), [videos, videoId, video]);

  const openInCloud = async () => {
    const response = await fetch(`${apiBaseUrl}/api/cloud/locate?targetType=video&targetId=${videoId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (response.ok) {
      const json = await response.json();
      navigate(`/cloud/${json.parentId || json.nodeId}`);
    }
  };

  if (!video) return <div className="min-h-screen flex items-center justify-center">Cargando video...</div>;

  const flags = [];
  if (Number(video.views || 0) > 0 && Math.abs((Number(video.clicks || 0) / Number(video.views || 1)) - Number(video.ctr || 0)) > 0.2) flags.push('CTR inconsistente vs clicks/views');
  if (Number(derived.ctr || 0) > 0.05 && Number(video.clicks || 0) < 20) flags.push('CTR alto con bajo n (revisar ruido muestral)');
  if (!video.hook_texto) flags.push('Falta hook_texto');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Video Detail Dashboard</title></Helmet>
      <div className="max-w-6xl mx-auto space-y-6">
        <Button className="bg-gray-800 border border-gray-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver a hipótesis</Button>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{video.title}</h1>
              <p className="text-sm text-gray-300">Tipo: {video.video_type} · Creado: {video.created_at || '-'} · audience: {video.audience_id || 'N/A'}</p>
              <p className="text-sm text-gray-300">external_id: {video.external_id || '-'} · campaign/ad_set/ad: {video.campaign_id_ref || '-'} / {video.ad_set_id || '-'} / {video.ad_id || '-'}</p>
            </div>
            <div className="flex gap-2">
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}/ab-test?videoA=${video.id}`)}><Beaker className="w-4 h-4 mr-2" />Prueba A/B</Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={openInCloud}>Abrir en Cloud</Button>
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
            <h2 className="font-semibold mb-3">Creative / Ejecución</h2>
            <div className="space-y-1 text-sm text-gray-300">
              <p>Hook: {video.hook_texto || '-'}</p>
              <p>Hook type: {video.hook_tipo || '-'}</p>
              <p>CTA: {video.cta_texto || '-'}</p>
              <p>CTA type: {video.cta_tipo || '-'}</p>
              <p>Creative ID: {video.creative_id || '-'}</p>
              <p>Contexto: {video.contexto_cualitativo || '-'}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
            <h2 className="font-semibold mb-3">Métricas</h2>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-300">
              <p>Views: {video.views || 0}</p><p>Clicks: {video.clicks || 0}</p>
              <p>Initiatest: {video.initiatest || 0}</p><p>Purchase: {video.purchase || 0}</p>
              <p>Likes: {video.likes || 0}</p><p>Comments: {video.comments || 0}</p>
              <p>Shares: {video.shares || 0}</p><p>Saves: {video.saves || 0}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Interpretación</h2>
          <div className="space-y-1 text-sm text-gray-300">
            <p>CTR derivado: {(Number(derived.ctr || 0) * 100).toFixed(2)}%</p>
            <p>Purchase rate derivado: {(Number(derived.purchase_rate || 0) * 100).toFixed(2)}%</p>
            <p>Clicks por 1000 views: {Number(derived.clicks_per_1000_views || 0).toFixed(2)}</p>
            {flags.map((flag) => <p key={flag} className="text-yellow-300">⚠ {flag}</p>)}
            <p className="pt-2">Recomendaciones:</p>
            <ul className="list-disc list-inside">
              <li>Si hay muchos views y pocos clicks, revisar CTA.</li>
              <li>Si CTR es alto pero purchase_rate bajo, optimizar landing/offer.</li>
              <li>Si faltan campos creativos, mejorar trazabilidad del experimento.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Comparables</h2>
          {comparables.length === 0 ? <p className="text-sm text-gray-400">No hay comparables aún.</p> : (
            <div className="space-y-2">{comparables.map((item) => <div key={item.id} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-sm"><p>{item.title}</p><p className="text-gray-400">views {item.views || 0} · clicks {item.clicks || 0}</p></div>)}</div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-5">
          <h2 className="font-semibold mb-3">Historial A/B</h2>
          {history.length === 0 ? <p className="text-sm text-gray-400">Sin historial todavía.</p> : (
            <div className="space-y-2">{history.map((row) => <div key={row.id} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-xs"><p>ID: {row.id}</p><p>{row.created_at}</p><p>{row.dataset_hash}</p></div>)}</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default VideoDetailPage;
