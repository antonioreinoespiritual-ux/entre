import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Users, Video, Lightbulb, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useCampaigns } from '@/contexts/CampaignContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { useVideos } from '@/contexts/VideoContext';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { validateBulkVideoUpdates } from '@/lib/videoBulkUpdate';

const initialVideo = { title: '', url: '', cpc: 0, views: 0, engagement: 0, likes: 0, shares: 0, comments: 0 };
const emptyPreview = { ok: false, errors: [], warnings: [], summary: null, rows: [], normalizedPayload: null };

const CampaignDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { fetchCampaignById } = useCampaigns();
  const { audiences, fetchAudiences, createAudience, deleteAudience } = useAudiences();
  const { videos, fetchVideos, createVideo, deleteVideo } = useVideos();
  const { hypotheses, fetchHypotheses, createHypothesis, deleteHypothesis } = useHypotheses();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAudience, setSelectedAudience] = useState(null);

  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [showHypothesisForm, setShowHypothesisForm] = useState(false);

  const [newAudience, setNewAudience] = useState({ name: '', description: '' });
  const [newVideo, setNewVideo] = useState(initialVideo);
  const [newHypothesis, setNewHypothesis] = useState({ type: 'Problema', condition: '', validation_status: 'No Validada' });

  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkJson, setBulkJson] = useState('');
  const [bulkPreview, setBulkPreview] = useState(emptyPreview);
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    loadCampaign();
  }, [id]);

  useEffect(() => {
    if (selectedAudience) {
      fetchVideos(selectedAudience);
    }
  }, [selectedAudience, fetchVideos]);

  const backendUrl = useMemo(() => import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000', []);

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

  const handleCreateAudience = async (e) => {
    e.preventDefault();
    const result = await createAudience({ ...newAudience, campaign_id: id });
    if (result) {
      setNewAudience({ name: '', description: '' });
      setShowAudienceForm(false);
    }
  };

  const handleCreateVideo = async (e) => {
    e.preventDefault();
    if (!selectedAudience) return;

    const result = await createVideo({
      ...newVideo,
      audience_id: selectedAudience,
      cpc: parseFloat(newVideo.cpc) || 0,
      views: parseInt(newVideo.views, 10) || 0,
      engagement: parseFloat(newVideo.engagement) || 0,
      likes: parseInt(newVideo.likes, 10) || 0,
      shares: parseInt(newVideo.shares, 10) || 0,
      comments: parseInt(newVideo.comments, 10) || 0,
    });

    if (result) {
      setNewVideo(initialVideo);
      setShowVideoForm(false);
      await fetchHypotheses(id);
    }
  };

  const handleCreateHypothesis = async (e) => {
    e.preventDefault();
    const result = await createHypothesis({ ...newHypothesis, campaign_id: id });
    if (result) {
      setNewHypothesis({ type: 'Problema', condition: '', validation_status: 'No Validada' });
      setShowHypothesisForm(false);
    }
  };

  const handleValidateBulk = () => {
    const preview = validateBulkVideoUpdates(bulkJson, videos);
    setBulkPreview(preview);
    if (!preview.ok) {
      toast({
        title: 'Validación incompleta',
        description: preview.errors[0] || 'Corrige los warnings/errores antes de aplicar.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Validación OK',
      description: `Listo para aplicar ${preview.summary.updated} updates.`,
    });
  };

  const handleApplyBulk = async () => {
    if (!bulkPreview.ok || !bulkPreview.normalizedPayload) return;

    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    if (!session?.access_token) {
      toast({ title: 'Sesión expirada', description: 'Inicia sesión nuevamente.', variant: 'destructive' });
      return;
    }

    setBulkLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/videos/bulk-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(bulkPreview.normalizedPayload),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'No fue posible aplicar la actualización masiva.');
      }

      toast({
        title: 'Actualización masiva aplicada',
        description: `Actualizados ${json.summary.updated}/${json.summary.received}.`,
      });

      await fetchVideos(selectedAudience);
      setShowBulkModal(false);
      setBulkJson('');
      setBulkPreview(emptyPreview);
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setBulkLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-700">Campaign not found</h2>
          <Button onClick={() => navigate('/projects')} className="mt-4">
            Go back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{campaign.name} - Campaign Details</title>
        <meta name="description" content={`Manage audiences, videos, and hypotheses for ${campaign.name}`} />
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
                  <Users className="w-6 h-6 text-blue-500" /> Audiences
                </h2>
                <Button onClick={() => setShowAudienceForm(!showAudienceForm)} className="bg-blue-500 hover:bg-blue-600 text-white p-2" size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {showAudienceForm && (
                <form onSubmit={handleCreateAudience} className="mb-4 space-y-2 p-4 bg-blue-50 rounded-lg">
                  <input
                    type="text"
                    value={newAudience.name}
                    onChange={(e) => setNewAudience({ ...newAudience, name: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm"
                    placeholder="Audience name"
                    required
                  />
                  <textarea
                    value={newAudience.description}
                    onChange={(e) => setNewAudience({ ...newAudience, description: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm"
                    placeholder="Description"
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
                  <div
                    key={audience.id}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedAudience === audience.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                    onClick={() => setSelectedAudience(audience.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 text-sm">{audience.name}</h3>
                        <p className="text-xs text-gray-500 mt-1">{audience.description}</p>
                        <div className="flex gap-3 mt-2 text-xs text-gray-600">
                          <span>Videos: {audience.videos?.length || 0}</span>
                          <span>Clients: {audience.clients?.length || 0}</span>
                        </div>
                      </div>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAudience(audience.id, id);
                        }}
                        className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {audiences.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No audiences yet</div>}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Video className="w-6 h-6 text-purple-500" /> Videos
                </h2>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowBulkModal(true)}
                    className="bg-slate-900 hover:bg-black text-purple-200 border border-purple-500/40"
                    size="sm"
                    disabled={!selectedAudience}
                  >
                    Actualización masiva
                  </Button>
                  <Button onClick={() => setShowVideoForm(!showVideoForm)} className="bg-purple-500 hover:bg-purple-600 text-white p-2" size="sm" disabled={!selectedAudience}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {!selectedAudience && <div className="text-center py-8 text-gray-500 text-sm">Select an audience to view videos</div>}

              {selectedAudience && showVideoForm && (
                <form onSubmit={handleCreateVideo} className="mb-4 space-y-2 p-4 bg-purple-50 rounded-lg">
                  <input type="text" value={newVideo.title} onChange={(e) => setNewVideo({ ...newVideo, title: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Video title" required />
                  <input type="url" value={newVideo.url} onChange={(e) => setNewVideo({ ...newVideo, url: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Video URL" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" step="0.01" value={newVideo.cpc} onChange={(e) => setNewVideo({ ...newVideo, cpc: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="CPC" />
                    <input type="number" value={newVideo.views} onChange={(e) => setNewVideo({ ...newVideo, views: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Views" />
                    <input type="number" step="0.01" value={newVideo.engagement} onChange={(e) => setNewVideo({ ...newVideo, engagement: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Engagement %" />
                    <input type="number" value={newVideo.likes} onChange={(e) => setNewVideo({ ...newVideo, likes: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Likes" />
                    <input type="number" value={newVideo.shares} onChange={(e) => setNewVideo({ ...newVideo, shares: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Shares" />
                    <input type="number" value={newVideo.comments} onChange={(e) => setNewVideo({ ...newVideo, comments: e.target.value })} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Comments" />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1 bg-purple-500 hover:bg-purple-600 text-white text-sm">Create</Button>
                    <Button type="button" onClick={() => setShowVideoForm(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm">Cancel</Button>
                  </div>
                </form>
              )}

              {selectedAudience && (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {videos.map((video) => (
                    <div key={video.id} className="p-3 rounded-lg border-2 border-gray-200 hover:border-purple-300 transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-gray-800 text-sm flex-1">{video.title}</h3>
                        <Button onClick={() => deleteVideo(video.id, selectedAudience)} className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                        <div>Views: {video.views}</div>
                        <div>Likes: {video.likes}</div>
                        <div>Eng: {video.engagement}%</div>
                        <div>CPC: ${video.cpc}</div>
                        <div>Shares: {video.shares}</div>
                        <div>Comments: {video.comments}</div>
                      </div>
                    </div>
                  ))}
                  {videos.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No videos yet</div>}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Lightbulb className="w-6 h-6 text-amber-500" /> Hypotheses
                </h2>
                <Button onClick={() => setShowHypothesisForm(!showHypothesisForm)} className="bg-amber-500 hover:bg-amber-600 text-white p-2" size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {showHypothesisForm && (
                <form onSubmit={handleCreateHypothesis} className="mb-4 space-y-3 p-4 bg-amber-50 rounded-lg">
                  <select value={newHypothesis.type} onChange={(e) => setNewHypothesis({ ...newHypothesis, type: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm">
                    <option value="Problema">Problema</option>
                    <option value="Solución">Solución</option>
                    <option value="Valor">Valor</option>
                    <option value="Activación">Activación</option>
                    <option value="Retención">Retención</option>
                  </select>
                  <textarea value={newHypothesis.condition} onChange={(e) => setNewHypothesis({ ...newHypothesis, condition: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg text-sm" placeholder="Condition (e.g., views > 1000)" rows="2" required />
                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-sm">Create</Button>
                    <Button type="button" onClick={() => setShowHypothesisForm(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm">Cancel</Button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {hypotheses.map((hypothesis) => (
                  <div key={hypothesis.id} className="p-3 rounded-lg border-2 border-gray-200 hover:border-amber-300 transition-all">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-semibold">{hypothesis.type}</span>
                          {hypothesis.validation_status === 'Validada' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-400" />}
                        </div>
                        <p className="text-sm text-gray-700">{hypothesis.condition}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Status:{' '}
                          <span className={hypothesis.validation_status === 'Validada' ? 'text-green-600 font-semibold' : 'text-gray-600'}>{hypothesis.validation_status}</span>
                        </p>
                      </div>
                      <Button onClick={() => deleteHypothesis(hypothesis.id, id)} className="bg-red-100 hover:bg-red-200 text-red-600 p-1 h-auto">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {hypotheses.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No hypotheses yet</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl rounded-2xl border border-purple-500/40 bg-slate-950/90 text-slate-100 shadow-2xl">
            <div className="p-6 border-b border-purple-500/30">
              <h3 className="text-2xl font-bold text-purple-200">Actualización masiva</h3>
              <p className="text-sm text-slate-300 mt-1">Pega el JSON de updates y valida antes de aplicar.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
              <div>
                <p className="text-xs font-semibold tracking-wider text-purple-300 mb-2">JSON DE UPDATES</p>
                <textarea
                  value={bulkJson}
                  onChange={(e) => {
                    setBulkJson(e.target.value);
                    setBulkPreview(emptyPreview);
                  }}
                  rows={18}
                  className="w-full rounded-xl border border-purple-400/30 bg-slate-900/80 p-4 font-mono text-xs text-slate-100"
                  placeholder='{"updates":[{"video_id":"...","fields":{"views":1200}}]}'
                />
              </div>

              <div className="rounded-xl border border-cyan-400/25 bg-slate-900/70 p-4">
                <h4 className="font-semibold text-cyan-200 mb-3">Previsualización</h4>
                {bulkPreview.summary ? (
                  <div className="text-xs text-slate-300 space-y-1 mb-3">
                    <div>Recibidos: {bulkPreview.summary.received}</div>
                    <div>Válidos: {bulkPreview.summary.valid}</div>
                    <div>Con match: {bulkPreview.summary.matched}</div>
                    <div>Aplicables: {bulkPreview.summary.updated}</div>
                    <div>Saltados: {bulkPreview.summary.skipped}</div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mb-3">Haz click en “Validar” para generar la previsualización.</p>
                )}

                {bulkPreview.warnings.length > 0 && (
                  <ul className="mb-3 text-xs text-amber-300 list-disc pl-4">
                    {bulkPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                )}
                {bulkPreview.errors.length > 0 && (
                  <ul className="mb-3 text-xs text-red-300 list-disc pl-4">
                    {bulkPreview.errors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                )}

                <div className="max-h-64 overflow-y-auto rounded border border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 text-slate-300 sticky top-0">
                      <tr>
                        <th className="text-left p-2">inputIndex</th>
                        <th className="text-left p-2">identificador</th>
                        <th className="text-left p-2">status</th>
                        <th className="text-left p-2">campos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.rows.map((row) => (
                        <tr key={`${row.inputIndex}-${row.detectedIdentifier}`} className="border-t border-slate-800">
                          <td className="p-2">{row.inputIndex}</td>
                          <td className="p-2">{row.detectedIdentifier}</td>
                          <td className="p-2">{row.status}</td>
                          <td className="p-2">{row.fieldKeys.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <p className="text-xs text-slate-400 mb-4">Identificador prioritario: video_id -&gt; session_id -&gt; video_name.</p>
              <div className="flex flex-wrap gap-3 justify-end">
                <Button onClick={() => setShowBulkModal(false)} className="bg-slate-700 hover:bg-slate-600 text-white">Cerrar</Button>
                <Button onClick={handleValidateBulk} className="bg-cyan-600 hover:bg-cyan-500 text-white">Validar</Button>
                <Button onClick={handleApplyBulk} disabled={!bulkPreview.ok || bulkLoading} className="bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">
                  {bulkLoading ? 'Aplicando...' : 'Aplicar'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CampaignDetailPage;
