import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, Edit, Gauge, Lightbulb, MoreHorizontal, Network, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';
import { listActiveEvolutionLinksForDestinationMode, markHypothesisEvolutionLinksDeleted } from '@/modules/comments/services/hypothesisEvolutionService';
import HypothesisMapModal from '@/components/hypotheses/HypothesisMapModal';

const initialForm = {
  title: '',
  type: 'problema',
  parent_hypothesis_id: '',
  hypothesis_statement: '',
  variable_x: '',
  metrica_objetivo_y: '',
  umbral_operador: '',
  umbral_tipo: '',
  umbral_valor: 3,
  volumen_minimo: 100,
  volumen_unidad: '',
  canal_principal: 'paid',
  contexto_cualitativo: '',
};

const hypothesisTypeOptions = [
  { value: 'problema', label: 'Problema' },
  { value: 'segmento', label: 'Segmento' },
  { value: 'mensajes', label: 'Mensajes' },
  { value: 'solucion', label: 'Solución' },
  { value: 'producto', label: 'Producto' },
];

const parentTypeByChild = {
  problema: '',
  segmento: 'problema',
  mensajes: 'segmento',
  solucion: 'mensajes',
  producto: 'solucion',
};

const childTypeByParent = {
  problema: 'segmento',
  segmento: 'mensajes',
  mensajes: 'solucion',
  solucion: 'producto',
  producto: '',
};

const hierarchyMetaPrefix = '[hierarchy_meta]';
const hierarchyMetaSuffix = '[/hierarchy_meta]';
const readVideoHypothesisMapLayout = (storageKey = '') => {
  if (!storageKey) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const mergeVideoHypothesisMapLayouts = (baseLayout = {}, incomingLayout = {}) => {
  const base = baseLayout && typeof baseLayout === 'object' ? baseLayout : {};
  const incoming = incomingLayout && typeof incomingLayout === 'object' ? incomingLayout : {};
  return {
    ...base,
    ...incoming,
  };
};

const normalizeHypothesisType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return hypothesisTypeOptions.some((option) => option.value === normalized) ? normalized : '';
};

const hypothesisTypeLabel = (value = '') => hypothesisTypeOptions.find((option) => option.value === normalizeHypothesisType(value))?.label || 'Sin tipo';

const stripHierarchyMetadata = (value = '') => String(value || '').replace(/\s*\[hierarchy_meta\][\s\S]*?\[\/hierarchy_meta\]\s*/g, '').trim();

const extractHierarchyMetadata = (value = '') => {
  const match = String(value || '').match(/\[hierarchy_meta\]([\s\S]*?)\[\/hierarchy_meta\]/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
};

const buildHierarchyContext = (context = '', parentHypothesisId = '') => {
  const clean = stripHierarchyMetadata(context);
  const normalizedParentId = String(parentHypothesisId || '').trim();
  if (!normalizedParentId) return clean;
  const metadata = `${hierarchyMetaPrefix}${JSON.stringify({ parent_hypothesis_id: normalizedParentId })}${hierarchyMetaSuffix}`;
  return [clean, metadata].filter(Boolean).join('\n\n');
};

const getParentHypothesisId = (hypothesis = {}) => String(extractHierarchyMetadata(hypothesis?.contexto_cualitativo || '').parent_hypothesis_id || '').trim();

const extractEvolutionTraceMetadata = (value = '') => {
  const normalized = String(value || '');
  if (!normalized.includes('TRAZABILIDAD DE EVOLUCIÓN')) return {};
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const metadata = {};
  lines.forEach((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) return;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) return;
    metadata[key] = rawValue;
  });
  return metadata;
};

const getHypothesisDisplayTitle = (hypothesis = {}) => {
  const trace = extractEvolutionTraceMetadata(hypothesis?.contexto_cualitativo || '');
  return String(hypothesis?.title || hypothesis?.variable_x || trace.origen_hypothesis_title || hypothesis?.condition || hypothesis?.hypothesis_statement || '').trim();
};

const getEvolutionTraceLabel = (hypothesis = {}, evolutionLink = null) => {
  if (evolutionLink) return 'Evolucionada desde Comentarios';
  const trace = extractEvolutionTraceMetadata(hypothesis?.contexto_cualitativo || '');
  return trace.origen_modo === 'comentarios' ? 'Evolucionada desde Comentarios' : 'Sin evolución trazada';
};

