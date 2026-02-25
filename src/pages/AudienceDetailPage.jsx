import React, { useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAudiences } from '@/contexts/AudienceContext';

const AudienceDetailPage = () => {
  const { projectId, campaignId, audienceId } = useParams();
  const navigate = useNavigate();
  const { audiences, fetchAudiences } = useAudiences();

  useEffect(() => {
    fetchAudiences(campaignId);
  }, [campaignId, fetchAudiences]);

  const audience = useMemo(() => audiences.find((item) => item.id === audienceId), [audiences, audienceId]);

  if (!audience) {
    return <div className="min-h-screen flex items-center justify-center">Cargando audiencia...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Audience Detail</title></Helmet>
      <div className="max-w-5xl mx-auto">
        <Button onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/audiences`)} className="bg-white border text-gray-700 mb-4"><ArrowLeft className="w-4 h-4 mr-2" />Volver a audiencias</Button>
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h1 className="text-2xl font-bold">{audience.name}</h1>
          <p className="text-gray-600 mt-2">{audience.description || 'Sin descripción'}</p>
          <p className="text-sm text-gray-500 mt-2">Creado: {audience.created_at || '-'}</p>

          <div className="grid md:grid-cols-3 gap-4 mt-6">
            <section className="rounded-xl border p-4 bg-gray-50"><h2 className="font-semibold mb-2">Contexto</h2><p className="text-sm text-gray-700 whitespace-pre-wrap">{audience.contexto || 'Sin contexto'}</p></section>
            <section className="rounded-xl border p-4 bg-gray-50"><h2 className="font-semibold mb-2">Notas</h2><p className="text-sm text-gray-700 whitespace-pre-wrap">{audience.notas || 'Sin notas'}</p></section>
            <section className="rounded-xl border p-4 bg-gray-50"><h2 className="font-semibold mb-2">Segmentación / targeting</h2><p className="text-sm text-gray-700 whitespace-pre-wrap">{audience.targeting || 'Sin segmentación'}</p></section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudienceDetailPage;
