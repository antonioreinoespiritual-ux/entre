import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LeanEvaluationPanel } from '@/modules/interviews/components/LeanEvaluationPanel';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition-all duration-200 hover:border-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100';

const getRequiredMissing = (question, value) => question.required && (value == null || value === '' || (Array.isArray(value) && value.length === 0));

export const InterviewRunner = ({ audiences, clients, forms, hypotheses, onCreateClient, onStartInterview, onAutosave, onCompleteInterview, onViewSession, initialClientId = null, initialAudienceId = null, loading }) => {
  const [step, setStep] = useState(1);
  const [saveState, setSaveState] = useState('idle');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [completedSessionId, setCompletedSessionId] = useState(null);
  const [leanEvaluation, setLeanEvaluation] = useState({});

  const [draft, setDraft] = useState({
    audience_id: '',
    client_id: '',
    form_id: '',
    interview_hypothesis_id: '',
    notes: '',
    responses: {},
    question_notes: {},
  });
  const [quickClient, setQuickClient] = useState({ name: '', contact: '', notes: '' });


  useEffect(() => {
    if (!initialClientId) return;
    setDraft((prev) => ({
      ...prev,
      client_id: String(initialClientId),
      audience_id: prev.audience_id || String(initialAudienceId || ''),
    }));
    setStep(3);
  }, [initialClientId, initialAudienceId]);

  const selectedForm = useMemo(() => forms.find((form) => String(form.id) === String(draft.form_id)), [forms, draft.form_id]);
  const filteredClients = clients.filter((client) => !draft.audience_id || String(client.audience_id || '') === String(draft.audience_id));

  const questions = selectedForm?.questions || [];
  const currentQuestion = questions[currentQuestionIndex] || null;
  const progress = questions.length ? Math.round(((currentQuestionIndex + 1) / questions.length) * 100) : 0;

  const buildPayload = () => ({
    audience_id: draft.audience_id || null,
    client_id: draft.client_id || null,
    form_id: draft.form_id || null,
    interview_hypothesis_id: draft.interview_hypothesis_id || null,
    notes: draft.notes || '',
    responses: {
      ...(draft.responses || {}),
      __question_notes: draft.question_notes || {},
      __lean_evaluation: leanEvaluation || {},
    },
  });

  useEffect(() => {
    if (step !== 6 || !sessionId) return undefined;
    setSaveState('saving');
    const timer = setTimeout(async () => {
      try {
        await onAutosave(sessionId, buildPayload());
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [draft.responses, draft.question_notes, draft.notes, step, sessionId]);

  const updateAnswer = (question, value) => {
    setDraft((prev) => ({ ...prev, responses: { ...prev.responses, [question.id]: value } }));
  };

  const updateQuestionNote = (questionId, value) => {
    setDraft((prev) => ({ ...prev, question_notes: { ...prev.question_notes, [questionId]: value } }));
  };

  const startGuidedInterview = async () => {
    const created = await onStartInterview({ ...buildPayload(), status: 'draft' });
    setSessionId(created.id);
    setCurrentQuestionIndex(0);
    setStep(6);
  };

  const finishInterview = async () => {
    const completed = await onCompleteInterview(sessionId, { ...buildPayload(), status: 'completed' });
    setCompletedSessionId(completed.id);
    setStep(7);
  };

  const resetAll = () => {
    setStep(1);
    setCurrentQuestionIndex(0);
    setSessionId(null);
    setCompletedSessionId(null);
    setSaveState('idle');
    setLeanEvaluation({});
    setDraft({
      audience_id: String(initialAudienceId || ''),
      client_id: String(initialClientId || ''),
      form_id: '',
      interview_hypothesis_id: '',
      notes: '',
      responses: {},
      question_notes: {},
    });
  };


  const saveLeanEvaluation = async () => {
    if (!sessionId) return;
    await onCompleteInterview(sessionId, { ...buildPayload(), status: 'completed' });
  };

  return (
    <div className="space-y-4">
      {(step <= 5) && <div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-indigo-600 rounded transition-all duration-200" style={{ width: `${(step / 5) * 100}%` }} /></div>}

      {step === 1 && (
        <select className={inputClass} value={draft.audience_id} onChange={(e) => setDraft((prev) => ({ ...prev, audience_id: e.target.value }))}>
          <option value="">Seleccionar audiencia (opcional)</option>
          {audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}
        </select>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <select className={inputClass} value={draft.client_id} onChange={(e) => setDraft((prev) => ({ ...prev, client_id: e.target.value }))}>
            <option value="">Seleccionar cliente</option>
            {filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <div className="grid md:grid-cols-4 gap-2">
            <input className={inputClass} placeholder="Nombre" value={quickClient.name} onChange={(e) => setQuickClient((prev) => ({ ...prev, name: e.target.value }))} />
            <input className={inputClass} placeholder="Contacto" value={quickClient.contact} onChange={(e) => setQuickClient((prev) => ({ ...prev, contact: e.target.value }))} />
            <input className={inputClass} placeholder="Notas" value={quickClient.notes} onChange={(e) => setQuickClient((prev) => ({ ...prev, notes: e.target.value }))} />
            <Button className="bg-white border" onClick={async () => {
              const created = await onCreateClient({ ...quickClient, audience_id: draft.audience_id || null });
              setDraft((prev) => ({ ...prev, client_id: created.id }));
              setQuickClient({ name: '', contact: '', notes: '' });
            }}>Crear cliente rápido</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <select className={inputClass} value={draft.form_id} onChange={(e) => setDraft((prev) => ({ ...prev, form_id: e.target.value, responses: {}, question_notes: {} }))}>
          <option value="">Seleccionar formulario</option>
          {forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
        </select>
      )}

      {step === 4 && (
        <select className={inputClass} value={draft.interview_hypothesis_id} onChange={(e) => setDraft((prev) => ({ ...prev, interview_hypothesis_id: e.target.value }))}>
          <option value="">Seleccionar hipótesis (opcional)</option>
          {hypotheses.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title}</option>)}
        </select>
      )}

      {step === 5 && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-sm text-slate-600">Modo entrevista guiado listo</p>
          <p className="text-sm"><b>Cliente:</b> {clients.find((c) => String(c.id) === String(draft.client_id))?.name || '—'}</p>
          <p className="text-sm"><b>Formulario:</b> {selectedForm?.title || '—'} · {questions.length} preguntas</p>
          <textarea className={inputClass} rows={3} placeholder="Notas generales de la entrevista" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} />
          <Button className="bg-indigo-600 text-white" onClick={startGuidedInterview} disabled={loading || !draft.client_id || !draft.form_id}>Iniciar entrevista guiada</Button>
        </div>
      )}

      {step === 6 && currentQuestion && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Pregunta {currentQuestionIndex + 1} de {questions.length}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-indigo-600 rounded transition-all duration-200" style={{ width: `${progress}%` }} /></div>
          </div>

          <div className={`rounded-2xl border bg-white p-5 transition-all duration-200 ${getRequiredMissing(currentQuestion, draft.responses[currentQuestion.id]) ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'}`}>
            <p className="text-lg font-semibold text-slate-900">{currentQuestion.title} {currentQuestion.required ? '*' : ''}</p>
            {!!currentQuestion.description && <p className="mt-1 text-sm text-slate-500">{currentQuestion.description}</p>}

            {(currentQuestion.type === 'short_text' || currentQuestion.type === 'long_text') && (
              <textarea
                className={`${inputClass} mt-4`}
                rows={currentQuestion.type === 'long_text' ? 4 : 2}
                value={draft.responses[currentQuestion.id] || ''}
                onChange={(e) => updateAnswer(currentQuestion, e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && currentQuestion.type !== 'long_text') {
                    event.preventDefault();
                    setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1));
                  }
                }}
              />
            )}

            {currentQuestion.type === 'single_choice' && (
              <div className="mt-4 space-y-2">
                {(currentQuestion.options || []).map((option) => {
                  const selected = draft.responses[currentQuestion.id] === option;
                  return <button key={option} type="button" className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-all duration-200 ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'} focus:outline-none focus:ring-4 focus:ring-indigo-100`} onClick={() => updateAnswer(currentQuestion, option)}>{option}</button>;
                })}
              </div>
            )}

            {currentQuestion.type === 'multi_choice' && (
              <div className="mt-4 space-y-2">
                {(currentQuestion.options || []).map((option) => {
                  const values = Array.isArray(draft.responses[currentQuestion.id]) ? draft.responses[currentQuestion.id] : [];
                  const selected = values.includes(option);
                  return <button key={option} type="button" className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-all duration-200 ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'} focus:outline-none focus:ring-4 focus:ring-indigo-100`} onClick={() => updateAnswer(currentQuestion, selected ? values.filter((item) => item !== option) : [...values, option])}>{option}</button>;
                })}
              </div>
            )}

            {currentQuestion.type === 'scale_1_5' && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((scale) => {
                    const selected = Number(draft.responses[currentQuestion.id]) === scale;
                    return (
                      <button key={scale} type="button" className={`rounded-xl border py-2 text-sm font-semibold transition-all duration-200 ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'} focus:outline-none focus:ring-4 focus:ring-indigo-100`} onClick={() => updateAnswer(currentQuestion, scale)}>
                        {scale}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-slate-500"><span>{currentQuestion.scale_min_label || 'Muy bajo'}</span><span>{currentQuestion.scale_max_label || 'Muy alto'}</span></div>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-1">Nota del entrevistador (separada de la respuesta)</p>
              <textarea className={inputClass} rows={2} value={draft.question_notes[currentQuestion.id] || ''} onChange={(e) => updateQuestionNote(currentQuestion.id, e.target.value)} />
            </div>

            {getRequiredMissing(currentQuestion, draft.responses[currentQuestion.id]) && <p className="mt-3 text-xs text-amber-700 font-medium">Esta pregunta es requerida.</p>}
          </div>

          <div className="flex items-center justify-between">
            <Button className="bg-white border" onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0}>Atrás</Button>
            <p className={`text-xs ${saveState === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{saveState === 'saving' ? 'Guardando automáticamente…' : saveState === 'saved' ? 'Guardado automático' : saveState === 'error' ? 'Error de guardado' : ''}</p>
            {currentQuestionIndex < questions.length - 1 ? (
              <Button className="bg-indigo-600 text-white" onClick={() => setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}>Siguiente</Button>
            ) : (
              <Button className="bg-emerald-600 text-white" onClick={finishInterview} disabled={loading}>Finalizar entrevista</Button>
            )}
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
            <h4 className="font-semibold text-emerald-800">Entrevista completada</h4>
            <p className="text-sm text-emerald-900">Formulario: <b>{selectedForm?.title || '—'}</b></p>
            <p className="text-sm text-emerald-900">Cliente: <b>{clients.find((c) => String(c.id) === String(draft.client_id))?.name || '—'}</b></p>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-emerald-600 text-white" onClick={() => onViewSession?.(completedSessionId)}>Ver entrevista</Button>
              <Button className="bg-white border" onClick={resetAll}>Iniciar otra</Button>
            </div>
          </div>

          <LeanEvaluationPanel value={leanEvaluation} onChange={setLeanEvaluation} onSave={saveLeanEvaluation} saving={loading} />
        </div>
      )}

      {step < 6 && (
        <div className="flex justify-between">
          <Button className="bg-white border" onClick={() => setStep((prev) => Math.max(1, prev - 1))}>Atrás</Button>
          <Button
            className="bg-indigo-600 text-white"
            onClick={() => setStep((prev) => Math.min(5, prev + 1))}
            disabled={(step === 2 && !draft.client_id) || (step === 3 && !draft.form_id)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
};
