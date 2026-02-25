import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Users, Video, Lightbulb, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCampaigns } from '@/contexts/CampaignContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { useVideos } from '@/contexts/VideoContext';
import { useHypotheses } from '@/contexts/HypothesisContext';

const emptyVideo = {
  title: '',
  url: '',
  cpc: 0,
  views: 0,
  engagement: 0,
  likes: 0,
  shares: 0,
  comments: 0,
};

const CampaignDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { fetchCampaignById } = useCampaigns();
  const { audiences, fetchAudiences, createAudience, deleteAudience } = useAudiences();
  const { videos, fetchVideos, createVideo, deleteVideo } = useVideos();
  const { hypotheses, fetchHypotheses, createHypothesis, deleteHypothesis } = useHypotheses();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedHypothesis, setSelectedHypothesis] = useState(null);

  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [showHypothesisForm, setShowHypothesisForm] = useState(false);
  const [showVideoForm, setShowVideoForm] = useState(false);

  const [newAudience, setNewAudience] = useState({ name: '', description: '' });
  const [newHypothesis, setNewHypothesis] = useState({ type: 'Problema', condition: '', validation_status: 'No Validada' });
  const [newVideo, setNewVideo] = useState(emptyVideo);

  const selectedHypothesisObj = useMemo(
    () => hypotheses.find((hypothesis) => hypothesis.id === selectedHypothesis) || null,
    [hypotheses, selectedHypothesis],
  );

  useEffect(() => {
    const loadCampaign = async () => {
      setLoading(true);
      const data = await fetchCampaignById(id);
      setCampaign(data);
      if (data) {
        await fetchAudiences(id);
        await fetchHypotheses(id);
      }
      setLoading(false);
    };

    loadCampaign();
  }, [id, fetchCampaignById, fetchAudiences, fetchHypotheses]);

  useEffect(() => {
    if (selectedHypothesis) {
      fetchVideos(selectedHypothesis);
    }
  }, [selectedHypothesis, fetchVideos]);

  const handleCreateAudience = async (event) => {
    event.preventDefault();
    const result = await createAudience({ ...newAudience, campaign_id: id });
    if (result) {
      setNewAudience({ name: '', description: '' });
      setShowAudienceForm(false);
    }
  };

  const handleCreateHypothesis = async (event) => {
    event.preventDefault();
    const result = await createHypothesis({ ...newHypothesis, campaign_id: id });
    if (result) {
      setNewHypothesis({ type: 'Problema', condition: '', validation_status: 'No Validada' });
      setShowHypothesisForm(false);
      await fetchHypotheses(id);
    }
  };

  const handleCreateVideo = async (event) => {
    event.preventDefault();
    if (!selectedHypothesis) return;

    const result = await createVideo({
      ...newVideo,
      hypothesis_id: selectedHypothesis,
      cpc: parseFloat(newVideo.cpc) || 0,
      views: parseInt(newVideo.views, 10) || 0,
      engagement: parseFloat(newVideo.engagement) || 0,
      likes: parseInt(newVideo.likes, 10) || 0,
      shares: parseInt(newVideo.shares, 10) || 0,
      comments: parseInt(newVideo.comments, 10) || 0,
    });

    if (result) {
      setNewVideo(emptyVideo);
      setShowVideoForm(false);
      await fetchHypotheses(id);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-700">Campaign not found</h2>
          <Button onClick={() => navigate('/projects')} className="mt-4">Go back to Projects</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{campaign.name} - Campaign Details</title>
        <meta name="description" content={`Manage audiences and hypotheses for ${campaign.name}`} />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Button
              onClick={() => navigate(`/projects/${campaign.project_id}`)}
              className="mb-4 bg-white hover:bg-gray-100 text-gray-700 border-2 border-gray-200"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Project
            </Button>

            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                {campaign.name}
              </h1>
              <p className="text-gray-600">{campaign.description || 'No description'}</p>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="w-6 h-6 text-blue-500" />
                  Audiences
                </h2>
                <Button onClick={() => setShowAudienceForm((value) => !value)} className="bg-blue-500 hover:bg-blue-600 text-white p-2" size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {showAudienceForm && (
                <form onSubmit={handleCreateAudience} className="mb-4 space-y-2 p-4 bg-blue-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700">Nombre de audiencia</label>
                  <input
                    type="text"
                    value={newAudience.name}
                    onChange={(event) => setNewAudience({ ...newAudience, name: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 text-sm"
                    required
                  />

                  <label className="block text-sm font-medium text-gray-700">Descripción</label>
                  <textarea
                    value={newAudience.description}
                    onChange={(event) => setNewAudience({ ...newAudience, description: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 text-sm"
                    rows="2"
                  />

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-sm">Create</Button>
                    <Button type="button" onClick={() => setShowAudienceForm(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm">Cancel</Button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {audiences.map((audience) => (
                  <div key={audience.id} className="p-3 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-all">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-800 text-sm flex-1">{audience.name}</h3>
                      <Button onClick={() => deleteAudience(audience.id, id)} className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-gray-600">{audience.description || 'No description'}</p>
                  </div>
                ))}

                {audiences.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No audiences yet</div>}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Lightbulb className="w-6 h-6 text-yellow-500" />
                  Hypotheses
                </h2>
                <Button onClick={() => setShowHypothesisForm((value) => !value)} className="bg-yellow-500 hover:bg-yellow-600 text-white p-2" size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {showHypothesisForm && (
                <form onSubmit={handleCreateHypothesis} className="mb-4 space-y-2 p-4 bg-yellow-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700">Tipo</label>
                  <select
                    value={newHypothesis.type}
                    onChange={(event) => setNewHypothesis({ ...newHypothesis, type: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm"
                  >
                    <option value="Problema">Problema</option>
                    <option value="Solución">Solución</option>
                    <option value="Mercado">Mercado</option>
                  </select>

                  <label className="block text-sm font-medium text-gray-700">Condición</label>
                  <textarea
                    value={newHypothesis.condition}
                    onChange={(event) => setNewHypothesis({ ...newHypothesis, condition: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm"
                    placeholder="Ej: views > 1000"
                    required
                    rows="2"
                  />

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white text-sm">Create</Button>
                    <Button type="button" onClick={() => setShowHypothesisForm(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm">Cancel</Button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {hypotheses.map((hypothesis) => (
                  <div
                    key={hypothesis.id}
                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${selectedHypothesis === hypothesis.id ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'}`}
                    onClick={() => setSelectedHypothesis(hypothesis.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-gray-800 text-sm">{hypothesis.type}</h3>
                        <p className="text-xs text-gray-600">{hypothesis.condition}</p>
                      </div>
                      <Button
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteHypothesis(hypothesis.id, id);
                          if (selectedHypothesis === hypothesis.id) setSelectedHypothesis(null);
                        }}
                        className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      {hypothesis.validation_status === 'Validada' ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <XCircle className="w-3 h-3 text-gray-400" />
                      )}
                      <span className={hypothesis.validation_status === 'Validada' ? 'text-green-600 font-semibold' : 'text-gray-600'}>
                        {hypothesis.validation_status}
                      </span>
                    </div>
                  </div>
                ))}

                {hypotheses.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No hypotheses yet</div>}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Video className="w-6 h-6 text-purple-500" />
                  Videos por hipótesis
                </h2>
                <Button
                  onClick={() => setShowVideoForm((value) => !value)}
                  className="bg-purple-500 hover:bg-purple-600 text-white p-2"
                  size="sm"
                  disabled={!selectedHypothesis}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {!selectedHypothesis && (
                <div className="text-center py-8 text-gray-500 text-sm">Selecciona una hipótesis para gestionar videos</div>
              )}

              {selectedHypothesis && selectedHypothesisObj && (
                <p className="text-xs text-gray-600 mb-3">
                  Hipótesis seleccionada: <strong>{selectedHypothesisObj.type}</strong> — {selectedHypothesisObj.condition}
                </p>
              )}

              {selectedHypothesis && showVideoForm && (
                <form onSubmit={handleCreateVideo} className="mb-4 space-y-2 p-4 bg-purple-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700">Título</label>
                  <input
                    type="text"
                    value={newVideo.title}
                    onChange={(event) => setNewVideo({ ...newVideo, title: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm"
                    required
                  />

                  <label className="block text-sm font-medium text-gray-700">URL</label>
                  <input
                    type="url"
                    value={newVideo.url}
                    onChange={(event) => setNewVideo({ ...newVideo, url: event.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">CPC</label>
                      <input type="number" step="0.01" value={newVideo.cpc} onChange={(event) => setNewVideo({ ...newVideo, cpc: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Views</label>
                      <input type="number" value={newVideo.views} onChange={(event) => setNewVideo({ ...newVideo, views: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Engagement %</label>
                      <input type="number" step="0.01" value={newVideo.engagement} onChange={(event) => setNewVideo({ ...newVideo, engagement: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Likes</label>
                      <input type="number" value={newVideo.likes} onChange={(event) => setNewVideo({ ...newVideo, likes: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Shares</label>
                      <input type="number" value={newVideo.shares} onChange={(event) => setNewVideo({ ...newVideo, shares: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Comments</label>
                      <input type="number" value={newVideo.comments} onChange={(event) => setNewVideo({ ...newVideo, comments: event.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-gray-900 text-sm" />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1 bg-purple-500 hover:bg-purple-600 text-white text-sm">Create</Button>
                    <Button type="button" onClick={() => setShowVideoForm(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm">Cancel</Button>
                  </div>
                </form>
              )}

              {selectedHypothesis && (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {videos.map((video) => (
                    <div key={video.id} className="p-3 rounded-lg border-2 border-gray-200 hover:border-purple-300 transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-gray-800 text-sm flex-1">{video.title}</h3>
                        <Button
                          onClick={() => deleteVideo(video.id, selectedHypothesis)}
                          className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                        <div>Views: {video.views}</div>
                        <div>Likes: {video.likes}</div>
                        <div>Engagement: {video.engagement}%</div>
                        <div>CPC: ${video.cpc}</div>
                        <div>Shares: {video.shares}</div>
                        <div>Comments: {video.comments}</div>
                      </div>
                    </div>
                  ))}

                  {videos.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No videos yet for this hypothesis</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CampaignDetailPage;
