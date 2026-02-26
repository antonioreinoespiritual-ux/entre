import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit, Lightbulb, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';

const initialForm = {
  type: '',
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
  { value: '', label: '-- seleccionar --' },
  { value: '__fundacional__', label: '--- Validación Fundacional ---', disabled: true },
  { value: 'Problema', label: 'Problema' },
  { value: 'Cliente / Segmento', label: 'Cliente / Segmento' },
  { value: 'Activación', label: 'Activación' },
  { value: '__solucion__', label: '--- Validación de Solución ---', disabled: true },
  { value: 'Solución', label: 'Solución' },
  { value: 'Valor', label: 'Valor' },
  { value: 'Message-Market Fit', label: 'Message-Market Fit' },
  { value: '__escalamiento__', label: '--- Escalamiento ---', disabled: true },
  { value: 'Acquisition', label: 'Acquisition' },
  { value: 'Retention', label: 'Retention' },
  { value: 'Monetization', label: 'Monetization' },
  { value: 'Channel Fit', label: 'Channel Fit' },
  { value: 'Pricing', label: 'Pricing' },
  { value: 'Funnel Friction', label: 'Funnel Friction' },
  { value: 'Trust / Credibility', label: 'Trust / Credibility' },
];

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

const HypothesisFormFields = ({ form, setForm, projectId }) => (
  <>
    <div><label className="block text-sm font-medium mb-1">Project ID</label><input disabled className="w-full rounded-lg border p-2 bg-gray-100" value={projectId} /></div>
    <div><label className="block text-sm font-medium mb-1">Tipo de hipótesis</label><select required className="w-full rounded-lg border p-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{hypothesisTypeOptions.map((option) => <option key={option.value || option.label} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></div>
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
  const { hypotheses, fetchHypotheses, createHypothesis, updateHypothesis } = useHypotheses();
  const [showForm, setShowForm] = useState(false);
  const [editingHypothesisId, setEditingHypothesisId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [editForm, setEditForm] = useState(initialForm);

  useEffect(() => {
    fetchHypotheses(campaignId);
  }, [campaignId, fetchHypotheses]);

  const sortedHypotheses = useMemo(() => hypotheses || [], [hypotheses]);

  const buildPayload = (currentForm) => {
    if (!currentForm.type || !currentForm.metrica_objetivo_y || !currentForm.volumen_unidad || !currentForm.umbral_operador || !currentForm.umbral_tipo) {
      return null;
    }
    const thresholdSuffix = currentForm.umbral_tipo === '%' ? '%' : '';
    const payload = {
      ...currentForm,
      campaign_id: campaignId,
      condition: `${currentForm.metrica_objetivo_y} ${currentForm.umbral_operador} ${currentForm.umbral_valor}${thresholdSuffix}`,
    };
    delete payload.umbral_tipo;
    return payload;
  };

  const onCreate = async (event) => {
    event.preventDefault();
    const payload = buildPayload(form);
    if (!payload) return;
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
    const payload = buildPayload(editForm);
    if (!payload) return;
    const result = await updateHypothesis(editingHypothesisId, payload);
    if (result) {
      cancelEdit();
    }
  };

  return (
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
            <Button className="bg-purple-600 text-white" onClick={() => { setShowForm((v) => !v); cancelEdit(); }}><Plus className="w-4 h-4 mr-2" />Crear hipótesis</Button>
          </div>

          {showForm && (
            <form onSubmit={onCreate} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50 mb-6">
              <HypothesisFormFields form={form} setForm={setForm} projectId={projectId} />
              <div className="md:col-span-2 flex gap-2"><Button type="submit" className="bg-purple-600 text-white">Guardar hipótesis</Button><Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowForm(false)}>Cancelar</Button></div>
            </form>
          )}

          {sortedHypotheses.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No hay hipótesis todavía</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {sortedHypotheses.map((hypothesis) => {
                const isEditing = editingHypothesisId === hypothesis.id;
                const metricLabel = metricLabelMap.get(hypothesis.metrica_objetivo_y) || hypothesis.metrica_objetivo_y || '-';

                return (
                  <div key={hypothesis.id} className="rounded-xl border bg-gray-50 p-4 hover:border-purple-300">
                    {isEditing ? (
                      <form onSubmit={onSaveEdit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-blue-50 mb-4">
                        <HypothesisFormFields form={editForm} setForm={setEditForm} projectId={projectId} />
                        <div className="md:col-span-2 flex gap-2">
                          <Button type="submit" className="bg-blue-600 text-white"><Save className="w-4 h-4 mr-2" />Guardar cambios</Button>
                          <Button type="button" className="bg-gray-200 text-gray-700" onClick={cancelEdit}><X className="w-4 h-4 mr-2" />Cancelar</Button>
                        </div>
                      </form>
                    ) : null}

                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{hypothesis.type}</h3>
                        <p className="text-sm text-gray-700 mt-1">{hypothesis.hypothesis_statement || hypothesis.condition || 'Sin statement'}</p>
                        <p className="text-xs text-gray-500 mt-2">Métrica: {metricLabel}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button className="bg-blue-100 text-blue-700 px-3" onClick={() => startEdit(hypothesis)}><Edit className="w-4 h-4" /></Button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <Link to={`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesis.id}`} className="text-sm text-purple-700 hover:underline">Abrir detalle →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HypothesesDashboardPage;
