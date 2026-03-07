import React from 'react';

export const ToolbarButton = ({ icon: Icon, tooltip, label = tooltip, onClick, disabled = false }) => (
  <button
    type="button"
    title={tooltip}
    aria-label={tooltip}
    disabled={disabled}
    onClick={onClick}
    className="inline-flex min-h-[72px] min-w-[84px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-transparent bg-white px-2 py-1.5 text-slate-700 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-45"
  >
    <Icon className="h-6 w-6" />
    <span className="max-w-[76px] text-center text-[11px] font-medium leading-tight text-slate-700">{label}</span>
  </button>
);
