import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHypotheses } from '@/contexts/HypothesisContext';

const initialForm = {
  type: 'Experimento',
  hypothesis_statement: '',
  variable_x: '',
  metrica_objetivo_y: 'views',
  umbral_operador: '>=',
  umbral_valor: 3,
  volumen_minimo: 100,
  volumen_unidad: 'views',
  canal_principal: 'paid',
  contexto_cualitativo: '',
};

const HypothesesDashboardPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { hypotheses, fetchHypotheses, createHypothesis } = useHypotheses();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    fetchHypotheses(campaignId);
  }, [campaignId, fetchHypotheses]);

  const onCreate = async (event) => {
    event.preventDefault();
    const payload = {
      ...form,
      campaign_id: campaignId,
      condition: `${form.metrica_objetivo_y} ${form.umbral_operador} ${form.umbral_valor}`,
    };
    const result = await createHypothesis(payload);
    if (result) {
      setForm(initialForm);
      setShowForm(false);
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
            <Button className="bg-purple-600 text-white" onClick={() => setShowForm((v) => !v)}><Plus className="w-4 h-4 mr-2" />Crear hipótesis</Button>
          </div>

          {showForm && (
            <form onSubmit={onCreate} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50 mb-6">
              <div><label className="block text-sm font-medium mb-1">Project ID</label><input disabled className="w-full rounded-lg border p-2 bg-gray-100" value={projectId} /></div>
              <div><label className="block text-sm font-medium mb-1">Tipo de hipótesis</label><select className="w-full rounded-lg border p-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Experimento</option><option>Problema</option><option>Solución</option></select></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Hypothesis statement (Si X entonces Y)</label><textarea required className="w-full rounded-lg border p-2" rows="2" value={form.hypothesis_statement} onChange={(e) => setForm({ ...form, hypothesis_statement: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Variable X</label><input className="w-full rounded-lg border p-2" value={form.variable_x} onChange={(e) => setForm({ ...form, variable_x: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Métrica objetivo Y</label><select className="w-full rounded-lg border p-2" value={form.metrica_objetivo_y} onChange={(e) => setForm({ ...form, metrica_objetivo_y: e.target.value })}><option value="views">views</option><option value="ctr">ctr</option><option value="clicks">clicks</option><option value="purchase">purchase</option></select></div>
              <div><label className="block text-sm font-medium mb-1">Umbral validación</label><div className="flex gap-2"><select className="rounded-lg border p-2" value={form.umbral_operador} onChange={(e) => setForm({ ...form, umbral_operador: e.target.value })}><option>{'>='}</option><option>{'>'}</option><option>{'<='}</option><option>{'<'}</option></select><input type="number" className="flex-1 rounded-lg border p-2" value={form.umbral_valor} onChange={(e) => setForm({ ...form, umbral_valor: Number(e.target.value) })} /></div></div>
              <div><label className="block text-sm font-medium mb-1">Volumen mínimo</label><div className="flex gap-2"><input type="number" className="flex-1 rounded-lg border p-2" value={form.volumen_minimo} onChange={(e) => setForm({ ...form, volumen_minimo: Number(e.target.value) })} /><select className="rounded-lg border p-2" value={form.volumen_unidad} onChange={(e) => setForm({ ...form, volumen_unidad: e.target.value })}><option value="views">views</option><option value="clicks">clicks</option><option value="sessions">sessions</option></select></div></div>
              <div><label className="block text-sm font-medium mb-1">Canal principal</label><select className="w-full rounded-lg border p-2" value={form.canal_principal} onChange={(e) => setForm({ ...form, canal_principal: e.target.value })}><option value="paid">paid</option><option value="organic">organic</option><option value="live">live</option></select></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Contexto cualitativo</label><textarea className="w-full rounded-lg border p-2" rows="2" value={form.contexto_cualitativo} onChange={(e) => setForm({ ...form, contexto_cualitativo: e.target.value })} /></div>
              <div className="md:col-span-2 flex gap-2"><Button type="submit" className="bg-purple-600 text-white">Guardar hipótesis</Button><Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowForm(false)}>Cancelar</Button></div>
            </form>
          )}

          {hypotheses.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No hay hipótesis todavía</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {hypotheses.map((hypothesis) => (
                <Link key={hypothesis.id} to={`/projects/${projectId}/campaigns/${campaignId}/hypotheses/${hypothesis.id}`} className="block rounded-xl border bg-gray-50 p-4 hover:border-purple-300">
                  <h3 className="font-semibold">{hypothesis.type}</h3>
                  <p className="text-sm text-gray-700 mt-1">{hypothesis.hypothesis_statement || hypothesis.condition || 'Sin statement'}</p>
                  <p className="text-xs text-gray-500 mt-2">Métrica: {hypothesis.metrica_objetivo_y || '-'}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HypothesesDashboardPage;
