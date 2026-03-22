import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, Link2, MoreHorizontal, Pencil, Trash2, Video } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useVideos } from '@/contexts/VideoContext';
import { useToast } from '@/components/ui/use-toast';
import LibraryVideoModal from '@/components/LibraryVideoModal';

const typeOptions = ['all', 'paid', 'organic', 'live'];

const CampaignVideosLibraryPage = () => {
  const { projectId: routeProjectId, campaignId } = useParams();
  const [resolvedProjectId, setResolvedProjectId] = useState(routeProjectId || '');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { fetchProjectVideos, fetchCampaignVideos, fetchProjectHypotheses, linkVideoToHypotheses, deleteVideo } = useVideos();
  const [hypotheses, setHypotheses] = useState([]);

  const [project, setProject] = useState(null);
  const [videos, setVideos] = useState([]);
  const [search, setSearch] = useState('');
  const [videoType, setVideoType] = useState('all');
  const [sessionId, setSessionId] = useState('');
  const [usageFilter, setUsageFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingVideo, setEditingVideo] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [selectedHypothesisIds, setSelectedHypothesisIds] = useState([]);
  const [openActionMenuVideoId, setOpenActionMenuVideoId] = useState(null);

  useEffect(() => {
    if (routeProjectId) {
      setResolvedProjectId(routeProjectId);
      return;
    }
    if (!campaignId) return;
    (async () => {
      try {
        const result = await fetchCampaignVideos(campaignId);
        const pid = result?.campaign?.project_id || '';
        setResolvedProjectId(pid);
      } catch {
        setResolvedProjectId('');
      }
    })();
  }, [routeProjectId, campaignId, fetchCampaignVideos]);

  const loadVideos = async () => {
    if (!resolvedProjectId) return;
    const result = await fetchProjectVideos(resolvedProjectId, {
      search,
      video_type: videoType === 'all' ? '' : videoType,
      session_id: sessionId,
      usage: usageFilter === 'all' ? '' : usageFilter,
    });
    setProject(result.project || null);
    setVideos(result.data || []);
  };

  useEffect(() => {
    if (!resolvedProjectId) return;
    (async () => {
      try {
        const data = await fetchProjectHypotheses(resolvedProjectId);
        setHypotheses(data || []);
      } catch {
        setHypotheses([]);
      }
    })();
  }, [resolvedProjectId, fetchProjectHypotheses]);

  useEffect(() => {
    loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedProjectId, videoType, usageFilter]);

  const openLinkModal = (video) => {
    setSelectedVideo(video);
    setSelectedHypothesisIds([]);
    setShowLinkModal(true);
    setOpenActionMenuVideoId(null);
  };

  const openEditModal = (video) => {
    setEditingVideo(video);
    setShowCreate(true);
    setOpenActionMenuVideoId(null);
  };

  const onDeleteVideo = async (video) => {
    const confirmed = window.confirm(`¿Eliminar el video “${video.title || video.id}”? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    try {
      const ok = await deleteVideo(video.id);
      if (!ok) throw new Error('No se pudo eliminar el video');
      toast({ title: 'Video eliminado', description: 'El video se eliminó de la biblioteca.' });
      setOpenActionMenuVideoId(null);
      await loadVideos();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const toggleHypothesis = (id) => {
    setSelectedHypothesisIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6" onClick={() => setOpenActionMenuVideoId(null)}>
      <Helmet><title>Biblioteca de videos</title></Helmet>
      <div className="max-w-7xl mx-auto">
        <Button onClick={() => navigate(`/projects/${resolvedProjectId}`)} className="bg-white border text-gray-700 mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver al proyecto</Button>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="w-6 h-6 text-purple-600" />Biblioteca de videos</h1>
          <p className="text-gray-600 mt-1">{project?.name || 'Proyecto'} · Gestiona videos globales y reutilízalos en hipótesis.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="grid md:grid-cols-5 gap-2 mb-4">
            <input className="rounded-lg border p-2" placeholder="Buscar por nombre/session" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="rounded-lg border p-2" value={videoType} onChange={(e) => setVideoType(e.target.value)}>{typeOptions.map((value) => <option key={value} value={value}>{value === 'all' ? 'Tipo (todos)' : value.toUpperCase()}</option>)}</select>
            <input className="rounded-lg border p-2" placeholder="Filtrar session_id" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            <select className="rounded-lg border p-2" value={usageFilter} onChange={(e) => setUsageFilter(e.target.value)}>
              <option value="all">Uso (todos)</option>
              <option value="used">Usados</option>
              <option value="unused">No usados</option>
            </select>
            <div className="flex gap-2">
              <Button className="bg-gray-200 text-gray-700" onClick={applySearch}>Filtrar</Button>
              <Button className="bg-purple-600 text-white" onClick={() => { setEditingVideo(null); setShowCreate(true); }}>Crear video</Button>
            </div>
          </div>

          <div className="space-y-3">
            {videos.map((video) => (
              <div key={video.id} className="rounded-xl border bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">#{video.video_id ?? '—'} · {video.title || '—'} <span className="text-xs text-gray-500">({video.video_type || '—'})</span></p>
                    <p className="text-sm text-gray-600">Session: {video.session_id ?? video.external_id ?? '—'}</p>
                    <p className="text-sm text-gray-600">Funnel: {video.funnel || '—'}</p>
                    <p className="text-sm text-gray-600">Views: {video.views || 0} · Likes: {video.likes || 0} · Comments: {video.comments || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Usado en: {video.used_in_hypotheses || 0} hipótesis</p>
                    {Array.isArray(video.linked_hypotheses) && video.linked_hypotheses.length > 0 ? <p className="text-xs text-gray-500">{video.linked_hypotheses.join(' · ')}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative" onClick={(event) => event.stopPropagation()}>
                      <Button
                        className="bg-blue-100 text-blue-700"
                        onClick={() => setOpenActionMenuVideoId((current) => (current === video.id ? null : video.id))}
                      >
                        <MoreHorizontal className="w-4 h-4 mr-2" />Acciones
                      </Button>
                      {openActionMenuVideoId === video.id ? (
                        <div className="absolute right-0 mt-1 w-44 bg-white border rounded-lg shadow-lg z-20 p-1">
                          <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded inline-flex items-center gap-2" onClick={() => openEditModal(video)}>
                            <Pencil className="w-4 h-4" />Editar
                          </button>
                          <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-700 rounded inline-flex items-center gap-2" onClick={() => onDeleteVideo(video)}>
                            <Trash2 className="w-4 h-4" />Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <Button className="bg-indigo-600 text-white" onClick={() => openLinkModal(video)}><Link2 className="w-4 h-4 mr-2" />Vincular a hipótesis…</Button>
                  </div>
                </div>
              </div>
            ))}
            {videos.length === 0 ? <div className="text-center py-10 text-gray-500">No hay videos para estos filtros.</div> : null}
          </div>
        </div>
      </div>

      <LibraryVideoModal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false);
          setEditingVideo(null);
        }}
        mode={editingVideo ? 'edit' : 'create'}
        initialVideo={editingVideo}
        projectId={resolvedProjectId}
        onSaved={async () => {
          await loadVideos();
        }}
      />

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
