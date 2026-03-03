import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, MoreHorizontal, Plus, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useVideos } from '@/contexts/VideoContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { buildVolumeSnapshot } from '@/lib/analysis/volume';
import { useToast } from '@/components/ui/use-toast';
import BulkVideoUpdateModal from '@/components/BulkVideoUpdateModal';
import VideoCreateModal from '@/components/VideoCreateModal';
import { baseVideo, fieldMapByType, labels, numericFields } from '@/components/videoFormConfig';

const tabs = ['paid', 'organic', 'live'];

const backendBaseUrl = () => import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const token = () => JSON.parse(localStorage.getItem('mysql_backend_session') || 'null')?.access_token || '';

const HypothesisDetailPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { videos, fetchVideos, deleteVideo, fetchCampaignVideos, linkVideosToHypothesis } = useVideos();
  const { audiences, fetchAudiences } = useAudiences();

  const [activeTab, setActiveTab] = useState('paid');
  const [showVideoCreateModal, setShowVideoCreateModal] = useState(false);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editForm, setEditForm] = useState(baseVideo);
  const [videoSearchTerm, setVideoSearchTerm] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState('menu');
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [selectedReuseVideoIds, setSelectedReuseVideoIds] = useState([]);
  const [reuseSearchTerm, setReuseSearchTerm] = useState('');
  const [reuseSessionFilter, setReuseSessionFilter] = useState('all');
  const [linking, setLinking] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
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
    const response = await fetch(`${backendBaseUrl()}/api/cloud/locate?targetType=hypothesis&targetId=${hypothesisId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (response.ok) {
      const json = await response.json();
      navigate(`/cloud/${json.parentId || json.nodeId}`);
    }
  };

  useEffect(() => {
    fetchHypotheses(campaignId);
    fetchAudiences(campaignId);
    fetchVideos(hypothesisId);
  }, [campaignId, hypothesisId, fetchHypotheses, fetchAudiences, fetchVideos]);

  useEffect(() => {
    if (!showCreateModal || createMode !== 'reuse') return;
    (async () => {
      try {
        const result = await fetchCampaignVideos(campaignId, { video_type: activeTab });
        setLibraryVideos(result.data || []);
      } catch {
        setLibraryVideos([]);
      }
    })();
  }, [showCreateModal, createMode, campaignId, activeTab, fetchCampaignVideos]);

  const hypothesis = useMemo(() => hypotheses.find((h) => h.id === hypothesisId), [hypotheses, hypothesisId]);
  const tabVideos = useMemo(() => videos.filter((video) => (video.video_type || 'organic') === activeTab), [videos, activeTab]);

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

  const reuseAvailableSessions = useMemo(() => {
    const values = new Set();
    libraryVideos.forEach((video) => {
      const sessionValue = video.session_id ?? video.external_id;
      if (sessionValue != null && String(sessionValue).trim() !== '') values.add(String(sessionValue));
    });
    return [...values];
  }, [libraryVideos]);

  const filteredSourceVideos = useMemo(() => {
    const q = reuseSearchTerm.trim().toLowerCase();
    return libraryVideos.filter((video) => {
      const sessionValue = String(video.session_id ?? video.external_id ?? '').trim();
      if (reuseSessionFilter !== 'all' && sessionValue !== reuseSessionFilter) return false;
      if (!q) return true;
      return [video.title, video.name, video.hook_texto, video.cta_texto].join(' ').toLowerCase().includes(q);
    });
  }, [libraryVideos, reuseSearchTerm, reuseSessionFilter]);

  const volume = useMemo(() => buildVolumeSnapshot({
    videos,
    minimum: hypothesis?.volumen_minimo || 0,
    unit: hypothesis?.volumen_unidad || 'videos',
    hypothesisId,
  }), [videos, hypothesis, hypothesisId]);

  const openCreateVideoModal = async () => {
    setShowCreateModal(true);
    setCreateMode('menu');
    setLibraryVideos([]);
    setSelectedReuseVideoIds([]);
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

  const toggleSelectedReuseVideo = (videoId) => {
    setSelectedReuseVideoIds((current) => {
      if (current.includes(videoId)) return current.filter((id) => id !== videoId);
      if (current.length >= 2) return current;
      return [...current, videoId];
    });
  };

  const onLinkSelectedVideos = async () => {
    if (!selectedReuseVideoIds.length) return;
    setLinking(true);
    try {
      const result = await linkVideosToHypothesis(hypothesisId, selectedReuseVideoIds);
      await fetchVideos(hypothesisId);
      toast({
        title: 'Videos reutilizados',
        description: `Vinculados: ${result?.linked?.length || 0}. Ya vinculados: ${result?.already_linked?.length || 0}.`,
      });
      setShowCreateModal(false);
      setCreateMode('menu');
      setSelectedReuseVideoIds([]);
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  const renderInput = (field) => {
    const source = editForm;
    const setter = setEditForm;
    if (field === 'audience_id') {
      return (
        <select className="w-full rounded-lg border p-2" value={source.audience_id} onChange={(e) => setter({ ...source, audience_id: e.target.value })}>
          <option value="">Sin público</option>
          {audiences.map((aud) => <option key={aud.id} value={aud.id}>{aud.name}</option>)}
        </select>
      );
    }

    if (field === 'contexto_cualitativo') {
      return <textarea className="w-full rounded-lg border p-2" rows="2" value={source[field]} onChange={(e) => setter({ ...source, [field]: e.target.value })} />;
    }

    const isNumeric = numericFields.includes(field);
    return <input type={isNumeric ? 'number' : 'text'} className="w-full rounded-lg border p-2" required={field === 'title'} value={source[field]} onChange={(e) => setter({ ...source, [field]: e.target.value })} />;
  };

  const openEdit = (video) => {
    setEditingVideo(video);
    setEditForm({ ...baseVideo, ...video });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingVideo) return;
    const payload = { ...editForm };
    numericFields.forEach((field) => { payload[field] = Number(payload[field] || 0); });
    delete payload.id;
    delete payload.user_id;
    delete payload.hypothesis_id;
    delete payload.video_type;
    const response = await fetch(`${backendBaseUrl()}/api/videos/${editingVideo.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      setEditingVideo(null);
      await fetchVideos(hypothesisId);
    }
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

          {editingVideo && (
            <form onSubmit={saveEdit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-blue-50 mb-6">
              {fieldMapByType[editingVideo.video_type || activeTab].map((field) => (
                <div key={field} className={field === 'contexto_cualitativo' ? 'md:col-span-2' : ''}>
                  <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
                  {renderInput(field)}
                </div>
              ))}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" className="bg-blue-600 text-white">Guardar cambios</Button>
                <Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setEditingVideo(null)}>Cancelar</Button>
              </div>
            </form>
          )}

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
                    <p className="text-sm text-gray-600">Views: {video.views || 0} · Clicks: {video.clicks || 0} · CTR: {video.ctr || 0}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button className="bg-blue-100 text-blue-700" onClick={(event) => { event.stopPropagation(); openEdit(video); }}>Editar</Button>
                    <Button className="bg-red-100 text-red-700" onClick={(event) => { event.stopPropagation(); deleteVideo(video.id, hypothesisId); }}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Crear video ({activeTab.toUpperCase()})</h3>
              <Button className="bg-gray-200 text-gray-700" onClick={() => setShowCreateModal(false)}>Cerrar</Button>
            </div>

            {createMode === 'menu' && (
              <div className="grid md:grid-cols-2 gap-3">
                <button type="button" className="rounded-xl border p-4 text-left hover:border-purple-300" onClick={() => { setCreateMode('new'); setShowCreateModal(false); setShowVideoCreateModal(true); }}>
                  <p className="font-semibold">Crear nuevo</p>
                  <p className="text-sm text-gray-600">Abrir el formulario actual de creación para {activeTab.toUpperCase()}.</p>
                </button>
                <button type="button" className="rounded-xl border p-4 text-left hover:border-purple-300" onClick={() => setCreateMode('reuse')}>
                  <p className="font-semibold">Elegir de biblioteca</p>
                  <p className="text-sm text-gray-600">Vincula 1 o 2 videos de la biblioteca global de la campaña.</p>
                </button>
              </div>
            )}

            {createMode === 'reuse' && (
              <div className="space-y-3">
                <div className="grid md:grid-cols-3 gap-2">
                  <input className="rounded-lg border p-2" placeholder="Buscar videos..." value={reuseSearchTerm} onChange={(e) => setReuseSearchTerm(e.target.value)} />
                  <select className="rounded-lg border p-2" value={reuseSessionFilter} onChange={(e) => setReuseSessionFilter(e.target.value)}>
                    <option value="all">Session ID (todas)</option>
                    {reuseAvailableSessions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <Button className="bg-gray-200 text-gray-700" onClick={() => { setReuseSearchTerm(''); setReuseSessionFilter('all'); }}>Limpiar filtros</Button>
                </div>

                <div className="max-h-72 overflow-auto space-y-2">
                  {filteredSourceVideos.map((video) => (
                    <button key={video.id} type="button" className={`w-full text-left rounded-lg border p-3 ${selectedReuseVideoIds.includes(video.id) ? 'border-purple-400 bg-purple-50' : 'bg-white'}`} onClick={() => toggleSelectedReuseVideo(video.id)}>
                      <p className="font-medium">{video.title || video.name || '—'} <span className="text-xs text-gray-500">({video.video_type || '—'})</span></p>
                      <p className="text-sm text-gray-600">Público: {audiences.find((a) => a.id === video.audience_id)?.name || '—'}</p>
                      <p className="text-sm text-gray-600">Hook: {video.hook_texto || '—'} · CTA: {video.cta_texto || '—'}</p>
                      <p className="text-sm text-gray-600">Session: {video.session_id ?? video.external_id ?? '—'}</p>
                    </button>
                  ))}
                  {filteredSourceVideos.length === 0 ? <p className="text-sm text-gray-500">No hay videos de biblioteca para este filtro.</p> : null}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button className="bg-gray-200 text-gray-700" onClick={() => setCreateMode('menu')}>Volver</Button>
                  <Button className="bg-purple-600 text-white" disabled={!selectedReuseVideoIds.length || linking} onClick={onLinkSelectedVideos}>Reutilizar seleccionados ({selectedReuseVideoIds.length}/2)</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <VideoCreateModal
        isOpen={showVideoCreateModal}
        onClose={() => setShowVideoCreateModal(false)}
        defaultType={activeTab}
        campaignId={campaignId}
        hypothesisId={hypothesisId}
        audiences={audiences}
        onCreated={async () => {
          await fetchVideos(hypothesisId);
        }}
      />

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
