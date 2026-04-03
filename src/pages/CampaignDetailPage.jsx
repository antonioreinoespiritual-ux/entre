import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, MessageSquare, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCampaigns } from '@/contexts/CampaignContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useVideos } from '@/contexts/VideoContext';

const readCampaignModeSelection = (campaignId = '') => {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) return null;
  try {
    return localStorage.getItem(`campaign-mode-selected:${normalizedCampaignId}`);
  } catch (error) {
    console.warn('[campaign-mode-selection] Unable to read localStorage preference.', error);
    return null;
  }
};

const persistCampaignModeSelection = (campaignId = '', mode = '') => {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId) return;
  try {
    localStorage.setItem(`campaign-mode-selected:${normalizedCampaignId}`, String(mode || '').trim());
  } catch (error) {
    console.warn('[campaign-mode-selection] Unable to persist localStorage preference.', error);
  }
};

const CampaignDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { fetchCampaignById } = useCampaigns();
  const { audiences, fetchAudiences } = useAudiences();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { fetchCampaignVideos } = useVideos();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [videosCount, setVideosCount] = useState(0);
  const [modeModalOpen, setModeModalOpen] = useState(false);

  const openInCloud = async () => {
    navigate(`/projects/${campaign.project_id}/cloud`);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchCampaignById(id);
      setCampaign(data);
      if (data) {
        await Promise.all([fetchAudiences(data.id), fetchHypotheses(data.id)]);
        const videosResult = await fetchCampaignVideos(data.id);
        setVideosCount((videosResult?.data || []).length);
        if (!readCampaignModeSelection(data.id)) setModeModalOpen(true);
      }
      setLoading(false);
    };
    load();
  }, [id, fetchCampaignById, fetchAudiences, fetchHypotheses, fetchCampaignVideos]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50"><div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" /></div>;
  }

  if (!campaign) {
    return <div className="min-h-screen flex items-center justify-center">Campaign not found</div>;
  }

  const campaignHomePath = `/projects/${campaign.project_id}/campaigns/${campaign.id}`;
  const audiencesPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/audiences`;
  const hypothesesPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/hypotheses`;
  const videosLibraryPath = `/projects/${campaign.project_id}/videos`;
  const interviewsPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/interviews`;
  const commentsPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/comments`;

  const chooseMode = (mode) => {
    persistCampaignModeSelection(campaign.id, mode);
    setModeModalOpen(false);
    if (mode === 'videos') navigate(campaignHomePath);
    if (mode === 'interviews') navigate(interviewsPath);
    if (mode === 'comments') navigate(commentsPath);
  };

  return (
    <>
      <Helmet>
        <title>{campaign.name} - Campaign Dashboard</title>
      </Helmet>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-6xl mx-auto p-6">
          <Button onClick={() => navigate(`/projects/${campaign.project_id}`)} className="bg-white text-gray-700 border mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al proyecto
          </Button>

          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h1 className="text-3xl font-bold mb-2">{campaign.name}</h1>
            <p className="text-gray-600">{campaign.description || 'Sin descripción'}</p>
            <div className="mt-4 flex gap-2">
              <Button onClick={openInCloud} className="bg-indigo-600 hover:bg-indigo-700 text-white">Abrir en Cloud</Button>
              <Button onClick={() => setModeModalOpen(true)} className="bg-white text-gray-700 border">Cambiar modo</Button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-blue-100">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">Audiences</h2>
              </div>
              <p className="text-gray-600 mb-4">Gestiona audiencias de la campaña. Aquí no se crean videos.</p>
              <p className="text-sm text-gray-500 mb-4">Total: {audiences.length}</p>
              <Link to={audiencesPath} className="text-blue-600 font-medium hover:underline">Abrir Audiences Dashboard →</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-purple-100">
              <div className="flex items-center gap-3 mb-4">
                <Lightbulb className="w-6 h-6 text-purple-600" />
                <h2 className="text-xl font-semibold">Hypotheses</h2>
              </div>
              <p className="text-gray-600 mb-4">Gestiona hipótesis y videos por tipo (paid, organic, live).</p>
              <p className="text-sm text-gray-500 mb-4">Total: {hypotheses.length}</p>
              <Link to={hypothesesPath} className="text-purple-600 font-medium hover:underline">Abrir Hypotheses Dashboard →</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-indigo-100">
              <div className="flex items-center gap-3 mb-4">
                <Video className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-semibold">Biblioteca de videos</h2>
              </div>
              <p className="text-gray-600 mb-4">Gestiona todos los videos del proyecto y reutilízalos en hipótesis.</p>
              <p className="text-sm text-gray-500 mb-4">Total: {videosCount}</p>
              <Link to={videosLibraryPath} className="text-indigo-600 font-medium hover:underline">Abrir Biblioteca de Videos →</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-emerald-100">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="w-6 h-6 text-emerald-600" />
                <h2 className="text-xl font-semibold">Entrevistas</h2>
              </div>
              <p className="text-gray-600 mb-4">Módulo separado de videos: clientes, formularios, hipótesis de entrevistas y sesiones.</p>
              <Link to={interviewsPath} className="text-emerald-600 font-medium hover:underline">Abrir Modo Entrevistas →</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-cyan-100">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="w-6 h-6 text-cyan-600" />
                <h2 className="text-xl font-semibold">Modo comentarios</h2>
              </div>
              <p className="text-gray-600 mb-4">Módulo independiente para análisis semántico basado en comentarios como fuente principal.</p>
              <Link to={commentsPath} className="text-cyan-600 font-medium hover:underline">Abrir Modo Comentarios →</Link>
            </motion.div>
          </div>
        </div>

        {modeModalOpen ? (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
              <h3 className="text-xl font-semibold">Seleccionar modo</h3>
              <p className="text-sm text-gray-600">Elige cómo quieres trabajar esta campaña.</p>
              <div className="grid grid-cols-1 gap-3">
                <button className="border rounded-xl p-4 text-left hover:border-indigo-400 hover:bg-indigo-50" onClick={() => chooseMode('videos')}>
                  <p className="font-semibold text-indigo-700">Modo videos</p>
                  <p className="text-xs text-gray-600 mt-1">Biblioteca, hipótesis de videos, audiencias y cloud.</p>
                </button>
                <button className="border rounded-xl p-4 text-left hover:border-emerald-400 hover:bg-emerald-50" onClick={() => chooseMode('interviews')}>
                  <p className="font-semibold text-emerald-700">Modo entrevistas</p>
                  <p className="text-xs text-gray-600 mt-1">Clientes, formularios y sesiones cualitativas.</p>
                </button>
                <button className="border rounded-xl p-4 text-left hover:border-cyan-400 hover:bg-cyan-50" onClick={() => chooseMode('comments')}>
                  <p className="font-semibold text-cyan-700">Modo comentarios</p>
                  <p className="text-xs text-gray-600 mt-1">Base de comentarios, fragmentos, códigos y clusters.</p>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};

export default CampaignDetailPage;
