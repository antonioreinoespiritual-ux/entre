import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { QUESTION_TYPES } from '@/modules/interviews/services/interviewsModuleApi';

const blankQuestion = (index) => ({ id: `q_${Date.now()}_${index}`, title: '', type: 'short_text', required: false, options: ['Opción 1'] });

export const FormBuilder = ({ draft, setDraft, onSave, saving }) => {
  const questions = draft.questions || [];

  const canSave = useMemo(() => draft.title?.trim() && questions.length > 0 && questions.every((q) => q.title?.trim()), [draft, questions]);

  const updateQuestion = (index, patch) => {
    const next = [...questions];
    next[index] = { ...next[index], ...patch };
    setDraft((prev) => ({ ...prev, questions: next }));
  };

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded p-2" placeholder="Título" value={draft.title || ''} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
        <input className="border rounded p-2" placeholder="Descripción" value={draft.description || ''} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} />
      </div>

      <div className="space-y-2">
        {questions.map((question, index) => (
          <div key={question.id || index} className="border rounded-xl p-3 bg-slate-50 space-y-2">
            <div className="grid md:grid-cols-6 gap-2">
              <input className="border rounded p-2 md:col-span-3" placeholder={`Pregunta ${index + 1}`} value={question.title || ''} onChange={(e) => updateQuestion(index, { title: e.target.value })} />
              <select className="border rounded p-2 md:col-span-2" value={question.type} onChange={(e) => updateQuestion(index, { type: e.target.value })}>
                {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={Boolean(question.required)} onChange={(e) => updateQuestion(index, { required: e.target.checked })} />Requerida</label>
            </div>

            {(question.type === 'single_choice' || question.type === 'multi_choice') && (
              <div className="space-y-2">
                {(question.options || []).map((option, optionIndex) => (
                  <div key={`${question.id}_option_${optionIndex}`} className="flex gap-2">
                    <input className="border rounded p-2 flex-1" value={option} onChange={(e) => {
                      const options = [...(question.options || [])];
                      options[optionIndex] = e.target.value;
                      updateQuestion(index, { options });
                    }} />
                    <Button className="bg-white border" onClick={() => {
                      const options = (question.options || []).filter((_, i) => i !== optionIndex);
                      updateQuestion(index, { options });
                    }}>Quitar</Button>
                  </div>
                ))}
                <Button className="bg-white border" onClick={() => updateQuestion(index, { options: [...(question.options || []), `Opción ${(question.options || []).length + 1}`] })}>Agregar opción</Button>
              </div>
            )}

            <div className="flex gap-2">
              <Button className="bg-white border" onClick={() => {
                if (index === 0) return;
                const next = [...questions];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                setDraft((prev) => ({ ...prev, questions: next }));
              }}>Subir</Button>
              <Button className="bg-white border" onClick={() => {
                if (index === questions.length - 1) return;
                const next = [...questions];
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                setDraft((prev) => ({ ...prev, questions: next }));
              }}>Bajar</Button>
              <Button className="bg-red-50 border text-red-700" onClick={() => setDraft((prev) => ({ ...prev, questions: questions.filter((_, i) => i !== index) }))}>Borrar</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button className="bg-white border" onClick={() => setDraft((prev) => ({ ...prev, questions: [...questions, blankQuestion(questions.length + 1)] }))}>Agregar pregunta</Button>
        <Button className="bg-indigo-600 text-white" disabled={!canSave || saving} onClick={onSave}>{saving ? 'Guardando...' : 'Guardar formulario'}</Button>
      </div>

      <div className="border rounded-xl p-3">
        <h4 className="font-semibold">Preview</h4>
        {(questions || []).map((question) => (
          <div key={`preview_${question.id}`} className="py-2 border-b last:border-b-0">
            <p className="text-sm font-medium">{question.title || 'Pregunta sin título'} {question.required ? '*' : ''}</p>
            <p className="text-xs text-slate-500">Tipo: {question.type}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
