import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAudiences } from '@/contexts/AudienceContext';
import { useCampaigns } from '@/contexts/CampaignContext';

const AudienceDashboardPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { audiences, fetchAudiences, createAudience, deleteAudience } = useAudiences();
  const { fetchCampaignById } = useCampaigns();
  const [campaign, setCampaign] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', contexto: '', notas: '', targeting: '' });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const load = async () => {
      setCampaign(await fetchCampaignById(campaignId));
      await fetchAudiences(campaignId);
    };
    load();
  }, [campaignId, fetchAudiences, fetchCampaignById]);

  const kpis = useMemo(() => ({ total: audiences.length }), [audiences.length]);

  const onCreate = async (event) => {
    event.preventDefault();
    const result = await createAudience({ ...form, campaign_id: campaignId });
    if (result) {
      setForm({ name: '', description: '', contexto: '', notas: '', targeting: '' });
      setShowForm(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Audiences Dashboard</title></Helmet>
      <div className="max-w-6xl mx-auto">
        <Button onClick={() => navigate(`/campaigns/${campaignId}`)} className="bg-white text-gray-700 border mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver a campaña</Button>
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h1 className="text-2xl font-bold">Audiences Dashboard</h1>
          <p className="text-gray-600">Campaña: {campaign?.name || campaignId}</p>
          <div className="mt-3 text-sm text-gray-500">KPIs: {kpis.total} audiencias</div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2"><Users className="w-5 h-5 text-blue-500" />Audiencias</h2>
            <Button className="bg-blue-600 text-white" onClick={() => setShowForm((v) => !v)}><Plus className="w-4 h-4 mr-2" />Crear audiencia</Button>
          </div>

          {showForm && (
            <form onSubmit={onCreate} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 mb-6 bg-blue-50">
              <div><label className="block text-sm font-medium mb-1">Nombre *</label><input className="w-full rounded-lg border p-2" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Descripción</label><input className="w-full rounded-lg border p-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Contexto</label><textarea className="w-full rounded-lg border p-2" rows="2" value={form.contexto} onChange={(e) => setForm({ ...form, contexto: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Notas</label><textarea className="w-full rounded-lg border p-2" rows="2" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Segmentación / targeting</label><textarea className="w-full rounded-lg border p-2" rows="2" value={form.targeting} onChange={(e) => setForm({ ...form, targeting: e.target.value })} /></div>
              <div className="md:col-span-2 flex gap-2"><Button type="submit" className="bg-blue-600 text-white">Guardar audiencia</Button><Button type="button" className="bg-gray-200 text-gray-700" onClick={() => setShowForm(false)}>Cancelar</Button></div>
            </form>
          )}

          {audiences.length === 0 ? (
            <div className="text-center text-gray-500 py-10">No hay audiencias todavía</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {audiences.map((audience) => (
                <div key={audience.id} className="rounded-xl border bg-gray-50 p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <Link className="font-semibold text-blue-700 hover:underline" to={`/projects/${projectId}/campaigns/${campaignId}/audiences/${audience.id}`}>{audience.name}</Link>
                      <p className="text-sm text-gray-600 mt-1">{audience.description || 'Sin descripción'}</p>
                    </div>
                    <Button className="bg-red-100 text-red-700" onClick={() => deleteAudience(audience.id, campaignId)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudienceDashboardPage;
