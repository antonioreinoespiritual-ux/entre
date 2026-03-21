import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const DEFAULT_TYPE_COLORS = {
  problema: { bg: '#fef2f2', border: '#fca5a5', badge: '#991b1b', badgeBg: '#fee2e2' },
  segmento: { bg: '#eff6ff', border: '#93c5fd', badge: '#1d4ed8', badgeBg: '#dbeafe' },
  mensajes: { bg: '#f0fdf4', border: '#86efac', badge: '#166534', badgeBg: '#dcfce7' },
  solucion: { bg: '#fefce8', border: '#fde047', badge: '#854d0e', badgeBg: '#fef9c3' },
  producto: { bg: '#fdf4ff', border: '#d8b4fe', badge: '#6b21a8', badgeBg: '#f3e8ff' },
};

const DEFAULT_STATUS_STYLE = () => ({ label: '', color: '#475569', backgroundColor: '#f1f5f9' });

export function HypothesisMapModal({
  open,
  onClose,
  hypotheses = [],
  title = 'Mapa de hipótesis',
  description = 'Vista de grafo para la jerarquía de hipótesis.',
  getHypothesisId = (hypothesis) => String(hypothesis?.id || '').trim(),
  getHypothesisTitle = (hypothesis) => String(hypothesis?.title || hypothesis?.hypothesis_statement || hypothesis?.id || 'Sin título').trim(),
  getParentId = (hypothesis) => String(hypothesis?.parent_hypothesis_id || '').trim(),
  getType = (hypothesis) => String(hypothesis?.type || '').trim().toLowerCase(),
  getTypeLabel = (value) => value || 'Sin tipo',
  getStatus = () => '',
  getStatusStyle = DEFAULT_STATUS_STYLE,
  getFilterOptions,
  getNodeMetaLabel,
  persistLayout,
  initialLayout = {},
  emptyStateText = 'No hay hipótesis para los filtros aplicados.',
  emptyWorkspaceText = 'No hay hipótesis en este workspace todavía.',
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [layoutById, setLayoutById] = useState({});
  const [draggingNode, setDraggingNode] = useState('');
  const [selectedNode, setSelectedNode] = useState('');
  const [selectedEdge, setSelectedEdge] = useState('');
  const [filterId, setFilterId] = useState('');
  const canvasRef = useRef(null);
  const layoutRef = useRef({});

  useEffect(() => {
    setLayoutById(initialLayout && typeof initialLayout === 'object' ? initialLayout : {});
  }, [initialLayout]);

  useEffect(() => {
    layoutRef.current = layoutById || {};
  }, [layoutById]);

  const normalizedHypotheses = useMemo(() => hypotheses.map((hypothesis) => ({
    raw: hypothesis,
    id: getHypothesisId(hypothesis),
    title: getHypothesisTitle(hypothesis),
    parentId: getParentId(hypothesis),
    type: getType(hypothesis),
    status: getStatus(hypothesis),
  })).filter((hypothesis) => hypothesis.id), [hypotheses, getHypothesisId, getHypothesisTitle, getParentId, getType, getStatus]);

  const hypothesisById = useMemo(() => new Map(normalizedHypotheses.map((hypothesis) => [hypothesis.id, hypothesis])), [normalizedHypotheses]);

  const childHypothesesByParentId = useMemo(() => normalizedHypotheses.reduce((acc, hypothesis) => {
    if (!hypothesis.parentId) return acc;
    const current = acc.get(hypothesis.parentId) || [];
    current.push(hypothesis);
    acc.set(hypothesis.parentId, current);
    return acc;
  }, new Map()), [normalizedHypotheses]);

  const filterOptions = useMemo(() => {
    if (typeof getFilterOptions === 'function') return getFilterOptions(normalizedHypotheses);
    return normalizedHypotheses.filter((hypothesis) => hypothesis.type === 'problema');
  }, [getFilterOptions, normalizedHypotheses]);

  useEffect(() => {
    if (!filterId) return;
    if (!filterOptions.some((option) => option.id === filterId)) setFilterId('');
  }, [filterId, filterOptions]);

  const visibleHypotheses = useMemo(() => {
    if (!filterId) return normalizedHypotheses;
    const visible = new Set([filterId]);
    let current = hypothesisById.get(filterId);
    while (current) {
      if (!current.parentId) break;
      visible.add(current.parentId);
      current = hypothesisById.get(current.parentId);
    }
    const addDescendants = (parentId) => {
      const children = childHypothesesByParentId.get(parentId) || [];
      children.forEach((child) => {
        visible.add(child.id);
        addDescendants(child.id);
      });
    };
    addDescendants(filterId);
    return normalizedHypotheses.filter((hypothesis) => visible.has(hypothesis.id));
  }, [childHypothesesByParentId, filterId, hypothesisById, normalizedHypotheses]);

  const nodes = useMemo(() => visibleHypotheses.map((hypothesis, index) => {
    const saved = layoutById[hypothesis.id] || {};
    const x = Number(saved.x);
    const y = Number(saved.y);
    return {
      ...hypothesis,
      x: Number.isFinite(x) ? x : 120 + ((index % 4) * 300),
      y: Number.isFinite(y) ? y : 80 + (Math.floor(index / 4) * 180),
    };
  }), [layoutById, visibleHypotheses]);

  const visibleIdSet = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const edges = useMemo(() => nodes
    .filter((node) => node.parentId && visibleIdSet.has(node.parentId))
    .map((node) => ({ id: `edge_${node.parentId}_${node.id}`, source: node.parentId, target: node.id })), [nodes, visibleIdSet]);
  const renderableNodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const persistCurrentLayout = (nextLayout) => {
    if (typeof persistLayout === 'function') persistLayout(nextLayout && typeof nextLayout === 'object' ? nextLayout : {});
  };

  const handleNodeMouseDown = (event, id) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingNode(id);
    setSelectedNode(id);
    setSelectedEdge('');
    const startX = event.clientX;
    const startY = event.clientY;
    const start = layoutById[id] || nodes.find((node) => node.id === id) || { x: 0, y: 0 };
    const startNodeX = Number(start.x) || 0;
    const startNodeY = Number(start.y) || 0;
    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / (zoom || 1);
      const deltaY = (moveEvent.clientY - startY) / (zoom || 1);
      setLayoutById((prev) => ({
        ...prev,
        [id]: {
          x: Math.max(12, Math.round(startNodeX + deltaX)),
          y: Math.max(12, Math.round(startNodeY + deltaY)),
        },
      }));
    };
    const onUp = () => {
      setDraggingNode('');
      persistCurrentLayout(layoutRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCanvasMouseDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('[data-hypothesis-map-node="true"]')) return;
    setSelectedNode('');
    setSelectedEdge('');
    setIsPanning(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startPan = { ...pan };
    const onMove = (moveEvent) => {
      setPan({ x: startPan.x + (moveEvent.clientX - startX), y: startPan.y + (moveEvent.clientY - startY) });
    };
    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 p-4">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-600">Hipótesis</label>
            <select className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={filterId} onChange={(e) => setFilterId(e.target.value)}>
              <option value="">Todas</option>
              {filterOptions.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.title || hypothesis.id}</option>)}
            </select>
            <label className="text-xs text-slate-600">Zoom</label>
            <input type="range" min={0.4} max={2} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value) || 1)} />
            <Button className="bg-white border text-slate-700" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>
              Reset
            </Button>
            <Button className="bg-white border text-slate-700" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>

        <div ref={canvasRef} className={`relative h-full overflow-hidden bg-slate-50 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`} onMouseDown={handleCanvasMouseDown}>
          <div className="absolute h-[2200px] w-[2400px] origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="absolute inset-0 h-full w-full">
              {edges.map((edge) => {
                const source = renderableNodesById.get(edge.source);
                const target = renderableNodesById.get(edge.target);
                if (!source || !target) return null;
                const selected = selectedEdge === edge.id;
                return (
                  <line
                    key={edge.id}
                    x1={source.x + 100}
                    y1={source.y + 28}
                    x2={target.x + 100}
                    y2={target.y + 28}
                    stroke={selected ? '#4f46e5' : '#9CA3AF'}
                    strokeWidth={selected ? 2 : 1.5}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedNode('');
                      setSelectedEdge(edge.id);
                    }}
                  />
                );
              })}
            </svg>

            {nodes.map((hypothesis) => {
              const isSelected = selectedNode === hypothesis.id;
              const colors = DEFAULT_TYPE_COLORS[hypothesis.type] || { bg: '#f8fafc', border: '#cbd5e1', badge: '#475569', badgeBg: '#f1f5f9' };
              const parentHypothesis = hypothesisById.get(hypothesis.parentId) || null;
              const childHypothesesForNode = childHypothesesByParentId.get(hypothesis.id) || [];
              const statusStyle = getStatusStyle(hypothesis.raw, hypothesis.status);
              return (
                <div
                  key={hypothesis.id}
                  data-hypothesis-map-node="true"
                  className={`absolute rounded-md border bg-white px-2.5 py-2 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] ${draggingNode === hypothesis.id || isSelected ? 'border-2 border-indigo-500' : ''}`}
                  style={{ left: hypothesis.x, top: hypothesis.y, width: '200px', maxWidth: '200px', borderColor: isSelected ? '#4f46e5' : colors.border, backgroundColor: colors.bg }}
                  onMouseDown={(event) => handleNodeMouseDown(event, hypothesis.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEdge('');
                    setSelectedNode(hypothesis.id);
                  }}
                >
                  <p className="whitespace-normal break-words leading-tight text-slate-900">{hypothesis.title || 'Sin título'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: colors.badge, backgroundColor: colors.badgeBg }}>
                      {getTypeLabel(hypothesis.type)}
                    </span>
                    {statusStyle?.label ? (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: statusStyle.color, backgroundColor: statusStyle.backgroundColor }}>
                        {statusStyle.label}
                      </span>
                    ) : null}
                    <span className="text-[10px] text-slate-500">
                      {childHypothesesForNode.length > 0 ? `${childHypothesesForNode.length} hija${childHypothesesForNode.length !== 1 ? 's' : ''}` : parentHypothesis ? 'hoja' : 'raíz'}
                    </span>
                  </div>
                  {typeof getNodeMetaLabel === 'function' ? <p className="mt-1 text-[10px] text-slate-500">{getNodeMetaLabel(hypothesis.raw, { parentHypothesis: parentHypothesis?.raw || null, childHypotheses: childHypothesesForNode.map((child) => child.raw) })}</p> : null}
                </div>
              );
            })}
          </div>

          {!nodes.length ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg border border-dashed bg-white px-6 py-4 text-sm text-slate-500">{normalizedHypotheses.length ? emptyStateText : emptyWorkspaceText}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default HypothesisMapModal;
