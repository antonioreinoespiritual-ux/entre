import React, { useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, GitBranch, Gauge, Trophy } from 'lucide-react';
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

const formatScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(parsed >= 100 || Number.isInteger(parsed) ? 0 : 1) : '—';
};

const videoScoreTone = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'border-slate-200 bg-slate-50 text-slate-500';
  if (parsed >= 75) return 'border-cyan-500/50 bg-slate-950 text-cyan-300';
  if (parsed >= 55) return 'border-violet-300 bg-violet-50 text-violet-700';
  if (parsed >= 35) return 'border-amber-300 bg-amber-50 text-amber-700';
  return 'border-rose-300 bg-rose-50 text-rose-700';
};

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

  const mappedVideos = useMemo(() => (videos || [])
    .map((video) => ({
      id: video.id,
      name: video.title || video.name || '—',
      audience: audienceNameById.get(video.audience_id) || '—',
      hook: video.hook_texto || video.hook_text || video.hook || '—',
      cta: video.cta_texto || video.cta_text || video.cta || '—',
      score: video.video_score,
      funnel: video.funnel || '—',
      views: video.views || 0,
      clicks: video.clicks || 0,
    }))
    .sort((left, right) => {
      const leftScore = Number(left.score);
      const rightScore = Number(right.score);
      const leftHasScore = Number.isFinite(leftScore);
      const rightHasScore = Number.isFinite(rightScore);
      if (leftHasScore && rightHasScore && leftScore !== rightScore) return rightScore - leftScore;
      if (leftHasScore !== rightHasScore) return leftHasScore ? -1 : 1;
      return String(left.name).localeCompare(String(right.name));
    }), [videos, audienceNameById]);

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
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/60 bg-slate-950 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-sm">
                <Gauge className="h-3.5 w-3.5" />
                Score hipótesis {formatScore(hypothesis.hypothesis_score)}
              </div>
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
              {mappedVideos.map((video, index) => (
                <div key={video.id} className="relative rounded-xl border bg-white p-4 shadow-sm">
                  <div className="absolute -top-4 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-purple-200" />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{video.name}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">Ranking #{index + 1}</p>
                    </div>
                    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm ${videoScoreTone(video.score)}`}>
                      {index === 0 ? <Trophy className="h-3.5 w-3.5" /> : <Gauge className="h-3.5 w-3.5" />}
                      {formatScore(video.score)}
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500"
                      style={{ width: `${Math.max(0, Math.min(100, Number(video.score) || 0))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-gray-600"><span className="font-medium">Público:</span> {video.audience}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">Funnel:</span> {video.funnel}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">Hook:</span> {video.hook}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">CTA:</span> {video.cta}</p>
                  <p className="mt-1 text-sm text-gray-600"><span className="font-medium">Views / Clicks:</span> {video.views} / {video.clicks}</p>
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
