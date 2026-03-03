import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Plus, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useVideos } from '@/contexts/VideoContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { buildVolumeSnapshot } from '@/lib/analysis/volume';
import { useToast } from '@/components/ui/use-toast';
import BulkVideoUpdateModal from '@/components/BulkVideoUpdateModal';

const tabs = ['paid', 'organic', 'live'];
const baseVideo = {
  title: '', audience_id: '', external_id: '', hook_texto: '', hook_tipo: '', cta_texto: '', cta_tipo: '', creative_id: '',
  contexto_cualitativo: '', clicks: 0, views: 0, views_profile: 0, initiatest: 0, initiate_checkouts: 0, view_content: 0, formulario_lead: 0,
  purchase: 0, likes: 0, comments: 0, shares: 0, saves: 0, nuevos_seguidores: 0, cpc: 0, ctr: 0, pico_viewers: 0, viewers_prom: 0,
  duracion_min: 0, duracion_seg: 0, duracion_del_video_seg: 0, organic_piece_type: '', url: '', views_finish_pct: 0, retencion_pct: 0,
  tiempo_prom_seg: 0, campaign_id_ref: '', ad_set_id: '',
};

const numericFields = ['clicks', 'views', 'views_profile', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'likes', 'comments', 'shares', 'saves', 'nuevos_seguidores', 'cpc', 'ctr', 'pico_viewers', 'viewers_prom', 'duracion_min', 'duracion_seg', 'duracion_del_video_seg', 'views_finish_pct', 'retencion_pct', 'tiempo_prom_seg'];

const fieldMapByType = {
  live: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'initiatest', 'pico_viewers', 'viewers_prom', 'duracion_min', 'nuevos_seguidores', 'likes', 'comments', 'shares', 'saves'],
  organic: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'nuevos_seguidores', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'organic_piece_type', 'likes', 'comments', 'shares', 'saves', 'url', 'views_finish_pct', 'retencion_pct', 'tiempo_prom_seg', 'duracion_seg'],
  paid: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'nuevos_seguidores', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'cpc', 'ctr', 'duracion_del_video_seg', 'campaign_id_ref', 'ad_set_id'],
};

const labels = {
  external_id: 'session_id / ad_id / live_id', title: 'Nombre del video', audience_id: 'Público (audiencia opcional)', hook_texto: 'Hook texto', hook_tipo: 'Hook tipo', cta_texto: 'CTA texto', cta_tipo: 'CTA tipo', creative_id: 'Creative ID', contexto_cualitativo: 'Contexto cualitativo',
  clicks: 'Clicks', views: 'Views', views_profile: 'Views profile', initiatest: 'Initiatest', initiate_checkouts: 'Initiate checkouts', view_content: 'View content', formulario_lead: 'Formulario lead', purchase: 'Purchase', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', nuevos_seguidores: 'Nuevos seguidores',
  cpc: 'CPC', ctr: 'CTR', pico_viewers: 'Pico viewers', viewers_prom: 'Viewers prom', duracion_min: 'Duración (min)', duracion_seg: 'Duración (seg)', duracion_del_video_seg: 'Duración del video (seg)', organic_piece_type: 'Organic piece type', url: 'URL del video', views_finish_pct: '% views finish', retencion_pct: '% retención', tiempo_prom_seg: 'Tiempo prom (seg)',
  campaign_id_ref: 'Campaign ID (ad platform)', ad_set_id: 'Ad set ID',
};

const backendBaseUrl = () => import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const token = () => JSON.parse(localStorage.getItem('mysql_backend_session') || 'null')?.access_token || '';

const HypothesisDetailPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { videos, fetchVideos, createVideo, deleteVideo, fetchProjectHypotheses, linkVideosToHypothesis } = useVideos();
  const { audiences, fetchAudiences } = useAudiences();

  const [activeTab, setActiveTab] = useState('paid');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(baseVideo);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editForm, setEditForm] = useState(baseVideo);
  const [videoSearchTerm, setVideoSearchTerm] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState('menu');
  const [sourceHypotheses, setSourceHypotheses] = useState([]);
  const [sourceHypothesisId, setSourceHypothesisId] = useState('');
  const [sourceVideos, setSourceVideos] = useState([]);
  const [selectedReuseVideoIds, setSelectedReuseVideoIds] = useState([]);
  const [reuseSearchTerm, setReuseSearchTerm] = useState('');
  const [reuseSessionFilter, setReuseSessionFilter] = useState('all');
  const [linking, setLinking] = useState(false);

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
    if (!showCreateModal || createMode !== 'reuse' || !sourceHypothesisId) return;
    (async () => {
      const response = await fetch(`${backendBaseUrl()}/api/hypotheses/${sourceHypothesisId}/videos?video_type=${activeTab}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await response.json();
      setSourceVideos(Array.isArray(json.data) ? json.data : []);
    })();
  }, [showCreateModal, createMode, sourceHypothesisId, activeTab]);

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
    sourceVideos.forEach((video) => {
      const sessionValue = video.session_id ?? video.external_id;
      if (sessionValue != null && String(sessionValue).trim() !== '') values.add(String(sessionValue));
    });
    return [...values];
  }, [sourceVideos]);

  const filteredSourceVideos = useMemo(() => {
    const q = reuseSearchTerm.trim().toLowerCase();
    return sourceVideos.filter((video) => {
      const sessionValue = String(video.session_id ?? video.external_id ?? '').trim();
      if (reuseSessionFilter !== 'all' && sessionValue !== reuseSessionFilter) return false;
      if (!q) return true;
      return [video.title, video.name, video.hook_texto, video.cta_texto].join(' ').toLowerCase().includes(q);
    });
  }, [sourceVideos, reuseSearchTerm, reuseSessionFilter]);

  const volume = useMemo(() => buildVolumeSnapshot({
    videos,
    minimum: hypothesis?.volumen_minimo || 0,
    unit: hypothesis?.volumen_unidad || 'videos',
    hypothesisId,
  }), [videos, hypothesis, hypothesisId]);

  const onCreateVideo = async (event) => {
    event.preventDefault();
    const payload = { ...form, hypothesis_id: hypothesisId, video_type: activeTab };
    numericFields.forEach((field) => { payload[field] = Number(payload[field] || 0); });
    const result = await createVideo(payload);
    if (result) {
      setForm(baseVideo);
      setShowForm(false);
    }
  };

  const openCreateVideoModal = async () => {
    const allHypotheses = await fetchProjectHypotheses(projectId);
    setSourceHypotheses(allHypotheses.filter((item) => item.id !== hypothesisId));
    setShowCreateModal(true);
    setCreateMode('menu');
    setSourceHypothesisId('');
    setSourceVideos([]);
    setSelectedReuseVideoIds([]);
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
    const source = editingVideo ? editForm : form;
    const setter = editingVideo ? setEditForm : setForm;
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
            <Button
              onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}/analysis`)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Activity className="w-4 h-4 mr-2" />
              Análisis avanzado
            </Button>
            <Button onClick={openInCloud} className="bg-indigo-600 hover:bg-indigo-700 text-white">Abrir en Cloud</Button>
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

          {showForm && (
            <form onSubmit={onCreateVideo} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50 mb-6">
              {fieldMapByType[activeTab].map((field) => (
                <div key={field} className={field === 'contexto_cualitativo' ? 'md:col-span-2' : ''}>
                  <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
                  {renderInput(field)}
                </div>
              ))}
              <div className="md:col-span-2 flex gap-2"><Button type="submit" className="bg-purple-600 text-white">Crear video {activeTab}</Button><Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowForm(false)}>Cancelar</Button></div>
            </form>
          )}

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
                <button type="button" className="rounded-xl border p-4 text-left hover:border-purple-300" onClick={() => { setCreateMode('new'); setShowCreateModal(false); setShowForm(true); }}>
                  <p className="font-semibold">Crear nuevo</p>
                  <p className="text-sm text-gray-600">Abrir el formulario actual de creación para {activeTab.toUpperCase()}.</p>
                </button>
                <button type="button" className="rounded-xl border p-4 text-left hover:border-purple-300" onClick={() => setCreateMode('reuse')}>
                  <p className="font-semibold">Reutilizar existente</p>
                  <p className="text-sm text-gray-600">Vincula 1 o 2 videos desde otra hipótesis del mismo proyecto.</p>
                </button>
              </div>
            )}

            {createMode === 'reuse' && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Hipótesis origen</label>
                  <select className="w-full rounded-lg border p-2 mt-1" value={sourceHypothesisId} onChange={(event) => { setSourceHypothesisId(event.target.value); setSelectedReuseVideoIds([]); }}>
                    <option value="">Seleccionar hipótesis</option>
                    {sourceHypotheses.map((item) => (
                      <option key={item.id} value={item.id}>{item.type} · {item.hypothesis_statement || item.condition || item.id}</option>
                    ))}
                  </select>
                </div>

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
                  {sourceHypothesisId && filteredSourceVideos.length === 0 ? <p className="text-sm text-gray-500">No hay videos para este filtro.</p> : null}
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
    </div>
  );
};

export default HypothesisDetailPage;
