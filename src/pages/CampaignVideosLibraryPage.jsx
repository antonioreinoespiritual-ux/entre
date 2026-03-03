import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, Link2, Video } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useVideos } from '@/contexts/VideoContext';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { useToast } from '@/components/ui/use-toast';

const typeOptions = ['all', 'paid', 'organic', 'live'];

const CampaignVideosLibraryPage = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { fetchCampaignVideos, createCampaignVideo, linkVideoToHypotheses } = useVideos();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { audiences, fetchAudiences } = useAudiences();

  const [campaign, setCampaign] = useState(null);
  const [videos, setVideos] = useState([]);
  const [search, setSearch] = useState('');
  const [videoType, setVideoType] = useState('all');
  const [sessionId, setSessionId] = useState('');
  const [usageFilter, setUsageFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [selectedHypothesisIds, setSelectedHypothesisIds] = useState([]);
  const [newVideo, setNewVideo] = useState({ hypothesis_id: '', title: '', video_type: 'organic', external_id: '' });

  const audienceById = useMemo(() => new Map((audiences || []).map((aud) => [aud.id, aud.name || '—'])), [audiences]);

  const loadVideos = async () => {
    const result = await fetchCampaignVideos(campaignId, {
      search,
      video_type: videoType === 'all' ? '' : videoType,
      session_id: sessionId,
      usage: usageFilter === 'all' ? '' : usageFilter,
    });
    setCampaign(result.campaign || null);
    setVideos(result.data || []);
  };

  useEffect(() => {
    fetchHypotheses(campaignId);
    fetchAudiences(campaignId);
  }, [campaignId, fetchHypotheses, fetchAudiences]);

  useEffect(() => {
    loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, videoType, usageFilter]);

  const onCreateVideo = async (event) => {
    event.preventDefault();
    try {
      await createCampaignVideo(campaignId, newVideo);
      toast({ title: 'Video creado', description: 'Video agregado a la biblioteca de campaña.' });
      setShowCreate(false);
      setNewVideo({ hypothesis_id: '', title: '', video_type: 'organic', external_id: '' });
      await loadVideos();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const openLinkModal = (video) => {
    setSelectedVideo(video);
    setSelectedHypothesisIds([]);
    setShowLinkModal(true);
  };

  const toggleHypothesis = (id) => {
    setSelectedHypothesisIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const onLinkVideo = async () => {
    if (!selectedVideo || !selectedHypothesisIds.length) return;
    try {
      const result = await linkVideoToHypotheses(selectedVideo.id, selectedHypothesisIds);
      toast({ title: 'Vínculos actualizados', description: `Vinculados: ${result.linked?.length || 0}. Ya vinculados: ${result.already_linked?.length || 0}.` });
      setShowLinkModal(false);
      await loadVideos();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const applySearch = async () => {
    await loadVideos();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Biblioteca de videos</title></Helmet>
      <div className="max-w-7xl mx-auto">
        <Button onClick={() => navigate(`/campaigns/${campaignId}`)} className="bg-white border text-gray-700 mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver a campaña</Button>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="w-6 h-6 text-purple-600" />Biblioteca de videos</h1>
          <p className="text-gray-600 mt-1">{campaign?.name || 'Campaña'} · Gestiona videos globales y reutilízalos en hipótesis.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="grid md:grid-cols-5 gap-2 mb-4">
            <input className="rounded-lg border p-2" placeholder="Buscar por nombre/hook/cta" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="rounded-lg border p-2" value={videoType} onChange={(e) => setVideoType(e.target.value)}>{typeOptions.map((value) => <option key={value} value={value}>{value === 'all' ? 'Tipo (todos)' : value.toUpperCase()}</option>)}</select>
            <input className="rounded-lg border p-2" placeholder="Filtrar session_id" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            <select className="rounded-lg border p-2" value={usageFilter} onChange={(e) => setUsageFilter(e.target.value)}>
              <option value="all">Uso (todos)</option>
              <option value="used">Usados</option>
              <option value="unused">No usados</option>
            </select>
            <div className="flex gap-2">
              <Button className="bg-gray-200 text-gray-700" onClick={applySearch}>Filtrar</Button>
              <Button className="bg-purple-600 text-white" onClick={() => setShowCreate(true)}>Crear video</Button>
            </div>
          </div>

          <div className="space-y-3">
            {videos.map((video) => (
              <div key={video.id} className="rounded-xl border bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">#{video.video_id ?? '—'} · {video.title || '—'} <span className="text-xs text-gray-500">({video.video_type || '—'})</span></p>
                    <p className="text-sm text-gray-600">Session: {video.session_id ?? video.external_id ?? '—'} · Público: {audienceById.get(video.audience_id) || '—'}</p>
                    <p className="text-sm text-gray-600">Hook: {video.hook_texto || '—'} · CTA: {video.cta_texto || '—'}</p>
                    <p className="text-sm text-gray-600">Views: {video.views || 0} · Likes: {video.likes || 0} · Comments: {video.comments || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Usado en: {video.used_in_hypotheses || 0} hipótesis</p>
                    {Array.isArray(video.linked_hypotheses) && video.linked_hypotheses.length > 0 ? <p className="text-xs text-gray-500">{video.linked_hypotheses.join(' · ')}</p> : null}
                  </div>
                  <Button className="bg-indigo-600 text-white" onClick={() => openLinkModal(video)}><Link2 className="w-4 h-4 mr-2" />Vincular a hipótesis…</Button>
                </div>
              </div>
            ))}
            {videos.length === 0 ? <div className="text-center py-10 text-gray-500">No hay videos para estos filtros.</div> : null}
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl p-5">
            <h3 className="text-lg font-semibold mb-3">Crear video global en campaña</h3>
            <form onSubmit={onCreateVideo} className="space-y-3">
              <select className="w-full rounded-lg border p-2" required value={newVideo.hypothesis_id} onChange={(e) => setNewVideo({ ...newVideo, hypothesis_id: e.target.value })}>
                <option value="">Hipótesis de origen (legacy)</option>
                {hypotheses.map((hyp) => <option key={hyp.id} value={hyp.id}>{hyp.type} · {hyp.hypothesis_statement || hyp.condition || hyp.id}</option>)}
              </select>
              <input className="w-full rounded-lg border p-2" required placeholder="Nombre del video" value={newVideo.title} onChange={(e) => setNewVideo({ ...newVideo, title: e.target.value })} />
              <select className="w-full rounded-lg border p-2" value={newVideo.video_type} onChange={(e) => setNewVideo({ ...newVideo, video_type: e.target.value })}>{['paid', 'organic', 'live'].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}</select>
              <input className="w-full rounded-lg border p-2" placeholder="session/ad/live id (opcional)" value={newVideo.external_id} onChange={(e) => setNewVideo({ ...newVideo, external_id: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowCreate(false)}>Cancelar</Button>
                <Button type="submit" className="bg-purple-600 text-white">Crear video</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLinkModal && selectedVideo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl p-5">
            <h3 className="text-lg font-semibold mb-3">Vincular “{selectedVideo.title || selectedVideo.id}” a hipótesis</h3>
            <div className="max-h-72 overflow-auto space-y-2">
              {hypotheses.map((hyp) => (
                <button key={hyp.id} type="button" className={`w-full text-left rounded-lg border p-3 ${selectedHypothesisIds.includes(hyp.id) ? 'border-indigo-400 bg-indigo-50' : 'bg-white'}`} onClick={() => toggleHypothesis(hyp.id)}>
                  <p className="font-medium">{hyp.type}</p>
                  <p className="text-sm text-gray-600">{hyp.hypothesis_statement || hyp.condition || hyp.id}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button className="bg-gray-200 text-gray-700" onClick={() => setShowLinkModal(false)}>Cancelar</Button>
              <Button className="bg-indigo-600 text-white" disabled={!selectedHypothesisIds.length} onClick={onLinkVideo}>Vincular seleccionadas</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CampaignVideosLibraryPage;
