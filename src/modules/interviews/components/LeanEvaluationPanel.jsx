import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';

export const leanVariables = [
  ['problem_intensity', 'Intensidad del problema', '¿Qué tan doloroso es el problema para la persona?'],
  ['problem_frequency', 'Frecuencia del problema', '¿Con qué frecuencia ocurre en su día a día?'],
  ['perceived_urgency', 'Urgencia percibida', '¿Qué tan urgente es resolverlo?'],
  ['solution_attempts', 'Intentos de solución', '¿Ha intentado resolverlo antes?'],
  ['previous_spend', 'Gasto previo', '¿Ha invertido tiempo/dinero en solucionarlo?'],
  ['problem_clarity', 'Claridad del problema', '¿Expresa el problema de forma concreta y clara?'],
  ['segment_fit', 'Encaje con el segmento', '¿Representa bien al segmento objetivo?'],
  ['solution_interest', 'Interés en la solución', '¿Mostró interés real por una posible solución?'],
  ['emotional_language', 'Lenguaje emocional', '¿Usa lenguaje emocional al describir el problema?'],
];

export const getLeanScore = (evaluation = {}) => {
  const values = leanVariables.map(([key]) => Number(evaluation[key] || 0)).filter((value) => value >= 1 && value <= 5);
  if (!values.length) return null;
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(1));
};

export const getLeanInterpretation = (score) => {
  if (score == null) return 'Completa la evaluación para obtener interpretación.';
  if (score >= 4) return 'Problema muy fuerte';
  if (score >= 3) return 'Interesante pero necesita validación';
  if (score >= 2) return 'Problema débil';
  return 'Probablemente no hay mercado';
};

const getInterpretationBadgeClass = (score) => {
  if (score == null) return 'border-slate-200 bg-slate-50 text-slate-600';
  if (score >= 4) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (score >= 3) return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (score >= 2) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

export const LeanEvaluationPanel = ({ value = {}, onChange, onSave, saving = false }) => {
  const score = useMemo(() => getLeanScore(value), [value]);
  const interpretation = useMemo(() => getLeanInterpretation(score), [score]);
  const interpretationBadgeClass = useMemo(() => getInterpretationBadgeClass(score), [score]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900">Evaluación Lean de entrevista</h3>
          <p className="text-xs text-slate-500">Califica cada variable en escala 1–5 (1 = muy bajo, 5 = muy alto).</p>
        </div>
        <div className="min-w-[180px] rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-4 py-3 text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Score Lean</p>
          <p className="text-2xl font-bold text-indigo-700 leading-tight">{score ?? '—'}</p>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${interpretationBadgeClass}`}>{interpretation}</span>
        </div>
      </div>

      <div className="space-y-2">
        {leanVariables.map(([key, title, description]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 transition-all duration-150 hover:border-slate-300 hover:bg-white">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500 mb-2">{description}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((scoreValue) => {
                const selected = Number(value[key]) === scoreValue;
                return (
                  <button
                    key={`${key}_${scoreValue}`}
                    type="button"
                    className={`rounded-lg border py-1.5 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-200 ${selected ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-700'}`}
                    onClick={() => onChange?.({ ...value, [key]: scoreValue })}
                  >
                    {scoreValue}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Completa la evaluación para comparar entrevistas con un marco Lean consistente.</p>
        {onSave && <Button className="bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={onSave}>{saving ? 'Guardando...' : 'Guardar evaluación'}</Button>}
      </div>
    </section>
  );
};
