import React, { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { motion } from 'framer-motion';
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
  collapsed = false,
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
}) => {
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const isExpanded = useMemo(() => !collapsed || hoverExpanded, [collapsed, hoverExpanded]);
  const tabContentClassName = 'px-2 py-1.5 data-[state=inactive]:hidden';

  return (
    <Tabs.Root
      defaultValue="fragmentos"
      className="sticky top-0 z-40 mb-2 rounded-lg border bg-white/95 shadow-sm backdrop-blur"
      onMouseEnter={() => {
        if (collapsed) setHoverExpanded(true);
      }}
      onMouseLeave={() => {
        if (collapsed) setHoverExpanded(false);
      }}
    >
      <Tabs.List className="flex items-center justify-between border-b bg-slate-50/80 px-1.5 py-1" aria-label="Toolbar ribbon">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
            >
              {triggerLabel[tab]}
            </Tabs.Trigger>
          ))}
        </div>
        {collapsed && !hoverExpanded ? <span className="px-2 text-[11px] text-slate-500">Pasa el mouse para expandir</span> : null}
      </Tabs.List>

      <motion.div
        initial={false}
        animate={{
          height: isExpanded ? 'auto' : 0,
          opacity: isExpanded ? 1 : 0,
        }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ overflow: 'hidden' }}
      >
        <Tabs.Content value="archivo" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={FolderOpen} tooltip="Volver al cloud" label="Volver" onClick={onBackToCloud} />
              <ToolbarButton icon={Download} tooltip="Descargar documento" label="Descargar" onClick={onDownloadDocument} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="fragmentos" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={Scissors} tooltip="Crear fragmento" label="Crear fragmento" onClick={onCreateFragment} disabled={!canCreateFragment} />
              <ToolbarButton icon={Plus} tooltip="Añadir fragmento manual" label="Añadir manual" onClick={onCreateManualFragment} />
              <ToolbarButton icon={FileText} tooltip="Ver fragmentos" label="Ver fragmentos" onClick={onViewFragments} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="codigos" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={Tags} tooltip="Ver códigos" label="Ver códigos" onClick={onViewCodes} />
              <ToolbarButton icon={Link2} tooltip="Vincular código" label="Vincular" onClick={onLinkCode} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="clusters" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={Blocks} tooltip="Ver clusters" label="Ver clusters" onClick={onViewClusters} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="notas" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={StickyNote} tooltip="Crear memo" label="Crear memo" onClick={onCreateMemo} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="vista" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={BookOpenText} tooltip={`Cambiar vista (${viewLabel})`} label="Cambiar vista" onClick={onToggleView} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>

        <Tabs.Content value="analisis" className={tabContentClassName} forceMount hidden={!isExpanded}>
          <div className="flex flex-nowrap items-start overflow-x-auto pb-0.5">
            <ToolbarGroup>
              <ToolbarButton icon={Brain} tooltip="Técnicas de análisis" label="Técnicas" onClick={onActivateAnalysis} />
              <ToolbarDivider />
              <ToolbarButton icon={BarChart3} tooltip="Activar técnicas" label="Activar" onClick={onActivateAnalysis} />
            </ToolbarGroup>
          </div>
        </Tabs.Content>
      </motion.div>
    </Tabs.Root>
  );
};
