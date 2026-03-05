import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';

const InterviewSessionDetailPage = () => {
  const { projectId, campaignId, sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);

  useEffect(() => {
    interviewsModuleApi.readSession(sessionId).then(setSession).catch(() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`));
  }, [projectId, campaignId, sessionId, navigate]);

  const payload = useMemo(() => JSON.stringify(session, null, 2), [session]);

  if (!session) return <div className="min-h-screen bg-slate-50 p-6">Cargando entrevista...</div>;

  const snapshot = session.form_snapshot_json || { questions: [] };
  const answers = session.responses_json || {};

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <Helmet><title>Detalle de entrevista</title></Helmet>
      <div className="max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-slate-500"><Link className="hover:underline" to={`/projects/${projectId}/campaigns/${campaignId}/interviews`}>Proyecto &gt; Campaña &gt; Entrevistas</Link> / Sesión</p>
        <div className="bg-white border rounded-xl p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Sesión de entrevista #{session.id}</h1>
            <p className="text-sm text-slate-500">{session.client_name} · {session.form_title} · {new Date(session.created_at).toLocaleString()}</p>
            <p className="text-sm text-slate-600 mt-1">Audiencia: {session.audience_name || 'Sin audiencia'} · Hipótesis: {session.hypothesis_title || 'Sin hipótesis'}</p>
          </div>
          <div className="flex gap-2">
            <Button className="bg-white border" onClick={() => navigator.clipboard.writeText(payload)}>Copiar JSON</Button>
            <Button className="bg-indigo-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`)}>Volver</Button>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">Respuestas y notas</h2>
          {(snapshot.questions || []).map((question) => (
            <div key={question.id} className="border rounded-lg p-3">
              <p className="font-medium">{question.title}</p>
              <p className="text-sm text-slate-600 mt-1">{Array.isArray(answers[question.id]) ? answers[question.id].join(', ') : String(answers[question.id] ?? '—')}</p>
            </div>
          ))}
          <div className="border rounded-lg p-3 bg-slate-50">
            <p className="font-medium">Notas</p>
            <p className="text-sm text-slate-600">{session.notes || 'Sin notas'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewSessionDetailPage;