const metricObjectiveOptions = [
  { value: '', label: '-- seleccionar --' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: 'CPC' },
  { value: 'initiate_checkout_rate', label: 'Initiate Checkout Rate' },
  { value: 'view_content_rate', label: 'View Content Rate' },
  { value: 'lead_rate', label: 'Lead Rate' },
  { value: 'purchase_rate', label: 'Purchase Rate' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'views_profile', label: 'Views Profile' },
  { value: 'initiatest', label: 'IniciaTest' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'views', label: 'Views' },
  { value: 'likes', label: 'Likes' },
  { value: 'comments', label: 'Comments' },
  { value: 'shares', label: 'Shares' },
  { value: 'saves', label: 'Saves' },
  { value: 'views_finish_pct', label: 'Views Finish %' },
  { value: 'retencion_pct', label: 'Retention %' },
  { value: 'tiempo_prom_seg', label: 'Avg Watch Time' },
  { value: 'pico_viewers', label: 'Live Peak Viewers' },
  { value: 'viewers_prom', label: 'Live Avg Viewers' },
  { value: 'nuevos_seguidores', label: 'Live New Followers' },
];

const volumeUnits = [
  { value: '', label: '-- unidad --' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: 'CPC' },
  { value: 'initiate_checkout_rate', label: 'Initiate Checkout Rate' },
  { value: 'view_content_rate', label: 'View Content Rate' },
  { value: 'lead_rate', label: 'Lead Rate' },
  { value: 'purchase_rate', label: 'Purchase Rate' },
  { value: 'views', label: 'Views' },
];

const thresholdOperatorOptions = [
  { value: '', label: '-- operador --' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
];

const thresholdTypeOptions = [
  { value: '', label: '-- tipo --' },
  { value: '%', label: '%' },
  { value: 'entero', label: 'entero' },
  { value: 'decimal', label: 'decimal' },
];

const metricLabelMap = new Map(metricObjectiveOptions.map((option) => [option.value, option.label]));

const formatScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(parsed >= 100 || Number.isInteger(parsed) ? 0 : 1) : '—';
};

const scoreTone = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'border-slate-200 bg-slate-100 text-slate-500';
  if (parsed >= 75) return 'border-cyan-400/60 bg-slate-950 text-cyan-300';
  if (parsed >= 55) return 'border-violet-300 bg-violet-50 text-violet-700';
  if (parsed >= 35) return 'border-amber-300 bg-amber-50 text-amber-700';
  return 'border-rose-300 bg-rose-50 text-rose-700';
};


const getHypothesisRawStatus = (hypothesis) => (
  hypothesis?.validation_status
  ?? hypothesis?.status
  ?? hypothesis?.state
  ?? hypothesis?.outcome
  ?? ''
);

const isValidatedStatus = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('no valid') || normalized.includes('invalid') || normalized.includes('fail') || normalized.includes('draft') || normalized.includes('testing') || normalized.includes('in-progress')) {
    return false;
  }
  return normalized.includes('validada') || normalized.includes('validated') || normalized.includes('valid') || normalized.includes('approved') || normalized.includes('passed') || normalized.includes('completed');
};

const inferThresholdType = (hypothesis) => {
  if (String(hypothesis?.condition || '').includes('%')) return '%';
  const value = Number(hypothesis?.umbral_valor ?? 0);
  if (Number.isInteger(value)) return 'entero';
  return 'decimal';
};

const parseThresholdValue = (hypothesis) => {
  const explicit = Number(hypothesis?.umbral_valor);
  if (Number.isFinite(explicit)) return explicit;
  const parsed = String(hypothesis?.condition || '').match(/(>=|<=|>|<)\s*(-?[0-9]+(?:\.[0-9]+)?)/);
  return parsed ? Number(parsed[2]) : 0;
};

