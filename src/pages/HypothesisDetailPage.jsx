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

const numericFields = ['clicks','views','views_profile','initiatest','initiate_checkouts','view_content','formulario_lead','purchase','likes','comments','shares','saves','nuevos_seguidores','cpc','ctr','pico_viewers','viewers_prom','duracion_min','duracion_seg','duracion_del_video_seg','views_finish_pct','retencion_pct','tiempo_prom_seg'];

const fieldMapByType = {
  live: ['external_id','title','audience_id','hook_texto','hook_tipo','cta_texto','cta_tipo','creative_id','contexto_cualitativo','clicks','views','views_profile','initiatest','pico_viewers','viewers_prom','duracion_min','nuevos_seguidores','likes','comments','shares','saves'],
  organic: ['external_id','title','audience_id','hook_texto','hook_tipo','cta_texto','cta_tipo','creative_id','contexto_cualitativo','clicks','views','views_profile','nuevos_seguidores','initiatest','initiate_checkouts','view_content','formulario_lead','purchase','organic_piece_type','likes','comments','shares','saves','url','views_finish_pct','retencion_pct','tiempo_prom_seg','duracion_seg'],
  paid: ['external_id','title','audience_id','hook_texto','hook_tipo','cta_texto','cta_tipo','creative_id','contexto_cualitativo','clicks','views','views_profile','nuevos_seguidores','initiatest','initiate_checkouts','view_content','formulario_lead','purchase','cpc','ctr','duracion_del_video_seg','campaign_id_ref','ad_set_id'],
};

const labels = {
  external_id: 'session_id / ad_id / live_id', title: 'Nombre del video', audience_id: 'Público (audiencia opcional)', hook_texto: 'Hook texto', hook_tipo: 'Hook tipo', cta_texto: 'CTA texto', cta_tipo: 'CTA tipo', creative_id: 'Creative ID', contexto_cualitativo: 'Contexto cualitativo',
  clicks: 'Clicks', views: 'Views', views_profile: 'Views profile', initiatest: 'Initiatest', initiate_checkouts: 'Initiate checkouts', view_content: 'View content', formulario_lead: 'Formulario lead', purchase: 'Purchase', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', nuevos_seguidores: 'Nuevos seguidores',
  cpc: 'CPC', ctr: 'CTR', pico_viewers: 'Pico viewers', viewers_prom: 'Viewers prom', duracion_min: 'Duración (min)', duracion_seg: 'Duración (seg)', duracion_del_video_seg: 'Duración del video (seg)', organic_piece_type: 'Organic piece type', url: 'URL del video', views_finish_pct: '% views finish', retencion_pct: '% retención', tiempo_prom_seg: 'Tiempo prom (seg)',
  campaign_id_ref: 'Campaign ID (ad platform)', ad_set_id: 'Ad set ID',
};

const HypothesisDetailPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { videos, fetchVideos, createVideo, deleteVideo } = useVideos();
  const { audiences, fetchAudiences } = useAudiences();

  const [activeTab, setActiveTab] = useState('paid');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(baseVideo);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editForm, setEditForm] = useState(baseVideo);

  const openInCloud = async () => {
    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'}/api/cloud/locate?targetType=hypothesis&targetId=${hypothesisId}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
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

  const hypothesis = useMemo(() => hypotheses.find((h) => h.id === hypothesisId), [hypotheses, hypothesisId]);
  const tabVideos = useMemo(() => videos.filter((video) => (video.video_type || 'organic') === activeTab), [videos, activeTab]);
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
    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    const payload = { ...editForm };
    numericFields.forEach((field) => { payload[field] = Number(payload[field] || 0); });
    delete payload.id;
    delete payload.user_id;
    delete payload.hypothesis_id;
    delete payload.video_type;
    const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'}/api/videos/${editingVideo.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
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
          <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-semibold flex items-center gap-2"><Video className="w-5 h-5 text-purple-600" />Videos</h2><div className="flex items-center gap-2"><BulkVideoUpdateModal triggerClassName="bg-slate-900 text-cyan-300 border border-cyan-600 hover:bg-slate-800" onApplied={async () => { await fetchVideos(hypothesisId); }} /><Button className="bg-purple-600 text-white" onClick={() => setShowForm((v) => !v)}><Plus className="w-4 h-4 mr-2" />Crear video {activeTab}</Button></div></div>

          <div className="flex gap-2 mb-4">{tabs.map((tab) => <Button key={tab} className={activeTab===tab? 'bg-purple-600 text-white':'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)}>{tab.toUpperCase()}</Button>)}</div>

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
          ) : (
            <div className="space-y-3">
              {tabVideos.map((video) => (
                <div key={video.id} className="rounded-xl border bg-gray-50 p-4 flex justify-between gap-3 cursor-pointer" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesisId}/videos/${video.id}`)}>
                  <div>
                    <h3 className="font-semibold">{video.title}</h3>
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

    </div>
  );
};

export default HypothesisDetailPage;
