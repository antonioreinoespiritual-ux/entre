
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Target, Trash2, Edit, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/contexts/ProjectContext';
import { useCampaigns } from '@/contexts/CampaignContext';

const ProjectDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { fetchProjectById } = useProjects();
  const { createCampaign, deleteCampaign } = useCampaigns();
  
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '' });

  const openInCloud = async () => {
    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'}/api/cloud/locate?targetType=project&targetId=${id}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
    });
    if (response.ok) {
      const json = await response.json();
      navigate(`/cloud/${json.parentId || json.nodeId}`);
    }
  };

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    setLoading(true);
    const data = await fetchProjectById(id);
    setProject(data);
    setLoading(false);
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!newCampaign.name.trim()) return;

    const result = await createCampaign({
      ...newCampaign,
      project_id: id,
    });

    if (result) {
      setNewCampaign({ name: '', description: '' });
      setIsCreating(false);
      loadProject();
    }
  };

  const handleDeleteCampaign = async (campaignId) => {
    if (window.confirm('Are you sure you want to delete this campaign?')) {
      await deleteCampaign(campaignId, id);
      loadProject();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-700">Project not found</h2>
          <Button onClick={() => navigate('/projects')} className="mt-4">
            Go back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{project.name} - Campaign Manager</title>
        <meta name="description" content={`View and manage campaigns for ${project.name}`} />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Button
              onClick={() => navigate('/projects')}
              className="mb-4 bg-white hover:bg-gray-100 text-gray-700 border-2 border-gray-200"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Projects
            </Button>

            <div className="bg-white rounded-2xl shadow-xl p-8">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                {project.name}
              </h1>
              <p className="text-gray-600">{project.description || 'No description'}</p>
              <Button onClick={openInCloud} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white">Abrir en Cloud</Button>
            </div>
          </motion.div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Target className="w-7 h-7 text-blue-500" />
                Campaigns ({project.campaigns?.length || 0})
              </h2>
              <Button
                onClick={() => setIsCreating(!isCreating)}
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Campaign
              </Button>
            </div>

            {isCreating && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                onSubmit={handleCreateCampaign}
                className="mb-6 p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border-2 border-blue-200"
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Campaign Name *
                    </label>
                    <input
                      type="text"
                      value={newCampaign.name}
                      onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-gray-900 placeholder-gray-400"
                      placeholder="Enter campaign name"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={newCampaign.description}
                      onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-gray-900 placeholder-gray-400"
                      placeholder="Enter campaign description"
                      rows="3"
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setNewCampaign({ name: '', description: '' });
                      }}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                    >
                      Create Campaign
                    </Button>
                  </div>
                </div>
              </motion.form>
            )}

            {project.campaigns && project.campaigns.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {project.campaigns.map((campaign, index) => (
                  <motion.div
                    key={campaign.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-6 border-2 border-blue-100 hover:border-blue-300 transition-all"
                  >
                    <h3 className="text-xl font-bold text-gray-800 mb-2">{campaign.name}</h3>
                    <p className="text-gray-600 mb-4 text-sm line-clamp-2">
                      {campaign.description || 'No description'}
                    </p>
                    
                    <div className="space-y-2 mb-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Audiences:</span>
                        <span className="font-semibold text-blue-600">0</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Hypotheses:</span>
                        <span className="font-semibold text-purple-600">0</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => navigate(`/campaigns/${campaign.id}`)}
                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-sm"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      <Button
                        onClick={() => handleDeleteCampaign(campaign.id)}
                        className="bg-red-100 hover:bg-red-200 text-red-600 px-4"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <Target className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No campaigns yet. Create your first campaign!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ProjectDetailPage;
