import React from 'react';

export const ToolbarButton = ({ icon: Icon, tooltip, onClick, disabled = false }) => (
  <button
    type="button"
    title={tooltip}
    aria-label={tooltip}
    disabled={disabled}
    onClick={onClick}
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
  >
    <Icon className="h-4 w-4" />
  </button>
);
