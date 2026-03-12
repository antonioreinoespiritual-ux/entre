import React from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const InterviewModuleShell = ({ projectId, campaignId, activeTab, onTabChange, onOpenRun, onOpenForm, onOpenClient, children }) => {
  const tabs = [
    ['dashboard', 'Dashboard'],
    ['clients', 'Clientes'],
    ['forms', 'Formularios'],
    ['hypotheses', 'Hipótesis'],
    ['sessions', 'Entrevistas'],
    ['cloud', 'Cloud research'],
    ['semantic', 'Análisis semántico'],
    ['quantitative', 'Análisis cuantitativo'],
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">Proyecto / Campaña / Entrevistas</p>
            <h1 className="text-2xl font-bold">Centro de Entrevistas</h1>
            <p className="text-xs text-slate-500">Proyecto {projectId} · Campaña {campaignId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-indigo-600 text-white" onClick={onOpenRun}>Realizar entrevista</Button>
            <Button className="bg-white border text-indigo-700" onClick={onOpenForm}>Crear formulario</Button>
            <Button className="bg-indigo-600 text-white" onClick={onOpenClient}><UserPlus className="h-4 w-4 mr-1" />Crear cliente</Button>
          </div>
        </div>
        <div className="bg-white border rounded-xl p-1 flex flex-wrap gap-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`px-4 py-2 rounded-lg text-sm ${activeTab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
};

export const Modal = ({ title, open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
      <div className="w-full max-w-3xl bg-white rounded-2xl border p-4 max-h-[90vh] overflow-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{title}</h3>
          <Button className="bg-white border text-slate-700" onClick={onClose}>Cerrar</Button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const EmptyState = ({ title, description, action }) => (
  <div className="border rounded-xl p-8 bg-white text-center space-y-2">
    <h3 className="font-semibold">{title}</h3>
    <p className="text-sm text-slate-500">{description}</p>
    {action}
  </div>
);