const HypothesisFormFields = ({ form, setForm, projectId, availableParents = [], requiredParentType = '', allowedChildType = '' }) => (
  <>
    <div><label className="block text-sm font-medium mb-1">Project ID</label><input disabled className="w-full rounded-lg border p-2 bg-gray-100" value={projectId} /></div>
    <div><label className="block text-sm font-medium mb-1">Título</label><input required className="w-full rounded-lg border p-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
    <div><label className="block text-sm font-medium mb-1">Tipo de hipótesis</label><select required className="w-full rounded-lg border p-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parent_hypothesis_id: '' })}>{hypothesisTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    <div><label className="block text-sm font-medium mb-1">Hipótesis padre</label><select className="w-full rounded-lg border p-2" value={form.parent_hypothesis_id || ''} onChange={(e) => setForm({ ...form, parent_hypothesis_id: e.target.value })} disabled={!requiredParentType}><option value="">{requiredParentType ? 'Sin padre' : 'Este tipo no admite padre'}</option>{availableParents.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.hypothesis_statement || hypothesis.condition || hypothesis.id} · {hypothesisTypeLabel(hypothesis.type)}</option>)}</select><p className="mt-1 text-xs text-gray-500">{requiredParentType ? `Solo puede depender de hipótesis tipo ${hypothesisTypeLabel(requiredParentType).toLowerCase()}.` : 'Las hipótesis de tipo problema no tienen padre.'}</p></div>
    <div className="md:col-span-2 rounded-lg border bg-gray-50 p-3 text-xs text-gray-600">Siguiente capa válida: <span className="font-semibold text-gray-700">{allowedChildType ? hypothesisTypeLabel(allowedChildType) : 'No admite hijas'}</span>.</div>
    <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Hypothesis statement (Si X entonces Y)</label><textarea required className="w-full rounded-lg border p-2" rows="2" value={form.hypothesis_statement} onChange={(e) => setForm({ ...form, hypothesis_statement: e.target.value })} /></div>
    <div><label className="block text-sm font-medium mb-1">Variable X</label><input className="w-full rounded-lg border p-2" value={form.variable_x} onChange={(e) => setForm({ ...form, variable_x: e.target.value })} /></div>
    <div><label className="block text-sm font-medium mb-1">Métrica objetivo Y</label><select required className="w-full rounded-lg border p-2" value={form.metrica_objetivo_y} onChange={(e) => setForm({ ...form, metrica_objetivo_y: e.target.value })}>{metricObjectiveOptions.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select></div>
    <div><label className="block text-sm font-medium mb-1">Umbral validación</label><div className="flex gap-2"><select required className="rounded-lg border p-2" value={form.umbral_operador} onChange={(e) => setForm({ ...form, umbral_operador: e.target.value })}>{thresholdOperatorOptions.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select><input type="number" className="flex-1 rounded-lg border p-2" value={form.umbral_valor} onChange={(e) => setForm({ ...form, umbral_valor: Number(e.target.value) })} /><select required className="rounded-lg border p-2" value={form.umbral_tipo} onChange={(e) => setForm({ ...form, umbral_tipo: e.target.value })}>{thresholdTypeOptions.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select></div></div>
    <div><label className="block text-sm font-medium mb-1">Volumen mínimo</label><div className="flex gap-2"><input type="number" className="flex-1 rounded-lg border p-2" value={form.volumen_minimo} onChange={(e) => setForm({ ...form, volumen_minimo: Number(e.target.value) })} /><select required className="rounded-lg border p-2" value={form.volumen_unidad} onChange={(e) => setForm({ ...form, volumen_unidad: e.target.value })}>{volumeUnits.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}</select></div></div>
    <div><label className="block text-sm font-medium mb-1">Canal principal</label><select className="w-full rounded-lg border p-2" value={form.canal_principal} onChange={(e) => setForm({ ...form, canal_principal: e.target.value })}><option value="paid">paid</option><option value="organic">organic</option><option value="live">live</option></select></div>
    <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Contexto cualitativo</label><textarea className="w-full rounded-lg border p-2" rows="2" value={form.contexto_cualitativo} onChange={(e) => setForm({ ...form, contexto_cualitativo: e.target.value })} /></div>
  </>
);

const HypothesesDashboardPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { hypotheses, fetchHypotheses, createHypothesis, updateHypothesis, deleteHypothesis } = useHypotheses();
  const mapLayoutStorageKey = `video-hypothesis-map-layout:${projectId}:${campaignId}`;
  const [showForm, setShowForm] = useState(false);
  const [editingHypothesisId, setEditingHypothesisId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [editForm, setEditForm] = useState(initialForm);
  const [statusFilter, setStatusFilter] = useState('all');
  const [validationFilter, setValidationFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [hypothesisMenuId, setHypothesisMenuId] = useState('');
  const [activeEvolutionLinksByDestinationId, setActiveEvolutionLinksByDestinationId] = useState(new Map());
  const [deleteEvolutionModal, setDeleteEvolutionModal] = useState({ open: false, hypothesisId: '', deleting: false, error: '', link: null, branchIds: [] });
  const [hypothesisMapOpen, setHypothesisMapOpen] = useState(false);
  const [hypothesisMapLayout, setHypothesisMapLayout] = useState(() => readVideoHypothesisMapLayout(mapLayoutStorageKey));
  const [hypothesisMapSessionSeed, setHypothesisMapSessionSeed] = useState(() => readVideoHypothesisMapLayout(mapLayoutStorageKey));
  const [hypothesisMapSessionVersion, setHypothesisMapSessionVersion] = useState(0);

  useEffect(() => {
    const storedLayout = readVideoHypothesisMapLayout(mapLayoutStorageKey);
    setHypothesisMapLayout(storedLayout);
    if (!hypothesisMapOpen) {
      setHypothesisMapSessionSeed(storedLayout);
    }
  }, [mapLayoutStorageKey, hypothesisMapOpen]);

  const openHypothesisMap = () => {
    const storedLayout = readVideoHypothesisMapLayout(mapLayoutStorageKey);
    const seedLayout = mergeVideoHypothesisMapLayouts(storedLayout, hypothesisMapLayout);
    setHypothesisMapSessionSeed(seedLayout);
    setHypothesisMapSessionVersion((current) => current + 1);
    setHypothesisMapOpen(true);
  };

  const closeHypothesisMap = () => {
    setHypothesisMapOpen(false);
  };

  useEffect(() => {
    fetchHypotheses(campaignId);
  }, [campaignId, fetchHypotheses]);

  const sortedHypotheses = useMemo(() => [...(hypotheses || [])].sort((left, right) => {
    const leftScore = Number(left?.hypothesis_score);
    const rightScore = Number(right?.hypothesis_score);
    const leftHasScore = Number.isFinite(leftScore);
    const rightHasScore = Number.isFinite(rightScore);
    if (leftHasScore && rightHasScore && leftScore !== rightScore) return rightScore - leftScore;
    if (leftHasScore !== rightHasScore) return leftHasScore ? -1 : 1;
    return String(left?.created_at || '').localeCompare(String(right?.created_at || '')) * -1;
  }), [hypotheses]);

  const hypothesisById = useMemo(
    () => new Map(sortedHypotheses.map((hypothesis) => [String(hypothesis.id), hypothesis])),
    [sortedHypotheses],
  );

  const childHypothesesByParentId = useMemo(() => sortedHypotheses.reduce((acc, hypothesis) => {
    const parentId = getParentHypothesisId(hypothesis);
    if (!parentId) return acc;
    const current = acc.get(parentId) || [];
    current.push(hypothesis);
    acc.set(parentId, current);
    return acc;
  }, new Map()), [sortedHypotheses]);

  useEffect(() => {
    let cancelled = false;
    const loadEvolutionLinks = async () => {
      const links = await listActiveEvolutionLinksForDestinationMode({ projectId, campaignId, destinationMode: 'video' });
      if (cancelled) return;
      const next = links.reduce((acc, entry) => {
        const destinationId = String(entry?.link?.destination_hypothesis_id || '').trim();
        if (!destinationId) return acc;
        acc.set(destinationId, entry.link);
        return acc;
      }, new Map());
      setActiveEvolutionLinksByDestinationId(next);
    };
    loadEvolutionLinks();
    return () => { cancelled = true; };
  }, [projectId, campaignId, sortedHypotheses]);

  const collectVideoEvolutionBranchIds = (rootHypothesisId = '') => {
    const pending = [String(rootHypothesisId || '').trim()].filter(Boolean);
    const collected = new Set();
    while (pending.length) {
      const currentId = pending.shift();
      if (!currentId || collected.has(currentId)) continue;
      collected.add(currentId);
      const children = childHypothesesByParentId.get(currentId) || [];
      children.forEach((child) => pending.push(String(child.id || '').trim()));
    }
    return [...collected];
  };

  const openDeleteEvolutionModal = (hypothesis) => {
    const hypothesisId = String(hypothesis?.id || '').trim();
    if (!hypothesisId) return;
    const link = activeEvolutionLinksByDestinationId.get(hypothesisId) || null;
    setHypothesisMenuId('');
    setDeleteEvolutionModal({
      open: true,
      hypothesisId,
      deleting: false,
      error: '',
      link,
      branchIds: collectVideoEvolutionBranchIds(hypothesisId),
    });
  };

  const closeDeleteEvolutionModal = () => setDeleteEvolutionModal({ open: false, hypothesisId: '', deleting: false, error: '', link: null, branchIds: [] });

  const confirmDeleteEvolution = async () => {
    const rootHypothesisId = String(deleteEvolutionModal.hypothesisId || '').trim();
    const link = deleteEvolutionModal.link;
    const branchIds = deleteEvolutionModal.branchIds || [];
    if (!rootHypothesisId || !link || !branchIds.length) return;
    setDeleteEvolutionModal((prev) => ({ ...prev, deleting: true, error: '' }));
    try {
      for (const hypothesisId of [...branchIds].reverse()) {
        const ok = await deleteHypothesis(hypothesisId, campaignId);
        if (!ok) throw new Error('No se pudo eliminar una hipótesis de la rama evolucionada.');
      }
      await markHypothesisEvolutionLinksDeleted({
        projectId,
        campaignId,
        destinationMode: 'video',
        destinationHypothesisIds: branchIds,
        deletionContext: {
          source_mode: 'comments',
          destination_mode: 'video',
          deleted_root_hypothesis_id: rootHypothesisId,
          deleted_branch_ids: branchIds,
        },
      });
      setActiveEvolutionLinksByDestinationId((prev) => {
        const next = new Map(prev);
        branchIds.forEach((hypothesisId) => next.delete(String(hypothesisId)));
        return next;
      });
      closeDeleteEvolutionModal();
    } catch (error) {
      setDeleteEvolutionModal((prev) => ({ ...prev, deleting: false, error: error?.message || 'No se pudo eliminar la evolución.' }));
    }
  };

  const availableStatuses = useMemo(() => {
    const values = new Set();
    sortedHypotheses.forEach((item) => {
      const raw = getHypothesisRawStatus(item);
      if (raw) values.add(String(raw));
    });
    return [...values];
  }, [sortedHypotheses]);

  const filteredHypotheses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return sortedHypotheses.filter((hypothesis) => {
      const rawStatus = getHypothesisRawStatus(hypothesis);
      const validated = isValidatedStatus(rawStatus);

      if (statusFilter !== 'all' && String(rawStatus || '') !== statusFilter) return false;
      if (validationFilter === 'validada' && !validated) return false;
      if (validationFilter === 'no_validada' && validated) return false;

      if (!q) return true;
      const haystack = [
        hypothesisTypeLabel(hypothesis.type),
        hypothesis.hypothesis_statement,
        hypothesis.condition,
        hypothesis.variable_x,
        stripHierarchyMetadata(hypothesis.contexto_cualitativo),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedHypotheses, searchTerm, statusFilter, validationFilter]);

  const createAllowedParents = (currentType, editingId = '') => {
    const requiredParentType = parentTypeByChild[normalizeHypothesisType(currentType)] || '';
    if (!requiredParentType) return [];
    return sortedHypotheses.filter((hypothesis) => String(hypothesis.id) !== String(editingId || '') && normalizeHypothesisType(hypothesis.type) === requiredParentType);
  };

  const buildPayload = (currentForm, options = {}) => {
    const currentType = normalizeHypothesisType(currentForm.type);
    const editingId = String(options.editingId || '');
    if (!currentType || !String(currentForm.title || '').trim() || !currentForm.metrica_objetivo_y || !currentForm.volumen_unidad || !currentForm.umbral_operador || !currentForm.umbral_tipo) {
      return null;
    }
    const parentHypothesisId = String(currentForm.parent_hypothesis_id || '').trim();
    const parentHypothesis = parentHypothesisId ? hypothesisById.get(parentHypothesisId) : null;
    const requiredParentType = parentTypeByChild[currentType] || '';
    if (currentType === 'problema' && parentHypothesisId) return null;
    if (parentHypothesis && normalizeHypothesisType(parentHypothesis.type) !== requiredParentType) return null;
    const currentChildren = childHypothesesByParentId.get(editingId) || [];
    const allowedChildType = childTypeByParent[currentType] || '';
    const invalidChildren = currentChildren.some((child) => normalizeHypothesisType(child.type) !== allowedChildType);
    if ((!allowedChildType && currentChildren.length) || invalidChildren) return null;

    const thresholdSuffix = currentForm.umbral_tipo === '%' ? '%' : '';
    const payload = {
      title: String(currentForm.title || '').trim(),
      type: currentType,
      hypothesis_statement: currentForm.hypothesis_statement,
      variable_x: currentForm.variable_x,
      metrica_objetivo_y: currentForm.metrica_objetivo_y,
      umbral_operador: currentForm.umbral_operador,
      umbral_valor: Number(currentForm.umbral_valor || 0),
      volumen_minimo: Number(currentForm.volumen_minimo || 0),
      volumen_unidad: currentForm.volumen_unidad,
      canal_principal: currentForm.canal_principal,
      contexto_cualitativo: buildHierarchyContext(currentForm.contexto_cualitativo, parentHypothesisId),
      campaign_id: campaignId,
      condition: `${currentForm.metrica_objetivo_y} ${currentForm.umbral_operador} ${currentForm.umbral_valor}${thresholdSuffix}`,
    };
    return payload;
  };

  const onCreate = async (event) => {
    event.preventDefault();
    const payload = buildPayload(form);
    if (!payload) { window.alert('La hipótesis debe respetar la cadena problema → segmento → mensajes → solucion → producto.'); return; }
    const result = await createHypothesis(payload);
    if (result) {
      setForm(initialForm);
      setShowForm(false);
    }
  };

  const startEdit = (hypothesis) => {
    setEditingHypothesisId(hypothesis.id);
    setEditForm({
      ...initialForm,
      ...hypothesis,
      type: normalizeHypothesisType(hypothesis.type) || 'problema',
      parent_hypothesis_id: getParentHypothesisId(hypothesis),
      contexto_cualitativo: stripHierarchyMetadata(hypothesis.contexto_cualitativo),
      umbral_operador: hypothesis.umbral_operador || (String(hypothesis.condition || '').match(/(>=|<=|>|<)/)?.[1] || ''),
      umbral_valor: parseThresholdValue(hypothesis),
      umbral_tipo: inferThresholdType(hypothesis),
    });
  };

  const cancelEdit = () => {
    setEditingHypothesisId(null);
    setEditForm(initialForm);
  };

  const onSaveEdit = async (event) => {
    event.preventDefault();
    if (!editingHypothesisId) return;
    const payload = buildPayload(editForm, { editingId: editingHypothesisId });
    if (!payload) { window.alert('La hipótesis debe respetar la cadena problema → segmento → mensajes → solucion → producto.'); return; }
    const result = await updateHypothesis(editingHypothesisId, payload);
    if (result) {
      cancelEdit();
    }
  };

  return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Hypotheses Dashboard</title></Helmet>
      <div className="max-w-6xl mx-auto">
        <Button onClick={() => navigate(`/campaigns/${campaignId}`)} className="bg-white border text-gray-700 mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver a campaña</Button>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h1 className="text-2xl font-bold">Hypotheses Dashboard</h1>
          <p className="text-gray-600">Crear Experimento (Hipótesis) y gestionar videos dentro del detalle de hipótesis.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2"><Lightbulb className="w-5 h-5 text-purple-600" />Hipótesis</h2>
            <div className="flex items-center gap-2">
              <Button className="bg-white border text-slate-700" onClick={openHypothesisMap}><Network className="w-4 h-4 mr-2" />Mapa de hipótesis</Button>
              <Button className="bg-purple-600 text-white" onClick={() => { setShowForm((v) => !v); cancelEdit(); }}><Plus className="w-4 h-4 mr-2" />Crear hipótesis</Button>
            </div>
          </div>

          {showForm && (
            <form onSubmit={onCreate} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50 mb-6">
              <HypothesisFormFields form={form} setForm={setForm} projectId={projectId} availableParents={createAllowedParents(form.type)} requiredParentType={parentTypeByChild[normalizeHypothesisType(form.type)] || ''} allowedChildType={childTypeByParent[normalizeHypothesisType(form.type)] || ''} />
              <div className="md:col-span-2 flex gap-2"><Button type="submit" className="bg-purple-600 text-white">Guardar hipótesis</Button><Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowForm(false)}>Cancelar</Button></div>
            </form>
          )}


          <div className="mb-4 rounded-xl border bg-gray-50 p-3">
            <div className="grid md:grid-cols-4 gap-2">
              <input
                className="rounded-lg border p-2"
                placeholder="Buscar hipótesis..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <select className="rounded-lg border p-2" value={validationFilter} onChange={(event) => setValidationFilter(event.target.value)}>
                <option value="all">Todas (Validada / No validada)</option>
                <option value="validada">Validada</option>
                <option value="no_validada">No validada</option>
              </select>
              <select className="rounded-lg border p-2" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Estado (todos)</option>
                {availableStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <Button className="bg-gray-200 text-gray-700" onClick={() => { setSearchTerm(''); setValidationFilter('all'); setStatusFilter('all'); }}>Limpiar filtros</Button>
            </div>
          </div>

          {sortedHypotheses.length === 0 ? (

            <div className="text-center py-10 text-gray-500">No hay hipótesis todavía</div>
          ) : filteredHypotheses.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No hay resultados con los filtros aplicados.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredHypotheses.map((hypothesis) => {
                const isEditing = editingHypothesisId === hypothesis.id;
                const metricLabel = metricLabelMap.get(hypothesis.metrica_objetivo_y) || hypothesis.metrica_objetivo_y || '-';
                const parentHypothesis = hypothesisById.get(getParentHypothesisId(hypothesis)) || null;
                const childHypotheses = childHypothesesByParentId.get(String(hypothesis.id)) || [];

                return (
                  <div key={hypothesis.id} className="rounded-xl border bg-gray-50 p-4 hover:border-purple-300">
                    {isEditing ? (
                      <form onSubmit={onSaveEdit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-blue-50 mb-4">
                        <HypothesisFormFields form={editForm} setForm={setEditForm} projectId={projectId} availableParents={createAllowedParents(editForm.type, editingHypothesisId)} requiredParentType={parentTypeByChild[normalizeHypothesisType(editForm.type)] || ''} allowedChildType={childTypeByParent[normalizeHypothesisType(editForm.type)] || ''} />
                        <div className="md:col-span-2 flex gap-2">
                          <Button type="submit" className="bg-blue-600 text-white"><Save className="w-4 h-4 mr-2" />Guardar cambios</Button>
                          <Button type="button" className="bg-gray-200 text-gray-700" onClick={cancelEdit}><X className="w-4 h-4 mr-2" />Cancelar</Button>
                        </div>
                      </form>
                    ) : null}

                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{getHypothesisDisplayTitle(hypothesis) || 'Hipótesis sin título'}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm ${scoreTone(hypothesis.hypothesis_score)}`}>
                            <Gauge className="h-3.5 w-3.5" />
                            Score {formatScore(hypothesis.hypothesis_score)}
                          </span>
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Tipo: {hypothesisTypeLabel(hypothesis.type)}</span>
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">Padre: {parentHypothesis ? hypothesisTypeLabel(parentHypothesis.type) : 'Sin padre'}</span>
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600">Hijas: {childHypotheses.length}</span>
                          {(() => {
                            const evolutionLink = activeEvolutionLinksByDestinationId.get(String(hypothesis.id)) || null;
                            const traced = Boolean(evolutionLink) || getEvolutionTraceLabel(hypothesis, null) === 'Evolucionada desde Comentarios';
                            return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${traced ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{getEvolutionTraceLabel(hypothesis, evolutionLink)}</span>;
                          })()}
                        </div>
                        <p className="mt-3 text-sm font-medium text-slate-700">Problema</p>
                        <p className="text-sm text-gray-700 mt-1">{hypothesis.hypothesis_statement || hypothesis.condition || 'Sin statement'}</p>
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                            <span>Prioridad tecnológica</span>
                            <span>{formatScore(hypothesis.hypothesis_score)}/100</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500 transition-all"
                              style={{ width: `${Math.max(0, Math.min(100, Number(hypothesis.hypothesis_score) || 0))}%` }}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Métrica: {metricLabel}</p>
                        <p className="text-xs text-gray-500 mt-1">Padre jerárquico: {parentHypothesis ? (getHypothesisDisplayTitle(parentHypothesis) || parentHypothesis.id) : 'Sin padre'} · Capa hija permitida: {childTypeByParent[normalizeHypothesisType(hypothesis.type)] ? hypothesisTypeLabel(childTypeByParent[normalizeHypothesisType(hypothesis.type)]) : 'No admite hijas'}</p>
                        {(() => {
                          const rawStatus = getHypothesisRawStatus(hypothesis);
                          const validated = isValidatedStatus(rawStatus);
                          return (
                            <div className="mt-2 flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${validated ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-red-100 text-red-700 border-red-300'}`}>{validated ? 'VALIDADA' : 'NO VALIDADA'}</span>
                              {rawStatus ? <span className="text-xs text-gray-500" title={`Estado original: ${rawStatus}`}>({rawStatus})</span> : null}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex gap-1">
                        <Button className="bg-blue-100 text-blue-700 px-3" onClick={() => startEdit(hypothesis)}><Edit className="w-4 h-4" /></Button>
                        <div className="relative">
                          <Button className="bg-white border text-slate-700 px-3" onClick={() => setHypothesisMenuId((prev) => (prev === String(hypothesis.id) ? '' : String(hypothesis.id)))}><MoreHorizontal className="w-4 h-4" /></Button>
                          {hypothesisMenuId === String(hypothesis.id) ? (
                            <div className="absolute right-0 top-11 z-20 w-48 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                              {activeEvolutionLinksByDestinationId.has(String(hypothesis.id)) ? (
                                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => openDeleteEvolutionModal(hypothesis)}>
                                  <Trash2 className="w-4 h-4" />
                                  Eliminar evolución
                                </button>
                              ) : null}
                              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={async () => { setHypothesisMenuId(''); await deleteHypothesis(hypothesis.id, campaignId); }}>Borrar hipótesis</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-4">
                      <Link to={`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesis.id}`} className="text-sm text-purple-700 hover:underline">Abrir detalle →</Link>
                      <Link
                        to={`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesis.id}/mapa-mental`}
                        className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
                      >
                        <Brain className="w-4 h-4" />Mapa mental
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

        <HypothesisMapModal
          key={`${mapLayoutStorageKey}:${hypothesisMapSessionVersion}`}
          open={hypothesisMapOpen}
          onClose={closeHypothesisMap}
          title="Mapa de hipótesis"
          description="Vista de grafo para la jerarquía de hipótesis del Modo Video."
          hypotheses={sortedHypotheses}
          getHypothesisId={(hypothesis) => String(hypothesis?.id || '').trim()}
          getHypothesisTitle={(hypothesis) => getHypothesisDisplayTitle(hypothesis) || 'Hipótesis sin título'}
          getParentId={(hypothesis) => getParentHypothesisId(hypothesis)}
          getType={(hypothesis) => normalizeHypothesisType(hypothesis?.type)}
          getTypeLabel={(value) => hypothesisTypeLabel(value)}
          getFilterOptions={(items) => items.filter((hypothesis) => hypothesis.type === 'problema')}
          getStatus={(hypothesis) => getHypothesisRawStatus(hypothesis)}
          getStatusStyle={(hypothesis, status) => {
            const validated = isValidatedStatus(status);
            return {
              label: status ? (validated ? 'VALIDADA' : 'NO VALIDADA') : 'SIN ESTADO',
              color: validated ? '#047857' : '#be123c',
              backgroundColor: validated ? '#d1fae5' : '#ffe4e6',
            };
          }}
          getNodeMetaLabel={(hypothesis, { parentHypothesis, childHypotheses }) => `Padre: ${parentHypothesis ? (getHypothesisDisplayTitle(parentHypothesis) || parentHypothesis.id) : 'Sin padre'} · Hijas: ${childHypotheses.length}`}
          initialLayout={hypothesisMapSessionSeed}
          persistLayout={(nextLayout) => {
            const normalizedNextLayout = nextLayout && typeof nextLayout === 'object' ? nextLayout : {};
            setHypothesisMapLayout((previousLayout) => {
              const mergedLayout = mergeVideoHypothesisMapLayouts(previousLayout, normalizedNextLayout);
              try {
                localStorage.setItem(mapLayoutStorageKey, JSON.stringify(mergedLayout));
              } catch {}
              return mergedLayout;
            });
            try {
              const storedLayout = readVideoHypothesisMapLayout(mapLayoutStorageKey);
              const mergedStoredLayout = mergeVideoHypothesisMapLayouts(storedLayout, normalizedNextLayout);
              localStorage.setItem(mapLayoutStorageKey, JSON.stringify(mergedStoredLayout));
            } catch {}
          }}
          emptyStateText="No hay hipótesis para los filtros aplicados."
          emptyWorkspaceText="No hay hipótesis en Modo Video todavía."
        />

        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 ${deleteEvolutionModal.open ? '' : 'pointer-events-none hidden'}`}>
          <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Eliminar evolución</h3>
            <p className="mt-2 text-sm text-slate-600">Se eliminará la hipótesis evolucionada en Modo Video y la rama derivada creada con esa evolución. La hipótesis original del Modo Comentarios permanecerá intacta.</p>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p><span className="font-semibold text-slate-900">Hipótesis origen:</span> {deleteEvolutionModal.link?.source_hypothesis_title || 'Hipótesis de comentarios'}</p>
              <p className="mt-1"><span className="font-semibold text-slate-900">Hipótesis evolucionada:</span> {hypothesisById.get(String(deleteEvolutionModal.hypothesisId || ''))?.hypothesis_statement || deleteEvolutionModal.hypothesisId || '—'}</p>
              <p className="mt-1"><span className="font-semibold text-slate-900">Rama a limpiar:</span> {deleteEvolutionModal.branchIds.length} hipótesis.</p>
              <p className="mt-1 text-xs text-slate-500">No se eliminarán códigos, perfiles ni fragmentos. Solo se limpiará la hipótesis destino y el vínculo activo de evolución.</p>
            </div>
            {deleteEvolutionModal.error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteEvolutionModal.error}</div> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button className="bg-white border text-slate-700" onClick={closeDeleteEvolutionModal} disabled={deleteEvolutionModal.deleting}>Cancelar</Button>
              <Button className="bg-red-600 text-white hover:bg-red-700" onClick={confirmDeleteEvolution} disabled={deleteEvolutionModal.deleting}>
                {deleteEvolutionModal.deleting ? 'Eliminando evolución…' : 'Eliminar evolución'}
              </Button>
            </div>
          </div>
        </div>
    </div>
    </>
  );
};

export default HypothesesDashboardPage;
