import React from 'react';
import { BarChart3, Blocks, BookOpenText, Brain, FileText, Link2, Plus, Scissors, StickyNote, Tags } from 'lucide-react';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarDivider } from './ToolbarDivider';
import { ToolbarGroup } from './ToolbarGroup';

export const Toolbar = ({
  onCreateFragment,
  onCreateManualFragment,
  onViewFragments,
  onViewCodes,
  onLinkCode,
  onViewClusters,
  onActivateAnalysis,
  onCreateMemo,
  onToggleView,
  canCreateFragment,
  viewLabel,
}) => (
  <div className="mb-2 rounded-lg border bg-white px-2 py-1.5">
    <div className="flex flex-nowrap items-center overflow-x-auto">
      <ToolbarGroup>
        <ToolbarButton icon={Scissors} tooltip="Crear fragmento" onClick={onCreateFragment} disabled={!canCreateFragment} />
        <ToolbarButton icon={Plus} tooltip="Añadir fragmento manual" onClick={onCreateManualFragment} />
        <ToolbarButton icon={FileText} tooltip="Ver fragmentos" onClick={onViewFragments} />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton icon={Tags} tooltip="Ver códigos" onClick={onViewCodes} />
        <ToolbarButton icon={Link2} tooltip="Vincular código" onClick={onLinkCode} />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton icon={Blocks} tooltip="Ver clusters" onClick={onViewClusters} />
        <ToolbarButton icon={Brain} tooltip="Técnicas de análisis" onClick={onActivateAnalysis} />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton icon={StickyNote} tooltip="Crear memo" onClick={onCreateMemo} />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton icon={BookOpenText} tooltip={`Cambiar vista (${viewLabel})`} onClick={onToggleView} />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton icon={BarChart3} tooltip="Activar técnicas" onClick={onActivateAnalysis} />
      </ToolbarGroup>
    </div>
  </div>
);
