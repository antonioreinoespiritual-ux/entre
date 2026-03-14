import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, BarChart3, CheckCircle2, Gauge, Layers3, MoreHorizontal, Plus, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useVideos } from '@/contexts/VideoContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { buildVolumeSnapshot } from '@/lib/analysis/volume';
import { useToast } from '@/components/ui/use-toast';
import BulkVideoUpdateModal from '@/components/BulkVideoUpdateModal';
import LibraryVideoModal from '@/components/LibraryVideoModal';
import HypothesisAudienceModal from '@/components/HypothesisAudienceModal';

const tabs = ['paid', 'organic', 'live'];

const backendBaseUrl = () => import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const token = () => JSON.parse(localStorage.getItem('mysql_backend_session') || 'null')?.access_token || '';

const HypothesisDetailPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { videos, fetchVideos, deleteVideo, linkVideosToHypothesis } = useVideos();
  const { audiences, fetchAudiences } = useAudiences();

  const [activeTab, setActiveTab] = useState('paid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showAudienceModal, setShowAudienceModal] = useState(false);
  const [audienceVideo, setAudienceVideo] = useState(null);
  const [videoSearchTerm, setVideoSearchTerm] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showHypothesisCardModal, setShowHypothesisCardModal] = useState(false);
  const [projectsOptions, setProjectsOptions] = useState([]);
  const [campaignOptions, setCampaignOptions] = useState([]);
  const [moveForm, setMoveForm] = useState({
    target_project_id: projectId,
    target_campaign_id: campaignId,
    move_videos: true,
    no_move_shared_videos: true,
  });
  const [movePreview, setMovePreview] = useState(null);
  const [movePreviewLoading, setMovePreviewLoading] = useState(false);
  const [moveSubmitting, setMoveSubmitting] = useState(false);

  const openInCloud = async () => {
    navigate(`/projects/${projectId}/cloud`);
  };

  useEffect(() => {
    fetchHypotheses(campaignId);
    fetchAudiences(campaignId);
    fetchVideos(hypothesisId);
  }, [campaignId, hypothesisId, fetchHypotheses, fetchAudiences, fetchVideos]);



  const hypothesis = useMemo(() => hypotheses.find((h) => h.id === hypothesisId), [hypotheses, hypothesisId]);
  const tabVideos = useMemo(() => videos.filter((video) => (video.video_type || 'organic') === activeTab), [videos, activeTab]);


  const audiencesById = useMemo(() => {
    const map = new Map();
    audiences.forEach((audience) => map.set(String(audience.id), audience));
    return map;
  }, [audiences]);


  const availableSessions = useMemo(() => {
    const values = new Set();
    tabVideos.forEach((video) => {
      const sessionValue = video.session_id ?? video.external_id;
      if (sessionValue != null && String(sessionValue).trim() !== '') values.add(String(sessionValue));
    });
    return [...values];
  }, [tabVideos]);

  const filteredTabVideos = useMemo(() => {
    const q = videoSearchTerm.trim().toLowerCase();
    return tabVideos.filter((video) => {
      const sessionValue = String(video.session_id ?? video.external_id ?? '').trim();
      if (sessionFilter !== 'all' && sessionValue !== sessionFilter) return false;
      if (!q) return true;
      return [video.title, video.name, video.hook_texto, video.contexto_cualitativo].join(' ').toLowerCase().includes(q);
    });
  }, [tabVideos, videoSearchTerm, sessionFilter]);



  const volume = useMemo(() => buildVolumeSnapshot({
    videos,
    minimum: hypothesis?.volumen_minimo || 0,
    unit: hypothesis?.volumen_unidad || 'videos',
    hypothesisId,
  }), [videos, hypothesis, hypothesisId]);


  const hypothesisCardKpis = useMemo(() => {
    const paidCount = videos.filter((video) => (video.video_type || 'organic') === 'paid').length;
    const organicCount = videos.filter((video) => (video.video_type || 'organic') === 'organic').length;
    const liveCount = videos.filter((video) => (video.video_type || 'organic') === 'live').length;
    const withAudienceCount = videos.filter((video) => String(video.audience_id || '').trim()).length;
    const completionRatio = volume.minimum > 0 ? Math.min(1, volume.current / Math.max(1, volume.minimum)) : (videos.length ? 1 : 0);
    const completionPct = Math.round(completionRatio * 100);
    const statusLabel = completionPct >= 100 ? 'Objetivo alcanzado' : completionPct >= 70 ? 'En aceleración' : 'Etapa inicial';

    return {
      totalVideos: videos.length,
      paidCount,
      organicCount,
      liveCount,
      withAudienceCount,
      withoutAudienceCount: Math.max(0, videos.length - withAudienceCount),
      completionPct,
      statusLabel,
      sessionCount: availableSessions.length,
    };
  }, [videos, volume.minimum, volume.current, availableSessions.length]);

  const openCreateVideoModal = async () => {
    setShowLibraryModal(true);
  };

  const openMoveModal = async () => {
    setShowMoveModal(true);
    setShowActionsMenu(false);
    setMovePreview(null);
    try {
      const projectsRes = await fetch(`${backendBaseUrl()}/api/db/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ table: 'projects', operation: 'select' }),
      });
      const projectsJson = await projectsRes.json();
      const projects = projectsRes.ok ? (projectsJson.data || []) : [];
      setProjectsOptions(projects);

      const campaignsRes = await fetch(`${backendBaseUrl()}/api/db/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ table: 'campaigns', operation: 'select', filters: [{ field: 'project_id', value: moveForm.target_project_id }] }),
      });
      const campaignsJson = await campaignsRes.json();
      setCampaignOptions(campaignsRes.ok ? (campaignsJson.data || []) : []);
    } catch {
      setProjectsOptions([]);
      setCampaignOptions([]);
    }
  };


  const openHypothesisCardModal = () => {
    setShowHypothesisCardModal(true);
    setShowActionsMenu(false);
  };

  const updateMoveProject = async (nextProjectId) => {
    setMoveForm((current) => ({ ...current, target_project_id: nextProjectId, target_campaign_id: '' }));
    try {
      const campaignsRes = await fetch(`${backendBaseUrl()}/api/db/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ table: 'campaigns', operation: 'select', filters: [{ field: 'project_id', value: nextProjectId }] }),
      });
      const campaignsJson = await campaignsRes.json();
      setCampaignOptions(campaignsRes.ok ? (campaignsJson.data || []) : []);
    } catch {
      setCampaignOptions([]);
    }
  };

  const loadMovePreview = async () => {
    if (!moveForm.target_project_id || !moveForm.target_campaign_id) return;
    setMovePreviewLoading(true);
    try {
      const response = await fetch(`${backendBaseUrl()}/api/hypotheses/${hypothesisId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          target_project_id: moveForm.target_project_id,
          target_campaign_id: moveForm.target_campaign_id,
          dry_run: true,
          options: {
            move_videos: moveForm.move_videos,
            no_move_shared_videos: moveForm.no_move_shared_videos,
          },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudo previsualizar el movimiento');
      setMovePreview(json);
    } catch (error) {
      setMovePreview({ error: error.message });
    } finally {
      setMovePreviewLoading(false);
    }
  };

  const submitMove = async () => {
    setMoveSubmitting(true);
    try {
      const response = await fetch(`${backendBaseUrl()}/api/hypotheses/${hypothesisId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          target_project_id: moveForm.target_project_id,
          target_campaign_id: moveForm.target_campaign_id,
          options: {
            move_videos: moveForm.move_videos,
            no_move_shared_videos: moveForm.no_move_shared_videos,
          },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudo mover la hipótesis');
      toast({ title: 'Hipótesis movida', description: `Videos movidos: ${json.moved_videos_count || 0}. Compartidos omitidos: ${json.skipped_shared_videos_count || 0}.` });
      setShowMoveModal(false);
      navigate(`/projects/${moveForm.target_project_id}/campaigns/${moveForm.target_campaign_id}/hypotheses/${hypothesisId}`);
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setMoveSubmitting(false);
    }
  };



  const openEdit = (video) => {
    setAudienceVideo(video);
    setShowAudienceModal(true);
  };

  if (!hypothesis) return <div className="min-h-screen flex items-center justify-center">Cargando hipótesis...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Hypothesis Detail Dashboard</title></Helmet>
      <div className="max-w-6xl mx-auto">
        <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses`)} className="bg-white border text-gray-700 mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver a hipótesis</Button>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Hypothesis Detail Dashboard</h1>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}/analysis`)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Activity className="w-4 h-4 mr-2" />
                Análisis avanzado
              </Button>
              <Button onClick={openInCloud} className="bg-indigo-600 hover:bg-indigo-700 text-white">Abrir en Cloud</Button>
              <div className="relative">
                <Button className="bg-gray-200 text-gray-700" onClick={() => setShowActionsMenu((v) => !v)}><MoreHorizontal className="w-4 h-4" /></Button>
                {showActionsMenu ? (
                  <div className="absolute right-0 mt-1 w-44 bg-white border rounded-lg shadow-lg z-20 p-1">
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded" onClick={openMoveModal}>Mover hipótesis</button>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded" onClick={openHypothesisCardModal}>Ver tarjeta</button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-2">Tipo: {hypothesis.type} · Canal: {hypothesis.canal_principal || '-'}</p>
          <p className="mt-2">{hypothesis.hypothesis_statement || hypothesis.condition || 'Sin statement'}</p>
          <p className="text-sm text-gray-500 mt-2">X: {hypothesis.variable_x || '-'} · Umbral: {hypothesis.umbral_operador || ''} {hypothesis.umbral_valor ?? ''}</p>
          <p className="text-sm text-gray-500">Métrica objetivo (Y): {hypothesis.metrica_objetivo_y || '-'}</p>
          <p className="text-sm text-gray-500">Volumen mínimo: {volume.minimum} {volume.unit}</p>
          <p className="text-sm text-gray-500">Volumen actual: {volume.current} {volume.unit}</p>
          <p className="text-sm font-medium">
            Volumen mínimo cumplido: <span className={volume.meets_minimum ? 'text-green-600' : 'text-yellow-700'}>{volume.meets_minimum ? 'Sí' : 'No'}</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-semibold flex items-center gap-2"><Video className="w-5 h-5 text-purple-600" />Videos</h2><div className="flex items-center gap-2"><BulkVideoUpdateModal triggerClassName="bg-slate-900 text-cyan-300 border border-cyan-600 hover:bg-slate-800" onApplied={async () => { await fetchVideos(hypothesisId); }} /><Button className="bg-purple-600 text-white" onClick={openCreateVideoModal}><Plus className="w-4 h-4 mr-2" />Crear video {activeTab}</Button></div></div>

          <div className="flex gap-2 mb-4">{tabs.map((tab) => <Button key={tab} className={activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)}>{tab.toUpperCase()}</Button>)}</div>

          <p className="text-sm text-gray-600 mb-3">En esta vista, solo Público se edita por hipótesis. Las métricas y campos globales se editan en Biblioteca.</p>

          <div className="mb-4 rounded-xl border bg-gray-50 p-3">
            <div className="grid md:grid-cols-3 gap-2">
              <input className="rounded-lg border p-2" placeholder="Buscar videos..." value={videoSearchTerm} onChange={(event) => setVideoSearchTerm(event.target.value)} />
              <select className="rounded-lg border p-2" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
                <option value="all">Session ID (todas)</option>
                {availableSessions.map((sessionValue) => <option key={sessionValue} value={sessionValue}>{sessionValue}</option>)}
              </select>
              <Button className="bg-gray-200 text-gray-700" onClick={() => { setVideoSearchTerm(''); setSessionFilter('all'); }}>Limpiar filtros</Button>
            </div>
          </div>

          {tabVideos.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No hay videos {activeTab} todavía</div>
          ) : filteredTabVideos.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No hay resultados con los filtros aplicados.</div>
          ) : (
            <div className="space-y-3">
              {filteredTabVideos.map((video) => (
                <div key={video.id} className="rounded-xl border bg-gray-50 p-4 flex justify-between gap-3 cursor-pointer" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}/videos/${video.id}`)}>
                  <div>
                    <h3 className="font-semibold">{video.title}</h3>
                    <p className="text-sm text-gray-600">Session #{video.session_id ?? video.external_id ?? '—'}</p>
                    {video.is_reused_for_hypothesis ? <p className="mt-1 text-xs inline-flex bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Reutilizado de: {video.source_hypothesis_name || '—'}</p> : null}
                    <p className="text-sm text-gray-600">Público: {audiencesById.get(String(video.audience_id || ''))?.name || 'Sin público'}</p>
                    <p className="text-sm text-gray-600">Views: {video.views || 0} · Clicks: {video.clicks || 0} · CTR: {video.ctr || 0}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button className="bg-blue-100 text-blue-700" onClick={(event) => { event.stopPropagation(); openEdit(video); }}>Editar público</Button>
                    <Button className="bg-red-100 text-red-700" onClick={(event) => { event.stopPropagation(); deleteVideo(video.id, hypothesisId); }}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>



      <LibraryVideoModal
        isOpen={showLibraryModal}
        onClose={() => {
          setShowLibraryModal(false);
        }}
        mode="create"
        projectId={projectId}
        onSaved={async (savedVideo) => {
          if (savedVideo?.id) {
            await linkVideosToHypothesis(hypothesisId, [savedVideo.id]);
            setAudienceVideo(savedVideo);
            setShowAudienceModal(true);
          }
          await fetchVideos(hypothesisId);
        }}
      />

      <HypothesisAudienceModal
        isOpen={showAudienceModal}
        onClose={() => {
          setShowAudienceModal(false);
          setAudienceVideo(null);
        }}
        hypothesisId={hypothesisId}
        videoId={audienceVideo?.id}
        currentAudience={audienceVideo?.audience_id || ''}
        audiences={audiences}
        onSaved={async () => {
          await fetchVideos(hypothesisId);
        }}
      />


      {showHypothesisCardModal ? (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-4xl rounded-2xl border border-cyan-700/60 bg-slate-950 text-slate-100 shadow-[0_0_60px_rgba(34,211,238,0.2)] p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Tarjeta de hipótesis</p>
                <h3 className="text-2xl font-semibold text-white">{hypothesis?.title || 'Hipótesis activa'}</h3>
                <p className="text-sm text-slate-300 mt-1">Estado operativo: <span className="text-cyan-300 font-medium">{hypothesisCardKpis.statusLabel}</span></p>
              </div>
              <Button className="bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={() => setShowHypothesisCardModal(false)}>Cerrar</Button>
            </div>

            <div className="grid md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl border border-cyan-700/40 bg-slate-900/80 p-3">
                <p className="text-xs text-slate-400">Progreso de volumen</p>
                <p className="text-2xl font-semibold text-cyan-300">{hypothesisCardKpis.completionPct}%</p>
                <p className="text-xs text-slate-400 mt-1">{volume.current} / {volume.minimum || 0} {volume.unit}</p>
              </div>
              <div className="rounded-xl border border-indigo-700/40 bg-slate-900/80 p-3">
                <p className="text-xs text-slate-400">Videos vinculados</p>
                <p className="text-2xl font-semibold text-indigo-300">{hypothesisCardKpis.totalVideos}</p>
                <p className="text-xs text-slate-400 mt-1">Sesiones detectadas: {hypothesisCardKpis.sessionCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-700/40 bg-slate-900/80 p-3">
                <p className="text-xs text-slate-400">Públicos mapeados</p>
                <p className="text-2xl font-semibold text-emerald-300">{hypothesisCardKpis.withAudienceCount}</p>
                <p className="text-xs text-slate-400 mt-1">Sin público: {hypothesisCardKpis.withoutAudienceCount}</p>
              </div>
              <div className="rounded-xl border border-fuchsia-700/40 bg-slate-900/80 p-3">
                <p className="text-xs text-slate-400">Mix de tipo</p>
                <p className="text-sm text-slate-200 mt-2">Paid {hypothesisCardKpis.paidCount} · Organic {hypothesisCardKpis.organicCount} · Live {hypothesisCardKpis.liveCount}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
                <div className="flex items-center gap-2 text-cyan-300 mb-2"><Gauge className="w-4 h-4" /><p className="text-sm font-medium">Meta y umbral</p></div>
                <p className="text-sm text-slate-300">Y objetivo: {hypothesis?.metrica_objetivo_y || '-'}</p>
                <p className="text-sm text-slate-300">Umbral: {hypothesis?.umbral_operador || ''} {hypothesis?.umbral_valor ?? '-'}</p>
                <p className="text-xs text-slate-500 mt-2">X variable: {hypothesis?.variable_x || '-'}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
                <div className="flex items-center gap-2 text-indigo-300 mb-2"><BarChart3 className="w-4 h-4" /><p className="text-sm font-medium">Distribución operativa</p></div>
                <p className="text-sm text-slate-300">Canal principal: {hypothesis?.canal_principal || '-'}</p>
                <p className="text-sm text-slate-300">Tipo: {hypothesis?.type || '-'}</p>
                <p className="text-xs text-slate-500 mt-2">Actualizado para seguimiento táctico de performance.</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
                <div className="flex items-center gap-2 text-emerald-300 mb-2"><CheckCircle2 className="w-4 h-4" /><p className="text-sm font-medium">Salud de datos</p></div>
                <p className="text-sm text-slate-300">Volumen mínimo cumplido: {volume.meets_minimum ? 'Sí' : 'No'}</p>
                <p className="text-sm text-slate-300">Estructura activa: {hypothesisCardKpis.totalVideos > 0 ? 'Con datos' : 'Sin videos'}</p>
                <p className="text-xs text-slate-500 mt-2">Usa esta tarjeta para evaluar madurez antes de mover o escalar hipótesis.</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-cyan-700/30 bg-slate-900/60 p-3">
              <div className="flex items-center gap-2 text-cyan-300"><Layers3 className="w-4 h-4" /><p className="text-sm font-medium">Statement operativo</p></div>
              <p className="text-sm text-slate-200 mt-2">{hypothesis?.hypothesis_statement || hypothesis?.condition || 'Sin statement'}</p>
            </div>
          </div>
        </div>
      ) : null}

      {showMoveModal ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Mover hipótesis</h3>
              <Button className="bg-gray-200 text-gray-700" onClick={() => setShowMoveModal(false)}>Cerrar</Button>
            </div>

            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1">Proyecto destino</label>
                <select className="w-full rounded-lg border p-2" value={moveForm.target_project_id} onChange={(e) => updateMoveProject(e.target.value)}>
                  <option value="">Selecciona proyecto</option>
                  {projectsOptions.map((project) => <option key={project.id} value={project.id}>{project.name || project.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Campaña destino</label>
                <select className="w-full rounded-lg border p-2" value={moveForm.target_campaign_id} onChange={(e) => setMoveForm((current) => ({ ...current, target_campaign_id: e.target.value }))}>
                  <option value="">Selecciona campaña</option>
                  {campaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name || campaign.id}</option>)}
                </select>
              </div>
            </div>

            <div className="rounded-lg border p-3 mb-3 space-y-2 bg-gray-50">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moveForm.move_videos} onChange={(e) => setMoveForm((current) => ({ ...current, move_videos: e.target.checked }))} />Mover también videos compatibles</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moveForm.no_move_shared_videos} onChange={(e) => setMoveForm((current) => ({ ...current, no_move_shared_videos: e.target.checked }))} />No mover videos compartidos</label>
              <p className="text-xs text-gray-600">Se moverá la hipótesis y sus vínculos. Los videos compartidos no se moverán automáticamente si esta opción está activa.</p>
            </div>

            <div className="mb-3">
              <Button className="bg-gray-200 text-gray-700" onClick={loadMovePreview} disabled={movePreviewLoading || !moveForm.target_project_id || !moveForm.target_campaign_id}>{movePreviewLoading ? 'Analizando...' : 'Analizar impacto'}</Button>
            </div>

            {movePreview ? (
              <div className="rounded-lg border p-3 mb-3 text-sm bg-white">
                {movePreview.error ? <p className="text-red-600">{movePreview.error}</p> : (
                  <>
                    <p>Videos vinculados: <strong>{movePreview.linked_videos_count || 0}</strong></p>
                    <p>Videos que se moverán: <strong>{movePreview.will_move_videos_count || 0}</strong></p>
                    <p>Videos compartidos omitidos: <strong>{movePreview.skipped_shared_videos_count || 0}</strong></p>
                    <p className="text-xs text-gray-600 mt-1">Cloud: se moverá la carpeta de la hipótesis al destino y se mantendrán/actualizarán links de videos según reglas.</p>
                  </>
                )}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button className="bg-gray-200 text-gray-700" onClick={() => setShowMoveModal(false)}>Cancelar</Button>
              <Button className="bg-indigo-600 text-white" disabled={moveSubmitting || !moveForm.target_project_id || !moveForm.target_campaign_id} onClick={submitMove}>{moveSubmitting ? 'Moviendo...' : 'Mover'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HypothesisDetailPage;
