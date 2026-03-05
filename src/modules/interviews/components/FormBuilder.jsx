import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { QUESTION_TYPES } from '@/modules/interviews/services/interviewsModuleApi';

const makeQuestion = (index = 1) => ({
  id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  title: '',
  type: 'short_text',
  required: false,
  options: [''],
  scale_min_label: 'Muy bajo',
  scale_max_label: 'Muy alto',
  description: '',
  order: index,
});

const supportsOptions = (type) => type === 'single_choice' || type === 'multi_choice';

export const FormBuilder = ({
  draft,
  setDraft,
  activeQuestionId,
  setActiveQuestionId,
  onClose,
  onSave,
  saveStatus,
  saveError,
  preview,
  setPreview,
}) => {
  const questions = draft.questions || [];
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);

  useEffect(() => {
    if (!activeQuestionId && questions[0]?.id) setActiveQuestionId(questions[0].id);
  }, [activeQuestionId, questions, setActiveQuestionId]);

  const canSave = useMemo(() => {
    if (!draft.title?.trim()) return false;
    if (!questions.length) return false;
    return questions.every((question) => question.title?.trim());
  }, [draft.title, questions]);

  const activeIndex = questions.findIndex((question) => question.id === activeQuestionId);

  const updateQuestion = (id, patch) => {
    setDraft((prev) => ({
      ...prev,
      questions: (prev.questions || []).map((question) => (question.id === id ? { ...question, ...patch } : question)),
    }));
  };

  const duplicateQuestion = (question, index) => {
    const clone = {
      ...question,
      id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      options: Array.isArray(question.options) ? [...question.options] : [],
    };
    setDraft((prev) => {
      const next = [...(prev.questions || [])];
      next.splice(index + 1, 0, clone);
      return { ...prev, questions: next.map((item, idx) => ({ ...item, order: idx + 1 })) };
    });
    setActiveQuestionId(clone.id);
  };

  const deleteQuestion = (questionId) => {
    setDraft((prev) => {
      const next = (prev.questions || []).filter((question) => question.id !== questionId).map((question, index) => ({ ...question, order: index + 1 }));
      return { ...prev, questions: next };
    });
    if (questionId === activeQuestionId) setActiveQuestionId(null);
  };

  const addQuestion = () => {
    const question = makeQuestion((questions.length || 0) + 1);
    setDraft((prev) => ({ ...prev, questions: [...(prev.questions || []), question] }));
    setActiveQuestionId(question.id);
  };

  const moveQuestion = (from, to) => {
    if (to < 0 || to >= questions.length) return;
    setDraft((prev) => {
      const next = [...(prev.questions || [])];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return { ...prev, questions: next.map((question, index) => ({ ...question, order: index + 1 })) };
    });
  };

  const renderPreviewQuestion = (question) => (
    <div key={`preview_${question.id}`} className="border rounded-xl p-3 bg-white">
      <p className="font-medium">{question.title || 'Pregunta sin título'} {question.required ? '*' : ''}</p>
      {!!question.description && <p className="text-xs text-slate-500 mt-1">{question.description}</p>}
      {(question.type === 'short_text' || question.type === 'long_text') && <input className="mt-2 border rounded p-2 w-full" placeholder={question.type === 'long_text' ? 'Respuesta larga' : 'Respuesta corta'} disabled />}
      {supportsOptions(question.type) && (
        <div className="mt-2 space-y-1">
          {(question.options || []).filter(Boolean).map((option) => <p key={`${question.id}_${option}`} className="text-sm">• {option}</p>)}
        </div>
      )}
      {question.type === 'scale_1_5' && (
        <div className="mt-2">
          <input type="range" min={1} max={5} defaultValue={3} disabled />
          <div className="flex justify-between text-xs text-slate-500"><span>{question.scale_min_label || '1'}</span><span>{question.scale_max_label || '5'}</span></div>
        </div>
      )}
    </div>
  );

  if (preview) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Vista previa</h3>
          <Button className="bg-white border" onClick={() => setPreview(false)}>Volver a edición</Button>
        </div>
        <div className="bg-slate-50 border rounded-xl p-4 space-y-3">
          <h2 className="text-xl font-bold">{draft.title || 'Formulario sin título'}</h2>
          <p className="text-sm text-slate-500">{draft.description || 'Sin descripción'}</p>
          {(questions || []).map(renderPreviewQuestion)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-xl p-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Editor de formulario</p>
            <p className={`text-xs ${saveStatus === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
              {saveStatus === 'saving' && 'Guardando...'}
              {saveStatus === 'saved' && 'Guardado'}
              {saveStatus === 'dirty' && 'Cambios sin guardar'}
              {saveStatus === 'error' && (saveError || 'Error al guardar')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button className="bg-white border" onClick={() => setPreview(true)}>Vista previa</Button>
            <Button className="bg-white border" onClick={() => {
              if (saveStatus === 'dirty' || saveStatus === 'saving') return setShowLeaveWarning(true);
              onClose();
            }}>Volver a lista</Button>
            <Button className="bg-indigo-600 text-white" disabled={!canSave || saveStatus === 'saving'} onClick={onSave}>Guardar</Button>
          </div>
        </div>
        <input className="w-full text-3xl font-semibold border-0 border-b p-0 pb-2 focus:outline-none" placeholder="Título del formulario" value={draft.title || ''} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
        <textarea className="w-full text-sm text-slate-600 border rounded p-2" rows={2} placeholder="Descripción" value={draft.description || ''} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} />
      </div>

      <div className="space-y-3">
        {questions.map((question, index) => {
          const active = question.id === activeQuestionId;
          return (
            <div key={question.id} onClick={() => setActiveQuestionId(question.id)} className={`border rounded-xl p-4 bg-white transition ${active ? 'ring-2 ring-indigo-500 border-indigo-400' : 'hover:border-slate-300'}`}>
              <div className="grid md:grid-cols-8 gap-2 items-center">
                <input className="border rounded p-2 md:col-span-4" placeholder={`Pregunta ${index + 1}`} value={question.title || ''} onChange={(e) => updateQuestion(question.id, { title: e.target.value })} />
                <select className="border rounded p-2 md:col-span-2" value={question.type} onChange={(e) => {
                  const nextType = e.target.value;
                  updateQuestion(question.id, {
                    type: nextType,
                    options: supportsOptions(nextType) ? (question.options?.length ? question.options : ['']) : [],
                  });
                }}>
                  {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <label className="text-sm flex items-center gap-2 md:col-span-1"><input type="checkbox" checked={Boolean(question.required)} onChange={(e) => updateQuestion(question.id, { required: e.target.checked })} />Required</label>
                <div className="flex items-center justify-end gap-1 md:col-span-1">
                  <Button className="bg-white border" onClick={(e) => { e.stopPropagation(); duplicateQuestion(question, index); }}>Duplicar</Button>
                  <Button className="bg-red-50 border text-red-700" onClick={(e) => { e.stopPropagation(); deleteQuestion(question.id); }}>Borrar</Button>
                </div>
              </div>

              <textarea className="border rounded p-2 w-full mt-2 text-sm" rows={2} placeholder="Descripción (opcional)" value={question.description || ''} onChange={(e) => updateQuestion(question.id, { description: e.target.value })} />

              {supportsOptions(question.type) && (
                <div className="space-y-2 mt-2">
                  {(question.options || []).map((option, optionIndex) => (
                    <input
                      key={`${question.id}_${optionIndex}`}
                      className="border rounded p-2 w-full"
                      placeholder={`Opción ${optionIndex + 1}`}
                      value={option}
                      onChange={(e) => {
                        const next = [...(question.options || [])];
                        next[optionIndex] = e.target.value;
                        updateQuestion(question.id, { options: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const next = [...(question.options || [])];
                          next.splice(optionIndex + 1, 0, '');
                          updateQuestion(question.id, { options: next });
                        }
                        if (e.key === 'Backspace' && !option && (question.options || []).length > 1) {
                          e.preventDefault();
                          const next = [...(question.options || [])].filter((_, i) => i !== optionIndex);
                          updateQuestion(question.id, { options: next });
                        }
                      }}
                    />
                  ))}
                  <Button className="bg-white border" onClick={() => updateQuestion(question.id, { options: [...(question.options || []), ''] })}>Agregar opción</Button>
                </div>
              )}

              {question.type === 'scale_1_5' && (
                <div className="grid md:grid-cols-2 gap-2 mt-2">
                  <input className="border rounded p-2" placeholder="Etiqueta mínima" value={question.scale_min_label || ''} onChange={(e) => updateQuestion(question.id, { scale_min_label: e.target.value })} />
                  <input className="border rounded p-2" placeholder="Etiqueta máxima" value={question.scale_max_label || ''} onChange={(e) => updateQuestion(question.id, { scale_max_label: e.target.value })} />
                </div>
              )}

              <div className="flex gap-2 mt-3 opacity-100 md:opacity-0 md:hover:opacity-100 transition">
                <Button className="bg-white border" onClick={(e) => { e.stopPropagation(); moveQuestion(index, index - 1); }}>Subir</Button>
                <Button className="bg-white border" onClick={(e) => { e.stopPropagation(); moveQuestion(index, index + 1); }}>Bajar</Button>
              </div>
            </div>
          );
        })}
      </div>

      <Button className="bg-white border" onClick={addQuestion}>+ Agregar pregunta</Button>

      {showLeaveWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border rounded-xl p-4 max-w-md w-full space-y-3">
            <h4 className="font-semibold">Hay cambios sin guardar</h4>
            <p className="text-sm text-slate-600">Si sales ahora podrías perder cambios recientes. ¿Deseas salir igualmente?</p>
            <div className="flex justify-end gap-2">
              <Button className="bg-white border" onClick={() => setShowLeaveWarning(false)}>Cancelar</Button>
              <Button className="bg-red-600 text-white" onClick={onClose}>Salir sin guardar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const createEmptyFormDraft = () => ({ title: '', description: '', questions: [makeQuestion(1)] });
