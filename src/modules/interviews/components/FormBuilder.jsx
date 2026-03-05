import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const isEditableTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable || tag === 'select';
};

const normalizeOrders = (questions) => questions.map((question, index) => ({ ...question, order: index + 1 }));

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

  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [anchorQuestionId, setAnchorQuestionId] = useState(null);
  const [menuQuestionId, setMenuQuestionId] = useState(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState(null);
  const [dragOverQuestionId, setDragOverQuestionId] = useState(null);
  const [deleteUndoState, setDeleteUndoState] = useState(null);

  const editorRef = useRef(null);
  const undoTimerRef = useRef(null);

  useEffect(() => {
    if (!activeQuestionId && questions[0]?.id) setActiveQuestionId(questions[0].id);
  }, [activeQuestionId, questions, setActiveQuestionId]);

  useEffect(() => {
    const validIds = new Set(questions.map((question) => question.id));
    setSelectedQuestionIds((prev) => prev.filter((id) => validIds.has(id)));
    if (anchorQuestionId && !validIds.has(anchorQuestionId)) setAnchorQuestionId(null);
    if (menuQuestionId && !validIds.has(menuQuestionId)) setMenuQuestionId(null);
  }, [questions, anchorQuestionId, menuQuestionId]);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const canSave = useMemo(() => {
    if (!draft.title?.trim()) return false;
    if (!questions.length) return false;
    return questions.every((question) => question.title?.trim());
  }, [draft.title, questions]);

  const selectedSet = useMemo(() => new Set(selectedQuestionIds), [selectedQuestionIds]);
  const selectionCount = selectedQuestionIds.length;

  const selectionQuestions = useMemo(
    () => questions.filter((question) => selectedSet.has(question.id)),
    [questions, selectedSet],
  );

  const bulkRequiredState = useMemo(() => {
    if (!selectionQuestions.length) return 'none';
    const requiredCount = selectionQuestions.filter((question) => question.required).length;
    if (requiredCount === 0) return 'all_off';
    if (requiredCount === selectionQuestions.length) return 'all_on';
    return 'mixed';
  }, [selectionQuestions]);

  const updateQuestions = (updater) => {
    setDraft((prev) => {
      const nextQuestions = updater([...(prev.questions || [])]);
      return { ...prev, questions: normalizeOrders(nextQuestions) };
    });
  };

  const updateQuestion = (id, patch) => {
    setDraft((prev) => ({
      ...prev,
      questions: (prev.questions || []).map((question) => (question.id === id ? { ...question, ...patch } : question)),
    }));
  };

  const handleSelectQuestion = (event, questionId) => {
    const index = questions.findIndex((question) => question.id === questionId);
    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    if (isShift && anchorQuestionId) {
      const anchorIndex = questions.findIndex((question) => question.id === anchorQuestionId);
      if (anchorIndex >= 0) {
        const [start, end] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
        const range = questions.slice(start, end + 1).map((question) => question.id);
        setSelectedQuestionIds(range);
      }
    } else if (isMeta) {
      setSelectedQuestionIds((prev) => (prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]));
      setAnchorQuestionId(questionId);
    } else {
      setSelectedQuestionIds([questionId]);
      setAnchorQuestionId(questionId);
    }

    setActiveQuestionId(questionId);
  };

  const duplicateQuestion = (question, index) => {
    const clone = {
      ...question,
      id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      options: Array.isArray(question.options) ? [...question.options] : [],
    };
    updateQuestions((next) => {
      next.splice(index + 1, 0, clone);
      return next;
    });
    setActiveQuestionId(clone.id);
    setSelectedQuestionIds([clone.id]);
    setAnchorQuestionId(clone.id);
  };

  const duplicateSelection = () => {
    if (!selectionCount) return;
    const selectedIndexes = questions
      .map((question, index) => ({ id: question.id, index }))
      .filter((item) => selectedSet.has(item.id));
    if (!selectedIndexes.length) return;

    const lastIndex = selectedIndexes[selectedIndexes.length - 1].index;
    const clones = selectedIndexes.map(({ index }) => {
      const source = questions[index];
      return {
        ...source,
        id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}_${index}`,
        options: Array.isArray(source.options) ? [...source.options] : [],
      };
    });

    updateQuestions((next) => {
      next.splice(lastIndex + 1, 0, ...clones);
      return next;
    });

    setSelectedQuestionIds(clones.map((clone) => clone.id));
    setActiveQuestionId(clones[0]?.id || null);
    setAnchorQuestionId(clones[0]?.id || null);
  };

  const commitDeleteWithUndo = (idsToDelete) => {
    const idSet = new Set(idsToDelete);
    const removed = questions
      .map((question, index) => ({ question, index }))
      .filter((item) => idSet.has(item.question.id));

    updateQuestions((next) => next.filter((question) => !idSet.has(question.id)));
    setSelectedQuestionIds([]);
    setAnchorQuestionId(null);

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setDeleteUndoState({ removed, createdAt: Date.now() });
    undoTimerRef.current = setTimeout(() => setDeleteUndoState(null), 5000);

    if (activeQuestionId && idSet.has(activeQuestionId)) {
      const fallback = questions.find((question) => !idSet.has(question.id));
      setActiveQuestionId(fallback?.id || null);
    }
  };

  const deleteSelection = (ids = selectedQuestionIds) => {
    if (!ids.length) return;
    if (ids.length > 1 && !window.confirm(`¿Eliminar ${ids.length} preguntas?`)) return;
    commitDeleteWithUndo(ids);
  };

  const undoDelete = () => {
    if (!deleteUndoState) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    updateQuestions((next) => {
      const restored = [...next];
      deleteUndoState.removed
        .sort((a, b) => a.index - b.index)
        .forEach(({ question, index }) => {
          const at = Math.min(index, restored.length);
          restored.splice(at, 0, question);
        });
      return restored;
    });

    const restoredIds = deleteUndoState.removed.map((item) => item.question.id);
    setSelectedQuestionIds(restoredIds);
    setActiveQuestionId(restoredIds[0] || null);
    setAnchorQuestionId(restoredIds[0] || null);
    setDeleteUndoState(null);
  };

  const addQuestion = () => {
    const activeIndex = questions.findIndex((question) => question.id === activeQuestionId);
    const targetIndex = activeIndex >= 0 ? activeIndex + 1 : questions.length;
    const question = makeQuestion(targetIndex + 1);

    updateQuestions((next) => {
      next.splice(targetIndex, 0, question);
      return next;
    });

    setActiveQuestionId(question.id);
    setSelectedQuestionIds([question.id]);
    setAnchorQuestionId(question.id);
  };

  const moveQuestion = (from, to) => {
    if (to < 0 || to >= questions.length || from === to) return;
    updateQuestions((next) => {
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return next;
    });
  };

  const setRequiredBulk = (value) => {
    const ids = selectedQuestionIds.length ? selectedQuestionIds : activeQuestionId ? [activeQuestionId] : [];
    const idSet = new Set(ids);
    if (!ids.length) return;
    updateQuestions((next) => next.map((question) => (idSet.has(question.id) ? { ...question, required: value } : question)));
  };

  const onEditorKeyDown = (event) => {
    if (!editorRef.current?.contains(event.target)) return;
    if (isEditableTarget(event.target)) {
      if (event.key === 'Escape') {
        setMenuQuestionId(null);
      }
      return;
    }

    const isMeta = event.metaKey || event.ctrlKey;

    if (isMeta && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (selectionCount > 1) duplicateSelection();
      else if (selectionCount === 1) {
        const singleId = selectedQuestionIds[0];
        const index = questions.findIndex((question) => question.id === singleId);
        if (index >= 0) duplicateQuestion(questions[index], index);
      } else if (activeQuestionId) {
        const index = questions.findIndex((question) => question.id === activeQuestionId);
        if (index >= 0) duplicateQuestion(questions[index], index);
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!activeQuestionId && !selectionCount) return;
      event.preventDefault();
      if (selectionCount > 1) deleteSelection(selectedQuestionIds);
      else deleteSelection(selectionCount === 1 ? [selectedQuestionIds[0]] : [activeQuestionId]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedQuestionIds([]);
      setAnchorQuestionId(null);
      setMenuQuestionId(null);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      addQuestion();
    }
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
    <div ref={editorRef} onKeyDown={onEditorKeyDown} tabIndex={0} className="space-y-4 focus:outline-none">
      {selectionCount > 0 ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 sticky top-2 z-30">
          <div>
            <p className="text-sm font-medium text-indigo-900">{selectionCount} seleccionadas</p>
            <p className="text-xs text-indigo-700">Atajos: Ctrl/Cmd+D duplicar · Delete borrar · Esc limpiar</p>
          </div>
          <div className="flex gap-2">
            <Button className="bg-white border" onClick={duplicateSelection}>Duplicar seleccionadas</Button>
            <Button className="bg-white border" onClick={() => setRequiredBulk(!(bulkRequiredState === 'all_on'))}>
              {bulkRequiredState === 'all_on' ? 'Quitar required' : bulkRequiredState === 'mixed' ? 'Required (mixto → ON)' : 'Marcar required'}
            </Button>
            <Button className="bg-red-50 border text-red-700" onClick={() => deleteSelection(selectedQuestionIds)}>Borrar seleccionadas</Button>
          </div>
        </div>
      ) : (
        <div className="bg-white border rounded-xl p-4 space-y-2 sticky top-2 z-20">
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
              <Button className="bg-white border" onClick={addQuestion}>Agregar pregunta</Button>
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
      )}

      <div className="space-y-3">
        {questions.map((question, index) => {
          const active = question.id === activeQuestionId;
          const selected = selectedSet.has(question.id);
          const showDropPlaceholder = dragOverQuestionId === question.id && draggedQuestionId !== question.id;

          return (
            <div key={question.id} className="space-y-2 transition-all duration-150">
              {showDropPlaceholder && <div className="h-2 rounded bg-indigo-200 border border-indigo-400 border-dashed" />}
              <div
                onDragOver={(event) => { event.preventDefault(); setDragOverQuestionId(question.id); }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = questions.findIndex((item) => item.id === draggedQuestionId);
                  const to = questions.findIndex((item) => item.id === question.id);
                  if (from >= 0 && to >= 0) moveQuestion(from, to);
                  setDraggedQuestionId(null);
                  setDragOverQuestionId(null);
                }}
                onDragEnd={() => { setDraggedQuestionId(null); setDragOverQuestionId(null); }}
                onClick={(event) => handleSelectQuestion(event, question.id)}
                className={`border rounded-xl p-4 bg-white transition ${
                  selected ? 'border-indigo-400 bg-indigo-50/40' : active ? 'ring-2 ring-indigo-500 border-indigo-400' : 'hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => { event.stopPropagation(); setDraggedQuestionId(question.id); setDragOverQuestionId(question.id); }}
                    onDragEnd={() => { setDraggedQuestionId(null); setDragOverQuestionId(null); }}
                    className="mt-2 text-slate-400 hover:text-slate-700 cursor-grab"
                    title="Arrastrar para reordenar"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    ⋮⋮
                  </button>
                  <div className="flex-1 space-y-2">
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

                      <div className="relative flex items-center justify-end gap-1 md:col-span-1">
                        <Button className="bg-white border" onClick={(event) => { event.stopPropagation(); duplicateQuestion(question, index); }}>Duplicar</Button>
                        <Button className="bg-white border" title="Más acciones" onClick={(event) => { event.stopPropagation(); setMenuQuestionId((prev) => (prev === question.id ? null : question.id)); }}>⋮</Button>
                        {menuQuestionId === question.id && (
                          <div className="absolute right-0 top-10 z-40 w-52 bg-white border rounded-lg shadow p-1">
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded" onClick={(event) => { event.stopPropagation(); duplicateQuestion(question, index); setMenuQuestionId(null); }}>Duplicar (Ctrl/Cmd+D)</button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded" onClick={(event) => { event.stopPropagation(); updateQuestion(question.id, { required: !question.required }); setMenuQuestionId(null); }}>{question.required ? 'Quitar required' : 'Marcar required'}</button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded" onClick={(event) => { event.stopPropagation(); moveQuestion(index, index - 1); setMenuQuestionId(null); }}>Mover arriba</button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded" onClick={(event) => { event.stopPropagation(); moveQuestion(index, index + 1); setMenuQuestionId(null); }}>Mover abajo</button>
                            <button className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 rounded" onClick={(event) => { event.stopPropagation(); deleteSelection([question.id]); setMenuQuestionId(null); }}>Eliminar (Delete)</button>
                          </div>
                        )}
                      </div>
                    </div>

                    <textarea className="border rounded p-2 w-full text-sm" rows={2} placeholder="Descripción (opcional)" value={question.description || ''} onChange={(e) => updateQuestion(question.id, { description: e.target.value })} />

                    {supportsOptions(question.type) && (
                      <div className="space-y-2">
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
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                const next = [...(question.options || [])];
                                next.splice(optionIndex + 1, 0, '');
                                updateQuestion(question.id, { options: next });
                              }
                              if (event.key === 'Backspace' && !option && (question.options || []).length > 1) {
                                event.preventDefault();
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
                      <div className="grid md:grid-cols-2 gap-2">
                        <input className="border rounded p-2" placeholder="Etiqueta mínima" value={question.scale_min_label || ''} onChange={(e) => updateQuestion(question.id, { scale_min_label: e.target.value })} />
                        <input className="border rounded p-2" placeholder="Etiqueta máxima" value={question.scale_max_label || ''} onChange={(e) => updateQuestion(question.id, { scale_max_label: e.target.value })} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {deleteUndoState && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg">
          <p className="text-sm">Preguntas eliminadas</p>
          <button className="text-sm underline" onClick={undoDelete}>Deshacer</button>
        </div>
      )}

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
