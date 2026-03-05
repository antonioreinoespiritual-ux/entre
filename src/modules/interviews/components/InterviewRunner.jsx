import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

export const InterviewRunner = ({ audiences, clients, forms, hypotheses, onCreateClient, onSubmit, loading }) => {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState({ audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} });
  const [quickClient, setQuickClient] = useState({ name: '', contact: '', notes: '' });

  const selectedForm = useMemo(() => forms.find((form) => String(form.id) === String(draft.form_id)), [forms, draft.form_id]);
  const filteredClients = clients.filter((client) => !draft.audience_id || String(client.audience_id || '') === String(draft.audience_id));

  const answerValue = (questionId) => draft.responses[questionId];

  const updateAnswer = (question, value) => {
    setDraft((prev) => ({ ...prev, responses: { ...prev.responses, [question.id]: value } }));
  };

  const run = async () => {
    await onSubmit({ ...draft, status: 'completed' });
    setStep(1);
    setDraft({ audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} });
  };

  return (
    <div className="space-y-3">
      <div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-indigo-600 rounded" style={{ width: `${(step / 4) * 100}%` }} /></div>
      {step === 1 && (
        <select className="border rounded p-2 w-full" value={draft.audience_id} onChange={(e) => setDraft((prev) => ({ ...prev, audience_id: e.target.value }))}>
          <option value="">Seleccionar audiencia (opcional)</option>
          {audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}
        </select>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <select className="border rounded p-2 w-full" value={draft.client_id} onChange={(e) => setDraft((prev) => ({ ...prev, client_id: e.target.value }))}>
            <option value="">Seleccionar cliente</option>
            {filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <div className="grid md:grid-cols-4 gap-2">
            <input className="border rounded p-2" placeholder="Nombre" value={quickClient.name} onChange={(e) => setQuickClient((prev) => ({ ...prev, name: e.target.value }))} />
            <input className="border rounded p-2" placeholder="Contacto" value={quickClient.contact} onChange={(e) => setQuickClient((prev) => ({ ...prev, contact: e.target.value }))} />
            <input className="border rounded p-2" placeholder="Notas" value={quickClient.notes} onChange={(e) => setQuickClient((prev) => ({ ...prev, notes: e.target.value }))} />
            <Button className="bg-white border" onClick={async () => {
              const created = await onCreateClient({ ...quickClient, audience_id: draft.audience_id || null });
              setDraft((prev) => ({ ...prev, client_id: created.id }));
              setQuickClient({ name: '', contact: '', notes: '' });
            }}>Crear cliente rápido</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <select className="border rounded p-2 w-full" value={draft.form_id} onChange={(e) => setDraft((prev) => ({ ...prev, form_id: e.target.value, responses: {} }))}>
          <option value="">Seleccionar formulario</option>
          {forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
        </select>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <select className="border rounded p-2 w-full" value={draft.interview_hypothesis_id} onChange={(e) => setDraft((prev) => ({ ...prev, interview_hypothesis_id: e.target.value }))}>
            <option value="">Seleccionar hipótesis (opcional)</option>
            {hypotheses.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title}</option>)}
          </select>
          <textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} />

          <div className="space-y-3 border rounded-xl p-3">
            <h4 className="font-semibold">Preguntas de la entrevista</h4>
            {(selectedForm?.questions || []).map((question) => (
              <div key={question.id} className="space-y-1">
                <p className="text-sm font-medium">{question.title} {question.required ? '*' : ''}</p>
                {(question.type === 'short_text' || question.type === 'long_text') && (
                  <input className="border rounded p-2 w-full" value={answerValue(question.id) || ''} onChange={(e) => updateAnswer(question, e.target.value)} />
                )}
                {question.type === 'single_choice' && (question.options || []).map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm"><input type="radio" name={question.id} checked={answerValue(question.id) === option} onChange={() => updateAnswer(question, option)} />{option}</label>
                ))}
                {question.type === 'multi_choice' && (question.options || []).map((option) => {
                  const values = Array.isArray(answerValue(question.id)) ? answerValue(question.id) : [];
                  const checked = values.includes(option);
                  return <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => updateAnswer(question, e.target.checked ? [...values, option] : values.filter((item) => item !== option))} />{option}</label>;
                })}
                {question.type === 'scale_1_5' && <input type="range" min={1} max={5} value={answerValue(question.id) || 3} onChange={(e) => updateAnswer(question, Number(e.target.value))} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button className="bg-white border" onClick={() => setStep((prev) => Math.max(1, prev - 1))}>Atrás</Button>
        {step < 4 ? (
          <Button className="bg-indigo-600 text-white" onClick={() => setStep((prev) => prev + 1)} disabled={(step === 2 && !draft.client_id) || (step === 3 && !draft.form_id)}>Siguiente</Button>
        ) : (
          <Button className="bg-emerald-600 text-white" onClick={run} disabled={loading}>{loading ? 'Guardando...' : 'Finalizar entrevista'}</Button>
        )}
      </div>
    </div>
  );
};
