import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { BarChart3, Blocks, BookOpenText, Brain, Download, FileText, FolderOpen, Link2, Plus, Scissors, StickyNote, Tags } from 'lucide-react';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarDivider } from './ToolbarDivider';
import { ToolbarGroup } from './ToolbarGroup';

const tabs = ['archivo', 'fragmentos', 'codigos', 'clusters', 'notas', 'vista', 'analisis'];

const triggerLabel = {
  archivo: 'Archivo',
  fragmentos: 'Fragmentos',
  codigos: 'Códigos',
  clusters: 'Clusters',
  notas: 'Notas',
  vista: 'Vista',
  analisis: 'Análisis',
};

export const Toolbar = ({
  onBackToCloud,
  onDownloadDocument,
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
  <Tabs.Root defaultValue="fragmentos" className="mb-2 rounded-lg border bg-white">
    <Tabs.List className="flex items-center border-b bg-slate-50/70 px-1.5 py-1" aria-label="Toolbar ribbon">
      {tabs.map((tab) => (
        <Tabs.Trigger
          key={tab}
          value={tab}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          {triggerLabel[tab]}
        </Tabs.Trigger>
      ))}
    </Tabs.List>

    <Tabs.Content value="archivo" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={FolderOpen} tooltip="Volver al cloud" onClick={onBackToCloud} />
          <ToolbarButton icon={Download} tooltip="Descargar documento" onClick={onDownloadDocument} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="fragmentos" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={Scissors} tooltip="Crear fragmento" onClick={onCreateFragment} disabled={!canCreateFragment} />
          <ToolbarButton icon={Plus} tooltip="Añadir fragmento manual" onClick={onCreateManualFragment} />
          <ToolbarButton icon={FileText} tooltip="Ver fragmentos" onClick={onViewFragments} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="codigos" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={Tags} tooltip="Ver códigos" onClick={onViewCodes} />
          <ToolbarButton icon={Link2} tooltip="Vincular código" onClick={onLinkCode} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="clusters" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={Blocks} tooltip="Ver clusters" onClick={onViewClusters} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="notas" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={StickyNote} tooltip="Crear memo" onClick={onCreateMemo} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="vista" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={BookOpenText} tooltip={`Cambiar vista (${viewLabel})`} onClick={onToggleView} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>

    <Tabs.Content value="analisis" className="px-2 py-1.5">
      <div className="flex flex-nowrap items-center overflow-x-auto">
        <ToolbarGroup>
          <ToolbarButton icon={Brain} tooltip="Técnicas de análisis" onClick={onActivateAnalysis} />
          <ToolbarDivider />
          <ToolbarButton icon={BarChart3} tooltip="Activar técnicas" onClick={onActivateAnalysis} />
        </ToolbarGroup>
      </div>
    </Tabs.Content>
  </Tabs.Root>
);
