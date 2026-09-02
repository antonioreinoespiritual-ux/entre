
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, Trash2, Edit, Eye, LogOut, Settings, Puzzle, Youtube, Link2, Unlink, BrainCircuit, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/contexts/ProjectContext';
import ProjectForm from '@/components/ProjectForm';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import BulkVideoUpdateModal from '@/components/BulkVideoUpdateModal';
import { youtubeApi } from '@/services/youtubeApi';
import { accountIntegrationsApi } from '@/services/accountIntegrationsApi';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const { projects, loading, fetchProjects, deleteProject } = useProjects();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { signOut } = useAuth();
  const [editingProject, setEditingProject] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('integrations');
  const [selectedIntegration, setSelectedIntegration] = useState('youtube');
  const [youtubeConfig, setYoutubeConfig] = useState({ loading: false, error: '', data: null, channelPreview: null });
  const [youtubeSettingsDraft, setYoutubeSettingsDraft] = useState({ api_key: '', client_id: '', client_secret: '', redirect_uri: '', scopes: '' });
  const [aiConfig, setAiConfig] = useState({ loading: false, error: '', data: null });
  const [aiSettingsDraft, setAiSettingsDraft] = useState({ provider: 'openai', model: '', api_key: '', base_url: '', organization: '' });
  const [aiConnectionTest, setAiConnectionTest] = useState({ loading: false, result: null });
  const [openClawConfig, setOpenClawConfig] = useState({ loading: false, error: '', data: null });
  const [openClawDraft, setOpenClawDraft] = useState({ endpoint_url: '', workspace_id: '', api_key: '' });

  const aiProviderOptions = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'groq', label: 'Groq' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'ollama', label: 'Ollama' },
    { value: 'custom_compatible_api', label: 'Custom Compatible API' },
  ];

  const suggestedLocalRedirectUri = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'}`.replace(/\/$/, '') + '/api/youtube/auth/callback';

  const isPrivateIpv4Host = (hostname = '') => {
    const parts = String(hostname || '').split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  };

  const redirectUriLooksPrivateIp = (() => {
    try {
      const parsed = new URL(youtubeSettingsDraft.redirect_uri || '');
      return isPrivateIpv4Host(parsed.hostname) && parsed.hostname !== '127.0.0.1';
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const ytState = url.searchParams.get('youtube');
    if (ytState) {
      setSettingsOpen(true);
      setSettingsTab('integrations');
      setSelectedIntegration('youtube');
      const ytReason = url.searchParams.get('reason');
      if (ytState === 'error' && ytReason) {
        setYoutubeConfig((prev) => ({ ...prev, error: decodeURIComponent(ytReason) }));
      }
      loadYouTubeConfig();
      url.searchParams.delete('youtube');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const loadIntegrationsStatus = async () => {
    await Promise.allSettled([loadYouTubeConfig(), loadAiConfig(), loadOpenClawConfig()]);
  };

  const openSettings = async ({ tab = 'integrations', integration = 'youtube' } = {}) => {
    setSettingsOpen(true);
    setSettingsTab(tab);
    setSelectedIntegration(integration);
    if (tab === 'integrations') {
      await loadIntegrationsStatus();
      return;
    }
    if (tab === 'integrations' && integration === 'youtube') await loadYouTubeConfig();
    if (tab === 'integrations' && integration === 'ai') await loadAiConfig();
    if (tab === 'integrations' && integration === 'openclaw') await loadOpenClawConfig();
  };

  const loadYouTubeConfig = async () => {
    try {
      setYoutubeConfig((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await youtubeApi.getConfig();
      setYoutubeConfig((prev) => ({ ...prev, loading: false, data }));
      setYoutubeSettingsDraft({
        api_key: data?.integration?.api_key || '',
        client_id: data?.integration?.client_id || '',
        client_secret: data?.integration?.client_secret || '',
        redirect_uri: data?.integration?.redirect_uri || data?.configuredRedirectUri || data?.redirectUri || '',
        scopes: data?.integration?.scopes || (Array.isArray(data?.scopes) ? data.scopes.join(', ') : ''),
      });
    } catch (error) {
      setYoutubeConfig((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar configuración de YouTube' }));
    }
  };

  const loadAiConfig = async () => {
    try {
      setAiConfig((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await accountIntegrationsApi.getAiConfig();
      setAiConfig((prev) => ({ ...prev, loading: false, data }));
      setAiSettingsDraft({
        provider: data?.integration?.provider || 'openai',
        model: data?.integration?.model || '',
        api_key: data?.integration?.api_key || '',
        base_url: data?.integration?.base_url || '',
        organization: data?.integration?.organization || '',
      });
    } catch (error) {
      setAiConfig((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar configuración de IA' }));
    }
  };

  const saveAiSettings = async () => {
    try {
      setAiConfig((prev) => ({ ...prev, error: '' }));
      const data = await accountIntegrationsApi.saveAiSettings(aiSettingsDraft);
      setAiConfig((prev) => ({ ...prev, data }));
      await loadAiConfig();
    } catch (error) {
      setAiConfig((prev) => ({ ...prev, error: error.message || 'No se pudo guardar configuración de IA' }));
    }
  };

  const testAiConnection = async () => {
    try {
      setAiConnectionTest({ loading: true, result: null });
      const data = await accountIntegrationsApi.testAiSettings(aiSettingsDraft);
      setAiConnectionTest({ loading: false, result: data });
    } catch (error) {
      setAiConnectionTest({ loading: false, result: { ok: false, error: error.message || 'No se pudo probar la conexión con la IA' } });
    }
  };

  const loadOpenClawConfig = async () => {
    try {
      setOpenClawConfig((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await accountIntegrationsApi.getOpenClawConfig();
      setOpenClawConfig((prev) => ({ ...prev, loading: false, data }));
      setOpenClawDraft({
        endpoint_url: data?.integration?.endpoint_url || '',
        workspace_id: data?.integration?.workspace_id || '',
        api_key: data?.integration?.api_key || '',
      });
    } catch (error) {
      setOpenClawConfig((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar configuración de OpenClaw' }));
    }
  };

  const saveOpenClawSettings = async () => {
    try {
      setOpenClawConfig((prev) => ({ ...prev, error: '' }));
      const data = await accountIntegrationsApi.saveOpenClawSettings(openClawDraft);
      setOpenClawConfig((prev) => ({ ...prev, data }));
      await loadOpenClawConfig();
    } catch (error) {
      setOpenClawConfig((prev) => ({ ...prev, error: error.message || 'No se pudo guardar configuración de OpenClaw' }));
    }
  };

  const connectYouTube = async () => {
    try {
      const data = await youtubeApi.startOAuth('/projects');
      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (error) {
      setYoutubeConfig((prev) => ({ ...prev, error: error.message || 'No se pudo iniciar OAuth de YouTube' }));
    }
  };


  const saveYouTubeSettings = async () => {
    try {
      setYoutubeConfig((prev) => ({ ...prev, error: '' }));
      const data = await youtubeApi.saveSettings(youtubeSettingsDraft);
      setYoutubeConfig((prev) => ({ ...prev, data }));
      await loadYouTubeConfig();
    } catch (error) {
      setYoutubeConfig((prev) => ({ ...prev, error: error.message || 'No se pudo guardar la configuración de YouTube' }));
    }
  };

  const disconnectYouTube = async () => {
    try {
      await youtubeApi.disconnect();
      await loadYouTubeConfig();
      setYoutubeConfig((prev) => ({ ...prev, channelPreview: null }));
    } catch (error) {
      setYoutubeConfig((prev) => ({ ...prev, error: error.message || 'No se pudo desconectar YouTube' }));
    }
  };

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'integrations') return;
    loadIntegrationsStatus();
  }, [settingsOpen, settingsTab]);

  const previewChannel = async () => {
    try {
      const data = await youtubeApi.listChannels({ mine: 'true', maxResults: '1', fields: 'items(id,title,subscriberCount,videoCount)' });
      setYoutubeConfig((prev) => ({ ...prev, channelPreview: data.items?.[0] || null, error: '' }));
    } catch (error) {
      setYoutubeConfig((prev) => ({ ...prev, error: error.message || 'No se pudo consultar canal de YouTube' }));
    }
  };

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
                <Button
                  onClick={() => { openSettings({ tab: 'integrations', integration: 'youtube' }); }}
                  className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configuración
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


        {settingsOpen ? (
          <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-3 sm:p-4">
            <div className="min-h-full flex items-start sm:items-center justify-center">
              <div className="w-full max-w-5xl bg-white rounded-2xl border shadow-2xl overflow-hidden h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b bg-white shrink-0">
                <div>
                  <p className="text-xs text-slate-500">Panel de configuración</p>
                  <h3 className="text-xl font-semibold text-slate-900 inline-flex items-center gap-2"><Puzzle className="h-5 w-5 text-indigo-600" /> Configuraciones</h3>
                </div>
                <Button className="bg-white border" onClick={() => setSettingsOpen(false)}>Cerrar</Button>
              </div>

              <div className="bg-slate-50 flex-1 min-h-0 overflow-y-auto">
                <div className="grid md:grid-cols-[220px_1fr] min-h-full">
                  <aside className="border-r bg-white p-3 space-y-2 shrink-0">
                    <button type="button" className={`w-full text-left px-3 py-2 rounded-lg text-sm ${settingsTab === 'general' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'hover:bg-slate-50 text-slate-700 border border-transparent'}`} onClick={() => setSettingsTab('general')}>
                      General
                    </button>
                    <button type="button" className={`w-full text-left px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 ${settingsTab === 'integrations' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'hover:bg-slate-50 text-slate-700 border border-transparent'}`} onClick={() => setSettingsTab('integrations')}>
                      <Puzzle className="h-4 w-4" /> Integraciones
                    </button>
                  </aside>

                  <div className="p-4 md:p-5 space-y-4 min-h-0">
                    {settingsTab === 'general' ? (
                      <div className="rounded-lg border bg-white p-4">
                        <h4 className="text-base font-semibold text-slate-900">General</h4>
                        <p className="mt-1 text-sm text-slate-600">Esta sección está lista para futuras preferencias globales del proyecto. Usa la pestaña <span className="font-medium">Integraciones</span> para gestionar conexiones externas.</p>
                      </div>
                    ) : null}

                    {settingsTab === 'integrations' ? (
                      <>
                        <div>
                          <h4 className="text-base font-semibold text-slate-900">Integraciones</h4>
                          <p className="text-sm text-slate-600">Conecta servicios externos y gestiona credenciales de forma centralizada.</p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <button
                            type="button"
                            className={`rounded-xl border bg-white p-4 text-left transition ${selectedIntegration === 'youtube' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'hover:border-slate-300'}`}
                            onClick={async () => {
                              setSelectedIntegration('youtube');
                              await loadYouTubeConfig();
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-slate-900 inline-flex items-center gap-2"><Youtube className="h-5 w-5 text-red-600" /> YouTube</p>
                                <p className="mt-1 text-xs text-slate-600">API oficial para canal, videos, playlists y comentarios.</p>
                              </div>
                              <span className="text-[11px] rounded-full px-2 py-1 bg-slate-100 text-slate-700">{youtubeConfig.data?.connected ? 'Conectado' : 'Disponible'}</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            className={`rounded-xl border bg-white p-4 text-left transition ${selectedIntegration === 'ai' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'hover:border-slate-300'}`}
                            onClick={async () => {
                              setSelectedIntegration('ai');
                              await loadAiConfig();
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-slate-900 inline-flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-indigo-600" /> Inteligencia Artificial</p>
                                <p className="mt-1 text-xs text-slate-600">Proveedor de IA y modelo base para capacidades del sistema.</p>
                              </div>
                              <span className="text-[11px] rounded-full px-2 py-1 bg-slate-100 text-slate-700">{aiConfig.data?.enabled ? 'Configurado' : 'Disponible'}</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            className={`rounded-xl border bg-white p-4 text-left transition ${selectedIntegration === 'openclaw' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'hover:border-slate-300'}`}
                            onClick={async () => {
                              setSelectedIntegration('openclaw');
                              await loadOpenClawConfig();
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-slate-900 inline-flex items-center gap-2"><Bot className="h-5 w-5 text-emerald-600" /> OpenClaw</p>
                                <p className="mt-1 text-xs text-slate-600">Integración separada para conexión con workspace de OpenClaw.</p>
                              </div>
                              <span className="text-[11px] rounded-full px-2 py-1 bg-slate-100 text-slate-700">{openClawConfig.data?.connected ? 'Conectado' : 'Disponible'}</span>
                            </div>
                          </button>
                        </div>

                        {selectedIntegration === 'youtube' ? (
                          <div className="rounded-xl border p-4 bg-white space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <h4 className="font-semibold text-slate-900 inline-flex items-center gap-2"><Youtube className="h-5 w-5 text-red-600" /> YouTube Data API</h4>
                                <p className="text-xs text-slate-600">Conexión oficial con OAuth 2.0 y API key para lecturas públicas.</p>
                              </div>
                              <div className="text-xs text-slate-600">
                                Estado: {youtubeConfig.data?.connected ? 'Conectado' : 'No conectado'}
                              </div>
                            </div>

                            {youtubeConfig.loading ? <p className="text-sm text-slate-500">Cargando configuración...</p> : null}
                            {youtubeConfig.error ? <p className="text-sm text-rose-600">{youtubeConfig.error}</p> : null}

                            <div className="grid md:grid-cols-2 gap-3">
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">API key (lecturas públicas)</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={youtubeSettingsDraft.api_key} onChange={(e) => setYoutubeSettingsDraft((prev) => ({ ...prev, api_key: e.target.value }))} placeholder="AIza..." />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">OAuth Client ID</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={youtubeSettingsDraft.client_id} onChange={(e) => setYoutubeSettingsDraft((prev) => ({ ...prev, client_id: e.target.value }))} placeholder="xxxxx.apps.googleusercontent.com" />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">OAuth Client Secret</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" type="password" value={youtubeSettingsDraft.client_secret} onChange={(e) => setYoutubeSettingsDraft((prev) => ({ ...prev, client_secret: e.target.value }))} placeholder="GOCSPX-..." />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">Redirect URI</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={youtubeSettingsDraft.redirect_uri} onChange={(e) => setYoutubeSettingsDraft((prev) => ({ ...prev, redirect_uri: e.target.value }))} placeholder="https://tu-app.com/api/youtube/auth/callback" />
                                <p className="mt-2 text-xs text-slate-500">Recomendado local: <button type="button" className="text-indigo-600 hover:underline" onClick={() => setYoutubeSettingsDraft((prev) => ({ ...prev, redirect_uri: suggestedLocalRedirectUri }))}>{suggestedLocalRedirectUri}</button></p>
                                {redirectUriLooksPrivateIp ? (
                                  <p className="mt-1 text-xs text-rose-600">Google OAuth bloquea IPs privadas (ej. 192.168.x.x). Usa <span className="font-semibold">localhost</span> o un dominio HTTPS público registrado en Google Cloud Console.</p>
                                ) : null}
                                {youtubeConfig.data?.redirectUri && youtubeConfig.data?.configuredRedirectUri && youtubeConfig.data.redirectUri !== youtubeConfig.data.configuredRedirectUri ? (
                                  <p className="mt-1 text-xs text-amber-700">URI OAuth efectivo en backend: <span className="font-mono">{youtubeConfig.data.redirectUri}</span></p>
                                ) : null}
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">Scopes (separados por coma)</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={youtubeSettingsDraft.scopes} onChange={(e) => setYoutubeSettingsDraft((prev) => ({ ...prev, scopes: e.target.value }))} placeholder="https://www.googleapis.com/auth/youtube.readonly, https://www.googleapis.com/auth/youtube.force-ssl" />
                              </label>
                              <div className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">Canal conectado</p>
                                <p className="font-medium text-slate-800">{youtubeConfig.data?.channel?.title || '—'}</p>
                                <p className="text-xs text-slate-500">{youtubeConfig.data?.channel?.id || 'Sin canal vinculado'}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button className="bg-indigo-600 text-white" onClick={saveYouTubeSettings}>Guardar configuración</Button>
                              <Button className="bg-indigo-600 text-white" onClick={connectYouTube}><Link2 className="w-4 h-4 mr-2" />Conectar YouTube</Button>
                              <Button className="bg-white border text-slate-700" onClick={previewChannel}><Youtube className="w-4 h-4 mr-2" />Probar canal</Button>
                              <Button className="bg-white border text-rose-700" onClick={disconnectYouTube}><Unlink className="w-4 h-4 mr-2" />Desconectar</Button>
                            </div>

                            {youtubeConfig.channelPreview ? (
                              <div className="rounded-lg border bg-white p-3 text-sm">
                                <p className="font-medium text-slate-800">Vista previa del canal</p>
                                <p className="text-xs text-slate-500">{youtubeConfig.channelPreview.title} · videos: {youtubeConfig.channelPreview.videoCount} · subs: {youtubeConfig.channelPreview.subscriberCount}</p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}


                        {selectedIntegration === 'ai' ? (
                          <div className="rounded-xl border p-4 bg-white space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <h4 className="font-semibold text-slate-900 inline-flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-indigo-600" /> Inteligencia Artificial</h4>
                                <p className="text-xs text-slate-600">Configura un proveedor de IA y el modelo principal asociado.</p>
                              </div>
                              <div className="text-xs text-slate-600">Estado: {aiConfig.data?.enabled ? 'Configurado' : 'No configurado'}</div>
                            </div>

                            {aiConfig.loading ? <p className="text-sm text-slate-500">Cargando configuración...</p> : null}
                            {aiConfig.error ? <p className="text-sm text-rose-600">{aiConfig.error}</p> : null}

                            <div className="grid md:grid-cols-2 gap-3">
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">Proveedor</p>
                                <select className="mt-1 w-full rounded border px-2 py-1.5" value={aiSettingsDraft.provider} onChange={(e) => setAiSettingsDraft((prev) => ({ ...prev, provider: e.target.value }))}>
                                  {aiProviderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">Modelo</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={aiSettingsDraft.model} onChange={(e) => setAiSettingsDraft((prev) => ({ ...prev, model: e.target.value }))} placeholder="gpt-4.1-mini / claude-3-5-sonnet / llama3.1:8b..." />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">API key</p>
                                <input type="password" className="mt-1 w-full rounded border px-2 py-1.5" value={aiSettingsDraft.api_key} onChange={(e) => setAiSettingsDraft((prev) => ({ ...prev, api_key: e.target.value }))} placeholder="sk-..." />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">Base URL (opcional)</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={aiSettingsDraft.base_url} onChange={(e) => setAiSettingsDraft((prev) => ({ ...prev, base_url: e.target.value }))} placeholder="https://api.openai.com/v1" />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">Organization / Workspace (opcional)</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={aiSettingsDraft.organization} onChange={(e) => setAiSettingsDraft((prev) => ({ ...prev, organization: e.target.value }))} placeholder="org_..." />
                              </label>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button className="bg-indigo-600 text-white" onClick={saveAiSettings}>Guardar integración IA</Button>
                              <Button className="bg-white border text-slate-700" onClick={testAiConnection} disabled={aiConnectionTest.loading}>
                                <BrainCircuit className="w-4 h-4 mr-2" />{aiConnectionTest.loading ? 'Probando...' : 'Probar conexión'}
                              </Button>
                              <Button className="bg-white border text-slate-700" onClick={loadAiConfig}>Verificar estado</Button>
                            </div>

                            {aiConnectionTest.result ? (
                              <p className={`text-sm ${aiConnectionTest.result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {aiConnectionTest.result.ok ? aiConnectionTest.result.message : aiConnectionTest.result.error}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {selectedIntegration === 'openclaw' ? (
                          <div className="rounded-xl border p-4 bg-white space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <h4 className="font-semibold text-slate-900 inline-flex items-center gap-2"><Bot className="h-5 w-5 text-emerald-600" /> OpenClaw</h4>
                                <p className="text-xs text-slate-600">Configura la conexión de OpenClaw como integración independiente.</p>
                              </div>
                              <div className="text-xs text-slate-600">Estado: {openClawConfig.data?.connected ? 'Conectado' : 'No conectado'}</div>
                            </div>

                            {openClawConfig.loading ? <p className="text-sm text-slate-500">Cargando configuración...</p> : null}
                            {openClawConfig.error ? <p className="text-sm text-rose-600">{openClawConfig.error}</p> : null}

                            <div className="grid md:grid-cols-2 gap-3">
                              <label className="rounded-lg border bg-white p-3 text-sm md:col-span-2">
                                <p className="text-xs text-slate-500">Endpoint URL</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={openClawDraft.endpoint_url} onChange={(e) => setOpenClawDraft((prev) => ({ ...prev, endpoint_url: e.target.value }))} placeholder="https://api.openclaw.ai" />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">Workspace ID</p>
                                <input className="mt-1 w-full rounded border px-2 py-1.5" value={openClawDraft.workspace_id} onChange={(e) => setOpenClawDraft((prev) => ({ ...prev, workspace_id: e.target.value }))} placeholder="workspace_123" />
                              </label>
                              <label className="rounded-lg border bg-white p-3 text-sm">
                                <p className="text-xs text-slate-500">API key</p>
                                <input type="password" className="mt-1 w-full rounded border px-2 py-1.5" value={openClawDraft.api_key} onChange={(e) => setOpenClawDraft((prev) => ({ ...prev, api_key: e.target.value }))} placeholder="oc_..." />
                              </label>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button className="bg-emerald-600 text-white" onClick={saveOpenClawSettings}>Guardar integración OpenClaw</Button>
                              <Button className="bg-white border text-slate-700" onClick={loadOpenClawConfig}>Verificar estado</Button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        ) : null}

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
