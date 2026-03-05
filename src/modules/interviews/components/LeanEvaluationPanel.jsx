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

export const LeanEvaluationPanel = ({ value = {}, onChange, onSave, saving = false }) => {
  const score = useMemo(() => getLeanScore(value), [value]);
  const interpretation = useMemo(() => getLeanInterpretation(score), [score]);

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Evaluación Lean de entrevista</h3>
          <p className="text-xs text-slate-500">Escala 1 a 5 (1 = muy bajo, 5 = muy alto).</p>
        </div>
        {score != null && <p className="text-sm font-semibold text-indigo-700">Score Lean: {score}</p>}
      </div>

      <div className="space-y-2">
        {leanVariables.map(([key, title, description]) => (
          <div key={key} className="border rounded-lg p-3">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-slate-500 mb-2">{description}</p>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5].map((scoreValue) => {
                const selected = Number(value[key]) === scoreValue;
                return (
                  <button
                    key={`${key}_${scoreValue}`}
                    type="button"
                    className={`rounded-lg border py-1.5 text-sm transition-all ${selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-slate-50 border-slate-200'}`}
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
        <p className="text-sm text-slate-700">{interpretation}</p>
        {onSave && <Button className="bg-indigo-600 text-white" disabled={saving} onClick={onSave}>{saving ? 'Guardando...' : 'Guardar evaluación'}</Button>}
      </div>
    </div>
  );
};
