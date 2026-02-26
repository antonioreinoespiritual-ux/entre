
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, Trash2, Edit, Eye, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/contexts/ProjectContext';
import ProjectForm from '@/components/ProjectForm';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import BulkVideoUpdateModal from '@/components/BulkVideoUpdateModal';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const { projects, loading, fetchProjects, deleteProject } = useProjects();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { signOut } = useAuth();
  const [editingProject, setEditingProject] = useState(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleEdit = (project) => {
    setEditingProject(project);
    setIsFormOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this project?')) {
      await deleteProject(id);
    }
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingProject(null);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <>
      <Helmet>
        <title>Projects - Campaign Manager</title>
        <meta name="description" content="Manage all your marketing campaigns and projects in one place" />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Projects
                </h1>
                <p className="text-gray-600 mt-2">Manage your marketing campaigns and hypotheses</p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    await signOut();
                    navigate('/login');
                  }}
                  className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Cerrar sesión
                </Button>
                <BulkVideoUpdateModal triggerClassName="bg-slate-900 text-cyan-300 border border-cyan-600 hover:bg-slate-800" />
                <Button
                  onClick={() => setIsFormOpen(true)}
                  className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-lg"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Create New Project
                </Button>
              </div>
            </div>
          </motion.div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
          ) : projects.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white rounded-2xl shadow-xl p-12 text-center"
            >
              <FolderOpen className="w-20 h-20 mx-auto text-gray-300 mb-4" />
              <h3 className="text-2xl font-semibold text-gray-700 mb-2">No projects yet</h3>
              <p className="text-gray-500 mb-6">Create your first project to get started</p>
              <Button
                onClick={() => setIsFormOpen(true)}
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Project
              </Button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project, index) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden border-2 border-gray-100 hover:border-blue-200"
                >
                  <div className="bg-gradient-to-r from-blue-500 to-purple-500 p-4">
                    <h3 className="text-xl font-bold text-white truncate">{project.name}</h3>
                  </div>
                  
                  <div className="p-6">
                    <p className="text-gray-600 mb-4 line-clamp-2 min-h-[3rem]">
                      {project.description || 'No description provided'}
                    </p>

                    <div className="space-y-2 mb-6">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Campaigns:</span>
                        <span className="font-semibold text-blue-600">
                          {project.campaigns?.[0]?.count || 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Created:</span>
                        <span className="font-medium text-gray-700">
                          {formatDate(project.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                      <Button
                        onClick={() => handleEdit(project)}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={() => handleDelete(project.id)}
                        className="bg-red-100 hover:bg-red-200 text-red-600 px-4"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <ProjectForm
          isOpen={isFormOpen}
          onClose={handleCloseForm}
          project={editingProject}
        />
      </div>
    </>
  );
};

export default ProjectsPage;
