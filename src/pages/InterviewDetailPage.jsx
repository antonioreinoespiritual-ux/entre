import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { interviewsApi } from '@/services/interviewsApi';

const InterviewDetailPage = () => {
  const { projectId, campaignId, sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);

  useEffect(() => {
    interviewsApi.readSession(sessionId).then(setSession).catch(() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`));
  }, [sessionId]);

  const answers = session?.responses_json || {};
  const snapshot = session?.form_snapshot_json || { questions: [] };
  const exportPayload = useMemo(() => JSON.stringify({ session, answers, snapshot }, null, 2), [session]);

  if (!session) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <Helmet><title>Detalle entrevista</title></Helmet>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="text-sm text-gray-500"><Link to="/projects" className="hover:underline">Proyectos</Link> / <Link to={`/projects/${projectId}/campaigns/${campaignId}/interviews`} className="hover:underline">Entrevistas</Link> / Detalle</div>
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <h1 className="text-2xl font-bold">Detalle de entrevista</h1>
          <p className="text-sm">Cliente: <b>{session.client_name}</b> · Audiencia: <b>{session.audience_name || '—'}</b></p>
          <p className="text-sm">Formulario: <b>{session.form_title}</b> · Hipótesis: <b>{session.hypothesis_title || '—'}</b></p>
          <p className="text-sm">Estado: <b>{session.status || 'draft'}</b></p>
          <div className="flex gap-2">
            <Button className="bg-gray-100 border text-gray-700" onClick={() => navigator.clipboard.writeText(exportPayload)}>Exportar JSON</Button>
            <Button className="bg-indigo-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`)}>Volver</Button>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold">Respuestas</h2>
          {(snapshot.questions || []).map((q) => (
            <div key={q.id} className="border rounded-lg p-3">
              <p className="font-medium">{q.title}</p>
              <p className="text-sm text-gray-700 mt-1">{Array.isArray(answers[q.id]) ? answers[q.id].join(', ') : String(answers[q.id] ?? '—')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InterviewDetailPage;
