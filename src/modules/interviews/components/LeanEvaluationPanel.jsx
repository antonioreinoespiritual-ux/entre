import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';

export const leanProblemVariables = [
  ['problem_intensity', 'Intensidad del problema', '¿Qué tan doloroso es el problema para la persona?'],
  ['problem_frequency', 'Frecuencia del problema', '¿Con qué frecuencia ocurre en su día a día?'],
  ['perceived_urgency', 'Urgencia percibida', '¿Qué tan urgente es resolverlo?'],
  ['solution_attempts', 'Intentos de solución', '¿Ha intentado resolverlo antes?'],
  ['previous_spend', 'Gasto previo', '¿Ha invertido tiempo/dinero en solucionarlo?'],
  ['problem_clarity', 'Claridad del problema', '¿Expresa el problema de forma concreta y clara?'],
  ['segment_fit', 'Encaje con el segmento', '¿Representa bien al segmento objetivo?'],
  ['emotional_language', 'Lenguaje emocional', '¿Usa lenguaje emocional al describir el problema?'],
];

export const leanSolutionVariables = [
  ['solution_interest', 'Interés en la solución', '¿Mostró interés real por una posible solución?'],
  ['solution_clarity', 'Claridad de la solución', '¿La propuesta se entendió fácilmente?'],
  ['perceived_value', 'Valor percibido', '¿Percibe beneficios claros frente a su situación actual?'],
  ['usage_probability', 'Probabilidad de uso', '¿Qué tan probable es que la use de forma recurrente?'],
  ['willingness_to_pay', 'Disposición a pagar', '¿Mostró señales de pagar por resolver este problema?'],
];

export const leanVariables = [...leanProblemVariables, ...leanSolutionVariables];

const getScoreByKeys = (evaluation = {}, keys = []) => {
  const values = keys.map((key) => Number(evaluation[key] || 0)).filter((value) => value >= 1 && value <= 5);
  if (!values.length) return null;
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(1));
};

export const getLeanProblemScore = (evaluation = {}) => getScoreByKeys(evaluation, leanProblemVariables.map(([key]) => key));
export const getLeanSolutionScore = (evaluation = {}) => getScoreByKeys(evaluation, leanSolutionVariables.map(([key]) => key));

// Backward-compatible global score used by lists/badges.
export const getLeanScore = (evaluation = {}) => getScoreByKeys(evaluation, leanVariables.map(([key]) => key));

export const getLeanInterpretation = (score) => {
  if (score == null) return 'Completa la evaluación para obtener interpretación.';
  if (score >= 4) return 'Problema muy fuerte';
  if (score >= 3) return 'Problema interesante';
  if (score >= 2) return 'Problema débil';
  return 'Probablemente no hay mercado';
};

export const getLeanSolutionInterpretation = (score) => {
  if (score == null) return 'Completa la evaluación de solución.';
  if (score >= 4) return 'Solución fuerte';
  if (score >= 3) return 'Potencial';
  if (score >= 2) return 'Solución débil';
  return 'Baja tracción';
};

const getInterpretationBadgeClass = (score) => {
  if (score == null) return 'border-slate-200 bg-slate-50 text-slate-600';
  if (score >= 4) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (score >= 3) return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (score >= 2) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const VariableSection = ({ title, subtitle, variables, value, onChange }) => (
  <div className="space-y-2">
    <div>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
    {variables.map(([key, variableTitle, description]) => (
      <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 transition-all duration-150 hover:border-slate-300 hover:bg-white">
        <p className="text-sm font-semibold text-slate-900">{variableTitle}</p>
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
);

export const LeanEvaluationPanel = ({ value = {}, onChange, onSave, saving = false }) => {
  const problemScore = useMemo(() => getLeanProblemScore(value), [value]);
  const solutionScore = useMemo(() => getLeanSolutionScore(value), [value]);

  const problemInterpretation = useMemo(() => getLeanInterpretation(problemScore), [problemScore]);
  const solutionInterpretation = useMemo(() => getLeanSolutionInterpretation(solutionScore), [solutionScore]);

  const problemInterpretationBadgeClass = useMemo(() => getInterpretationBadgeClass(problemScore), [problemScore]);
  const solutionInterpretationBadgeClass = useMemo(() => getInterpretationBadgeClass(solutionScore), [solutionScore]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900">Evaluación Lean de entrevista</h3>
          <p className="text-xs text-slate-500">Evalúa por separado fuerza del problema y fuerza de la solución (escala 1–5).</p>
        </div>
        <div className="grid min-w-[360px] grid-cols-2 gap-2">
          <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-4 py-3 text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Score Problema</p>
            <p className="text-2xl font-bold text-indigo-700 leading-tight">{problemScore ?? '—'}</p>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${problemInterpretationBadgeClass}`}>{problemInterpretation}</span>
          </div>

          <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white px-4 py-3 text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Score Solución</p>
            <p className="text-2xl font-bold text-sky-700 leading-tight">{solutionScore ?? '—'}</p>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${solutionInterpretationBadgeClass}`}>{solutionInterpretation}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <VariableSection title="Problema" subtitle="Fuerza y evidencia del dolor del usuario." variables={leanProblemVariables} value={value} onChange={onChange} />
        <VariableSection title="Solución" subtitle="Atracción y viabilidad percibida de la propuesta." variables={leanSolutionVariables} value={value} onChange={onChange} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Usa ambos scores para priorizar entrevistas con problema fuerte y mejor señal de aceptación de solución.</p>
        {onSave && <Button className="bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={onSave}>{saving ? 'Guardando...' : 'Guardar evaluación'}</Button>}
      </div>
    </section>
  );
};
