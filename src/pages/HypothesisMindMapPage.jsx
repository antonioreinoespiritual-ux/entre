import React, { useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { useVideos } from '@/contexts/VideoContext';
import { useAudiences } from '@/contexts/AudienceContext';

const readHypothesisStatus = (hypothesis) => (
  hypothesis?.validation_status
  ?? hypothesis?.status
  ?? hypothesis?.state
  ?? hypothesis?.outcome
  ?? '—'
);

const HypothesisMindMapPage = () => {
  const { projectId, campaignId, hypothesisId } = useParams();
  const navigate = useNavigate();
  const { hypotheses, fetchHypotheses } = useHypotheses();
  const { videos, fetchVideos } = useVideos();
  const { audiences, fetchAudiences } = useAudiences();

  useEffect(() => {
    fetchHypotheses(campaignId);
    fetchVideos(hypothesisId);
    fetchAudiences(campaignId);
  }, [campaignId, hypothesisId, fetchHypotheses, fetchVideos, fetchAudiences]);

  const hypothesis = useMemo(() => hypotheses.find((item) => item.id === hypothesisId), [hypotheses, hypothesisId]);

  const audienceNameById = useMemo(() => {
    const map = new Map();
    (audiences || []).forEach((audience) => {
      map.set(audience.id, audience.name || audience.title || '—');
    });
    return map;
  }, [audiences]);

  const mappedVideos = useMemo(() => (videos || []).map((video) => ({
    id: video.id,
    name: video.title || video.name || '—',
    audience: audienceNameById.get(video.audience_id) || '—',
    hook: video.hook_texto || video.hook_text || video.hook || '—',
    cta: video.cta_texto || video.cta_text || video.cta || '—',
  })), [videos, audienceNameById]);

  if (!hypothesis) {
    return <div className="min-h-screen flex items-center justify-center">Cargando mapa mental...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Mapa mental de hipótesis</title></Helmet>
      <div className="max-w-6xl mx-auto">
        <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/hypotheses`)} className="bg-white border text-gray-700 mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />Volver a hipótesis
        </Button>

        <div className="rounded-2xl border bg-white p-6 shadow-xl">
          <h1 className="text-2xl font-bold flex items-center gap-2"><GitBranch className="w-6 h-6 text-purple-600" />Mapa mental</h1>

          <div className="mt-6 flex justify-center">
            <div className="w-full max-w-2xl rounded-xl border-2 border-purple-300 bg-purple-50 p-4 text-center shadow-sm">
              <p className="text-xs uppercase tracking-wide text-purple-700">Hipótesis raíz</p>
              <h2 className="mt-1 text-lg font-semibold">{hypothesis.type || 'Hipótesis'}</h2>
              <p className="mt-2 text-sm text-gray-700">{hypothesis.hypothesis_statement || hypothesis.condition || '—'}</p>
              <p className="mt-2 text-xs text-gray-500">Estado: {readHypothesisStatus(hypothesis)}</p>
            </div>
          </div>

          <div className="mt-5 flex justify-center">
            <div className="h-8 w-0.5 bg-purple-300" />
          </div>

          {mappedVideos.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-gray-50 p-6 text-center text-gray-500">
              No hay videos asociados a esta hipótesis
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {mappedVideos.map((video) => (
                <div key={video.id} className="relative rounded-xl border bg-white p-4 shadow-sm">
                  <div className="absolute -top-4 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-purple-200" />
                  <p className="font-semibold text-gray-900">{video.name}</p>
                  <p className="mt-2 text-sm text-gray-600"><span className="font-medium">Público:</span> {video.audience}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">Hook:</span> {video.hook}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">CTA:</span> {video.cta}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HypothesisMindMapPage;
