import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition-all duration-200 hover:border-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100';

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
        <select className={inputClass} value={draft.form_id} onChange={(e) => setDraft((prev) => ({ ...prev, form_id: e.target.value, responses: {} }))}>
          <option value="">Seleccionar formulario</option>
          {forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
        </select>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <select className={inputClass} value={draft.interview_hypothesis_id} onChange={(e) => setDraft((prev) => ({ ...prev, interview_hypothesis_id: e.target.value }))}>
            <option value="">Seleccionar hipótesis (opcional)</option>
            {hypotheses.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title}</option>)}
          </select>
          <textarea className={inputClass} rows={3} placeholder="Notas" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} />

          <div className="space-y-4 border rounded-2xl p-4 bg-slate-50/60">
            <h4 className="font-semibold">Preguntas de la entrevista</h4>
            {(selectedForm?.questions || []).map((question) => {
              const value = answerValue(question.id);
              const missingRequired = question.required && (value == null || value === '' || (Array.isArray(value) && value.length === 0));

              return (
                <div key={question.id} className={`rounded-2xl border bg-white p-4 transition-all duration-200 ${missingRequired ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 hover:border-slate-300'}`}>
                  <p className="text-sm font-semibold">{question.title} {question.required ? '*' : ''}</p>
                  {!!question.description && <p className="mt-1 text-xs text-slate-500">{question.description}</p>}

                  {(question.type === 'short_text' || question.type === 'long_text') && (
                    <input className={`${inputClass} mt-3`} value={value || ''} onChange={(e) => updateAnswer(question, e.target.value)} />
                  )}

                  {question.type === 'single_choice' && (
                    <div className="mt-3 space-y-2">
                      {(question.options || []).map((option) => (
                        <button key={option} type="button" className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-all duration-200 ${value === option ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'} focus:outline-none focus:ring-4 focus:ring-indigo-100`} onClick={() => updateAnswer(question, option)}>{option}</button>
                      ))}
                    </div>
                  )}

                  {question.type === 'multi_choice' && (
                    <div className="mt-3 space-y-2">
                      {(question.options || []).map((option) => {
                        const values = Array.isArray(value) ? value : [];
                        const checked = values.includes(option);
                        return <button key={option} type="button" className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-all duration-200 ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'} focus:outline-none focus:ring-4 focus:ring-indigo-100`} onClick={() => updateAnswer(question, checked ? values.filter((item) => item !== option) : [...values, option])}>{option}</button>;
                      })}
                    </div>
                  )}

                  {question.type === 'scale_1_5' && (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-5 gap-2">
                        {[1, 2, 3, 4, 5].map((scale) => {
                          const selected = Number(value) === scale;
                          return (
                            <button
                              key={`${question.id}_${scale}`}
                              type="button"
                              className={`rounded-xl border py-2 text-sm font-semibold transition-all duration-200 ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'} focus:outline-none focus:ring-4 focus:ring-indigo-100`}
                              onClick={() => updateAnswer(question, scale)}
                            >
                              {scale}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-xs text-slate-500"><span>{question.scale_min_label || 'Muy bajo'}</span><span>{question.scale_max_label || 'Muy alto'}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
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
