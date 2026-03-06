import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LeanEvaluationPanel } from '@/modules/interviews/components/LeanEvaluationPanel';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';

const InterviewSessionDetailPage = () => {
  const { projectId, campaignId, sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [leanEvaluation, setLeanEvaluation] = useState({});
  const [savingLean, setSavingLean] = useState(false);

  useEffect(() => {
    interviewsModuleApi.readSession(sessionId).then(setSession).catch(() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`));
  }, [projectId, campaignId, sessionId, navigate]);

  useEffect(() => {
    if (!session) return;
    setLeanEvaluation(session.responses_json?.__lean_evaluation || {});
  }, [session]);

  const saveLeanEvaluation = async () => {
    if (!session) return;
    setSavingLean(true);
    try {
      const responses = { ...(session.responses_json || {}), __lean_evaluation: leanEvaluation };
      const updated = await interviewsModuleApi.updateSession(session.id, { ...session, responses, status: session.status || 'completed' });
      setSession(updated);
    } finally {
      setSavingLean(false);
    }
  };

  const payload = useMemo(() => JSON.stringify(session, null, 2), [session]);

  if (!session) return <div className="min-h-screen bg-slate-50 p-6">Cargando entrevista...</div>;

  const snapshot = session.form_snapshot_json || { questions: [] };
  const answers = session.responses_json || {};

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <Helmet><title>Detalle de entrevista</title></Helmet>
      <div className="max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-slate-500"><Link className="hover:underline" to={`/projects/${projectId}/campaigns/${campaignId}/interviews`}>Proyecto &gt; Campaña &gt; Entrevistas</Link> / Sesión</p>
        <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Sesión de entrevista #{session.id}</h1>
              <p className="text-xs text-slate-500 mt-1">{new Date(session.created_at).toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              <Button className="bg-white border" onClick={() => navigator.clipboard.writeText(payload)}>Copiar JSON</Button>
              <Button className="bg-indigo-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews`)}>Volver</Button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Cliente</p>
              <p className="text-sm font-medium text-slate-900">{session.client_name || '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Formulario</p>
              <p className="text-sm font-medium text-slate-900">{session.form_title || '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Audiencia</p>
              <p className="text-sm font-medium text-slate-900">{session.audience_name || 'Sin audiencia'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Hipótesis</p>
              <p className="text-sm font-medium text-slate-900">{session.hypothesis_title || 'Sin hipótesis'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Fecha</p>
              <p className="text-sm font-medium text-slate-900">{new Date(session.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        <LeanEvaluationPanel value={leanEvaluation} onChange={setLeanEvaluation} onSave={saveLeanEvaluation} saving={savingLean} />

        <div className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">Respuestas y notas</h2>
          {(snapshot.questions || []).map((question) => (
            <div key={question.id} className="border rounded-lg p-3">
              <p className="font-medium">{question.title}</p>
              <p className="text-sm text-slate-600 mt-1">{Array.isArray(answers[question.id]) ? answers[question.id].join(', ') : String(answers[question.id] ?? '—')}</p>
            </div>
          ))}
        </div>

        <div className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Notas del entrevistador</h2>
          <div className="border rounded-lg p-3 bg-slate-50">
            <p className="text-sm text-slate-600">{session.notes || 'Sin notas'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewSessionDetailPage;
