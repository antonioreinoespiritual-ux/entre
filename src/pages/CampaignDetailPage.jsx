import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCampaigns } from '@/contexts/CampaignContext';
import { useAudiences } from '@/contexts/AudienceContext';
import { useHypotheses } from '@/contexts/HypothesisContext';

const CampaignDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { fetchCampaignById } = useCampaigns();
  const { audiences, fetchAudiences } = useAudiences();
  const { hypotheses, fetchHypotheses } = useHypotheses();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchCampaignById(id);
      setCampaign(data);
      if (data) {
        await Promise.all([fetchAudiences(data.id), fetchHypotheses(data.id)]);
      }
      setLoading(false);
    };
    load();
  }, [id, fetchCampaignById, fetchAudiences, fetchHypotheses]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50"><div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" /></div>;
  }

  if (!campaign) {
    return <div className="min-h-screen flex items-center justify-center">Campaign not found</div>;
  }

  const audiencesPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/audiences`;
  const hypothesesPath = `/projects/${campaign.project_id}/campaigns/${campaign.id}/hypotheses`;

  return (
    <>
      <Helmet>
        <title>{campaign.name} - Campaign Dashboard</title>
      </Helmet>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-6xl mx-auto p-6">
          <Button onClick={() => navigate(`/projects/${campaign.project_id}`)} className="bg-white text-gray-700 border mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al proyecto
          </Button>

          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h1 className="text-3xl font-bold mb-2">{campaign.name}</h1>
            <p className="text-gray-600">{campaign.description || 'Sin descripción'}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-blue-100">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">Audiences</h2>
              </div>
              <p className="text-gray-600 mb-4">Gestiona audiencias de la campaña. Aquí no se crean videos.</p>
              <p className="text-sm text-gray-500 mb-4">Total: {audiences.length}</p>
              <Link to={audiencesPath} className="text-blue-600 font-medium hover:underline">Abrir Audiences Dashboard →</Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl p-6 border border-purple-100">
              <div className="flex items-center gap-3 mb-4">
                <Lightbulb className="w-6 h-6 text-purple-600" />
                <h2 className="text-xl font-semibold">Hypotheses</h2>
              </div>
              <p className="text-gray-600 mb-4">Gestiona hipótesis y videos por tipo (paid, organic, live).</p>
              <p className="text-sm text-gray-500 mb-4">Total: {hypotheses.length}</p>
              <Link to={hypothesesPath} className="text-purple-600 font-medium hover:underline">Abrir Hypotheses Dashboard →</Link>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CampaignDetailPage;
