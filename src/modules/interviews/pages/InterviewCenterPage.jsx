import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { FormBuilder, createEmptyFormDraft } from '@/modules/interviews/components/FormBuilder';
import { InterviewRunner } from '@/modules/interviews/components/InterviewRunner';
import { EmptyState, InterviewModuleShell, Modal } from '@/modules/interviews/components/InterviewModuleShell';
import { useInterviewCenterData } from '@/modules/interviews/hooks/useInterviewCenterData';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';
import { getLeanScore } from '@/modules/interviews/components/LeanEvaluationPanel';


const profileMarker = `\n\n---INTERVIEW_PROFILE_JSON---\n`;

const emptyClientProfile = {
  demographic: { age: '', gender: '', location: '', marital_status: '', education_level: '', employment_status: '', income_range: '' },
  psychographic: { core_values: '', main_fears: '', main_desires: '', frustrations: '', personality_traits: '' },
  behavioral: { problem_frequency: '', previous_attempts: '', tools_used: '', urgency_level: '' },
};

const parseClientNotes = (notes = '') => {
  const source = String(notes || '');
  const idx = source.indexOf(profileMarker);
  if (idx === -1) return { plainNotes: source, profile: emptyClientProfile };

  const plainNotes = source.slice(0, idx).trimEnd();
  const rawProfile = source.slice(idx + profileMarker.length).trim();
  try {
    const parsed = JSON.parse(rawProfile || '{}');
    return {
      plainNotes,
      profile: {
        demographic: { ...emptyClientProfile.demographic, ...(parsed.demographic || {}) },
        psychographic: { ...emptyClientProfile.psychographic, ...(parsed.psychographic || {}) },
        behavioral: { ...emptyClientProfile.behavioral, ...(parsed.behavioral || {}) },
      },
    };
  } catch {
    return { plainNotes: source, profile: emptyClientProfile };
  }
};

const composeClientNotes = (plainNotes = '', profile = emptyClientProfile) => {
  const cleanNotes = String(plainNotes || '').trimEnd();
  const mergedProfile = {
    demographic: { ...emptyClientProfile.demographic, ...(profile?.demographic || {}) },
    psychographic: { ...emptyClientProfile.psychographic, ...(profile?.psychographic || {}) },
    behavioral: { ...emptyClientProfile.behavioral, ...(profile?.behavioral || {}) },
  };
  return `${cleanNotes}${profileMarker}${JSON.stringify(mergedProfile)}`;
};

const blankClient = { name: '', contact: '', notes: '', audience_id: '', status: 'active', profile: emptyClientProfile };
const blankHypothesis = { title: '', description: '', type: 'exploratoria', status: 'active', audience_id: '' };

const InterviewCenterPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const center = useInterviewCenterData({ projectId, campaignId, toast });
  const { reload } = center;

  const [tab, setTab] = useState('dashboard');
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [clientDraft, setClientDraft] = useState(blankClient);
  const [hypDraft, setHypDraft] = useState(blankHypothesis);
  const [saving, setSaving] = useState(false);
  const [sessionFilter, setSessionFilter] = useState({ audience_id: '', client_id: '', form_id: '', from: '', to: '' });

  const [formEditorOpen, setFormEditorOpen] = useState(false);
  const [formPreview, setFormPreview] = useState(false);
  const [formDraft, setFormDraft] = useState(createEmptyFormDraft());
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [formSaveStatus, setFormSaveStatus] = useState('saved');
  const [formSaveError, setFormSaveError] = useState('');
  const [formsMenuOpenId, setFormsMenuOpenId] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientAudienceFilter, setClientAudienceFilter] = useState('');
  const [clientSort, setClientSort] = useState('last_interview_desc');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [clientActionsMenuId, setClientActionsMenuId] = useState(null);
  const [runInterviewPrefill, setRunInterviewPrefill] = useState({ clientId: null, audienceId: null });
  const [clientNotesDraft, setClientNotesDraft] = useState('');
  const [clientNotesSaveState, setClientNotesSaveState] = useState('idle');

  const saveTimerRef = useRef(null);
  const autosaveSeqRef = useRef(0);
  const lastSavedRef = useRef('');
  const clientNotesTimerRef = useRef(null);

  const formIsDirty = useMemo(() => JSON.stringify(formDraft) !== lastSavedRef.current, [formDraft]);

  useEffect(() => {
    if (!formEditorOpen) return undefined;
    const warn = (event) => {
      if (formSaveStatus === 'dirty' || formSaveStatus === 'saving') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [formEditorOpen, formSaveStatus]);

  useEffect(() => {
    if (!formEditorOpen || !formIsDirty) return;
    setFormSaveStatus('dirty');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const saveSeq = ++autosaveSeqRef.current;
      const snapshot = { ...formDraft, questions: formDraft.questions || [] };
      try {
        setFormSaveStatus('saving');
        setFormSaveError('');
        const saved = snapshot.id
          ? await interviewsModuleApi.updateForm(snapshot.id, snapshot)
          : await interviewsModuleApi.createForm(projectId, campaignId, snapshot);

        if (saveSeq !== autosaveSeqRef.current) return;

        const committed = { ...snapshot, id: saved.id, status: saved.status, updated_at: saved.updated_at };
        setFormDraft((prev) => (saveSeq === autosaveSeqRef.current ? { ...prev, id: saved.id, status: saved.status, updated_at: saved.updated_at } : prev));
        lastSavedRef.current = JSON.stringify(committed);
        setFormSaveStatus('saved');
        await reload();
      } catch (error) {
        if (saveSeq !== autosaveSeqRef.current) return;
        setFormSaveStatus('error');
        setFormSaveError(error.message);
        toast({ title: 'Error guardando formulario', description: error.message, variant: 'destructive' });
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [campaignId, formDraft, formEditorOpen, formIsDirty, projectId, reload, toast]);

  const openCreateForm = () => {
    setTab('forms');
    const draft = createEmptyFormDraft();
    setFormDraft(draft);
    autosaveSeqRef.current += 1;
    lastSavedRef.current = JSON.stringify(draft);
    setFormSaveStatus('dirty');
    setFormSaveError('');
    setFormPreview(false);
    setFormEditorOpen(true);
    setActiveQuestionId(draft.questions[0]?.id || null);
  };

  const openEditForm = (form) => {
    setTab('forms');
    setFormDraft(form);
    autosaveSeqRef.current += 1;
    lastSavedRef.current = JSON.stringify(form);
    setFormSaveStatus('saved');
    setFormSaveError('');
    setFormPreview(false);
    setFormEditorOpen(true);
    setActiveQuestionId(form.questions?.[0]?.id || null);
  };

  const createClient = async (payload) => {
    const created = await interviewsModuleApi.createClient(projectId, campaignId, payload);
    toast({ title: 'Cliente creado' });
    await center.reload();
    return created;
  };

  const openClientEditor = (client, closeProfile = false) => {
    setClientDraft({
      ...blankClient,
      ...client,
      notes: client.plainNotes || '',
      profile: { ...emptyClientProfile, ...(client.profile || {}) },
    });
    if (closeProfile) setSelectedClientId(null);
    setClientModalOpen(true);
  };

  const filteredSessions = useMemo(() => center.sessions.filter((session) => {
    if (sessionFilter.audience_id && String(session.audience_id || '') !== String(sessionFilter.audience_id)) return false;
    if (sessionFilter.client_id && String(session.client_id || '') !== String(sessionFilter.client_id)) return false;
    if (sessionFilter.form_id && String(session.form_id || '') !== String(sessionFilter.form_id)) return false;
    const time = new Date(session.created_at).getTime();
    if (sessionFilter.from && time < new Date(sessionFilter.from).getTime()) return false;
    if (sessionFilter.to && time > (new Date(sessionFilter.to).getTime() + 86400000)) return false;
    return true;
  }), [center.sessions, sessionFilter]);



  const clientRows = useMemo(() => center.clients.map((client) => {
    const interviews = center.sessions.filter((session) => String(session.client_id) === String(client.id));
    const lastInterview = interviews.length ? interviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] : null;
    const { plainNotes, profile } = parseClientNotes(client.notes || '');
    return { ...client, plainNotes, profile, interviewsCount: interviews.length, lastInterview, interviews };
  }), [center.clients, center.sessions]);

  const visibleClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const filtered = clientRows.filter((client) => {
      if (clientAudienceFilter && String(client.audience_id || '') !== String(clientAudienceFilter)) return false;
      if (q && !`${client.name || ''} ${client.contact || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (clientSort === 'last_interview_asc') return new Date(a.lastInterview?.created_at || 0) - new Date(b.lastInterview?.created_at || 0);
      if (clientSort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
      if (clientSort === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''));
      return new Date(b.lastInterview?.created_at || 0) - new Date(a.lastInterview?.created_at || 0);
    });

    return sorted;
  }, [clientRows, clientSearch, clientAudienceFilter, clientSort]);

  const selectedClient = useMemo(() => clientRows.find((client) => String(client.id) === String(selectedClientId)) || null, [clientRows, selectedClientId]);

  useEffect(() => {
    if (!selectedClient) return;
    setClientNotesDraft(selectedClient.plainNotes || '');
    setClientNotesSaveState('idle');
  }, [selectedClient?.id]);

  useEffect(() => {
    if (!selectedClient) return undefined;
    if (clientNotesDraft === (selectedClient.plainNotes || '')) return undefined;

    setClientNotesSaveState('saving');
    if (clientNotesTimerRef.current) clearTimeout(clientNotesTimerRef.current);

    clientNotesTimerRef.current = setTimeout(async () => {
      try {
        await interviewsModuleApi.updateClient(selectedClient.id, { ...selectedClient, notes: composeClientNotes(clientNotesDraft, selectedClient.profile) });
        setClientNotesSaveState('saved');
        await reload();
      } catch {
        setClientNotesSaveState('error');
      }
    }, 600);

    return () => {
      if (clientNotesTimerRef.current) clearTimeout(clientNotesTimerRef.current);
    };
  }, [clientNotesDraft, selectedClient?.id]);

  const selectedClientSummary = useMemo(() => {
    if (!selectedClient) return null;
    const interviews = [...(selectedClient.interviews || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const lastInterview = interviews[0] || null;
    const formsUsed = new Set(interviews.map((session) => String(session.form_id || session.form_title || '')).filter(Boolean)).size;
    return { interviews, total: interviews.length, lastInterview, formsUsed };
  }, [selectedClient]);

  const startInterviewSession = async (payload) => {
    setSaving(true);
    try {
      const created = await interviewsModuleApi.createSession(projectId, campaignId, payload);
      await center.reload();
      return created;
    } finally {
      setSaving(false);
    }
  };

  const autosaveInterviewSession = async (sessionId, payload) => {
    await interviewsModuleApi.updateSession(sessionId, { ...payload, status: 'draft' });
  };

  const completeInterviewSession = async (sessionId, payload) => {
    setSaving(true);
    try {
      const saved = sessionId
        ? await interviewsModuleApi.updateSession(sessionId, { ...payload, status: 'completed' })
        : await interviewsModuleApi.createSession(projectId, campaignId, { ...payload, status: 'completed' });
      toast({ title: 'Entrevista guardada' });
      await center.reload();
      return saved;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Helmet><title>Centro de Entrevistas</title></Helmet>
      <InterviewModuleShell
        projectId={projectId}
        campaignId={campaignId}
        activeTab={tab}
        onTabChange={setTab}
        onOpenRun={() => setRunModalOpen(true)}
        onOpenForm={openCreateForm}
        onOpenClient={() => setClientModalOpen(true)}
      >
        {center.loading && <div className="bg-white border rounded-xl p-6">Cargando...</div>}
        {center.error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">{center.error}</div>}

        {!center.loading && !center.error && tab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-4 gap-3">
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Total clientes</p><p className="text-2xl font-bold">{center.kpis.totalClients}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Total entrevistas</p><p className="text-2xl font-bold">{center.kpis.totalSessions}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Formularios activos</p><p className="text-2xl font-bold">{center.kpis.activeForms}</p></div>
              <div className="bg-white border rounded-xl p-4"><p className="text-sm text-slate-500">Top audiencias</p>{center.kpis.topAudience.map(([name, count]) => <p key={name} className="text-sm">{name}: {count}</p>)}</div>
            </div>
            <div className="bg-white border rounded-xl p-4 space-y-2">
              <h3 className="font-semibold">Últimas entrevistas</h3>
              {center.kpis.recentSessions.length ? center.kpis.recentSessions.map((session) => <button key={session.id} className="w-full text-left border rounded p-2 hover:bg-slate-50" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>{session.client_name} · {session.form_title}</button>) : <p className="text-sm text-slate-500">Todavía no hay entrevistas.</p>}
            </div>
          </div>
        )}

        {!center.loading && !center.error && tab === 'clients' && (
          <div className="space-y-3">
            <div className="bg-white border rounded-2xl p-3 grid md:grid-cols-4 gap-2">
              <input className="border rounded-xl p-2" placeholder="Buscar cliente" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
              <select className="border rounded-xl p-2" value={clientAudienceFilter} onChange={(e) => setClientAudienceFilter(e.target.value)}>
                <option value="">Todas las audiencias</option>
                {center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}
              </select>
              <select className="border rounded-xl p-2" value={clientSort} onChange={(e) => setClientSort(e.target.value)}>
                <option value="last_interview_desc">Última entrevista (reciente)</option>
                <option value="last_interview_asc">Última entrevista (antigua)</option>
                <option value="name_asc">Nombre (A-Z)</option>
                <option value="name_desc">Nombre (Z-A)</option>
              </select>
              <Button className="bg-indigo-600 text-white" onClick={() => setClientModalOpen(true)}>Crear cliente</Button>
            </div>

            {!visibleClients.length ? <EmptyState title="No hay clientes" description="Crea tu primer cliente para iniciar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={() => setClientModalOpen(true)}>Crear cliente</Button>} /> : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-visible">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
                  <p className="col-span-3">Cliente</p>
                  <p className="col-span-2">Audiencia</p>
                  <p className="col-span-2">Contacto</p>
                  <p className="col-span-2">Entrevistas</p>
                  <p className="col-span-2">Última entrevista</p>
                  <p className="col-span-1 text-right">Acciones</p>
                </div>
                {visibleClients.map((client) => (
                  <div
                    key={client.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedClientId(client.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedClientId(client.id); } }}
                    className={`group relative grid grid-cols-12 gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-200 transition-all duration-150 cursor-pointer ${clientActionsMenuId === client.id ? 'z-20' : ''}`}
                  >
                    <div className="col-span-3 min-w-0">
                      <p className="text-[15px] font-semibold text-slate-900 truncate">{client.name}</p>
                    </div>
                    <div className="col-span-2"><span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{client.audience_name || 'Sin audiencia'}</span></div>
                    <div className="col-span-2"><span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">{client.contact || 'Sin contacto'}</span></div>
                    <div className="col-span-2"><span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{client.interviewsCount} entrevistas</span></div>
                    <p className="col-span-2 text-sm text-slate-500">{client.lastInterview ? new Date(client.lastInterview.created_at).toLocaleDateString() : '—'}</p>

                    <div className="col-span-1 relative flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <Button className="bg-white border" title="Acciones" onClick={() => setClientActionsMenuId((prev) => (prev === client.id ? null : client.id))}>⋮</Button>
                      {clientActionsMenuId === client.id && (
                        <div className="absolute right-0 top-10 z-30 w-44 bg-white border rounded-xl shadow-md p-1">
                          <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { openClientEditor(client); setClientActionsMenuId(null); }}>Editar</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { setRunInterviewPrefill({ clientId: client.id, audienceId: client.audience_id || null }); setRunModalOpen(true); setClientActionsMenuId(null); }}>Entrevistar</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded text-amber-700 hover:bg-amber-50" onClick={() => { center.runMutation(() => interviewsModuleApi.updateClient(client.id, { ...client, status: client.status === 'archived' ? 'active' : 'archived' }), client.status === 'archived' ? 'Cliente reactivado' : 'Cliente archivado'); setClientActionsMenuId(null); }}>{client.status === 'archived' ? 'Reactivar' : 'Archivar'}</button>
                          <button className="w-full text-left text-sm px-3 py-2 rounded text-red-700 hover:bg-red-50" onClick={() => { center.runMutation(() => interviewsModuleApi.deleteClient(client.id), 'Cliente eliminado'); setClientActionsMenuId(null); }}>Borrar</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!center.loading && !center.error && tab === 'forms' && (
          <div className="space-y-3">
            {formEditorOpen ? (
              <FormBuilder
                draft={formDraft}
                setDraft={setFormDraft}
                activeQuestionId={activeQuestionId}
                setActiveQuestionId={setActiveQuestionId}
                onSave={async () => {
                  setFormSaveStatus('saving');
                  const snapshot = { ...formDraft, questions: formDraft.questions || [] };
                  try {
                    const saved = snapshot.id
                      ? await interviewsModuleApi.updateForm(snapshot.id, snapshot)
                      : await interviewsModuleApi.createForm(projectId, campaignId, snapshot);
                    const committed = { ...snapshot, id: saved.id, status: saved.status, updated_at: saved.updated_at };
                    setFormDraft((prev) => ({ ...prev, id: saved.id, status: saved.status, updated_at: saved.updated_at }));
                    lastSavedRef.current = JSON.stringify(committed);
                    autosaveSeqRef.current += 1;
                    setFormSaveStatus('saved');
                    setFormSaveError('');
                    toast({ title: 'Formulario guardado' });
                    await reload();
                  } catch (error) {
                    setFormSaveStatus('error');
                    setFormSaveError(error.message);
                    toast({ title: 'Error', description: error.message, variant: 'destructive' });
                  }
                }}
                onClose={() => {
                  setFormEditorOpen(false);
                  setFormPreview(false);
                  setFormDraft(createEmptyFormDraft());
                  setActiveQuestionId(null);
                  setFormSaveStatus('saved');
                  setFormSaveError('');
                }}
                saveStatus={formSaveStatus}
                saveError={formSaveError}
                preview={formPreview}
                setPreview={setFormPreview}
              />
            ) : (
              <>
                <div className="flex justify-end"><Button className="bg-indigo-600 text-white" onClick={openCreateForm}>Crear formulario</Button></div>
                {!center.forms.length ? <EmptyState title="No hay formularios" description="Crea un formulario para ejecutar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={openCreateForm}>Crear formulario</Button>} /> : (
                  <div className="space-y-2">
                    {center.forms.map((form) => {
                      const isActive = (form.status || 'active') === 'active';
                      const hasDescription = Boolean(form.description?.trim());

                      return (
                        <div
                          key={form.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openEditForm(form)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEditForm(form); } }}
                          className="group bg-white border border-slate-200 rounded-2xl px-4 py-4 transition-all duration-150 hover:border-slate-300 hover:shadow-sm focus-within:ring-2 focus-within:ring-indigo-200"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              <p className="text-sm font-semibold text-slate-900 truncate">{form.title || 'Formulario sin título'}</p>
                              <p className="text-sm text-slate-500 line-clamp-2">{hasDescription ? form.description : 'Sin descripción'}</p>
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">{form.questions?.length || 0} preguntas</span>
                                <span className={`text-xs px-2 py-1 rounded-full border ${isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>{isActive ? 'activo' : 'inactivo'}</span>
                                {!hasDescription && <span className="text-xs px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">sin descripción</span>}
                              </div>
                            </div>

                            <div className="relative shrink-0 flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150" onClick={(event) => event.stopPropagation()}>
                              <Button className="bg-white border" onClick={() => openEditForm(form)}>Editar</Button>
                              <Button className="bg-white border" title="Acciones" onClick={() => setFormsMenuOpenId((prev) => (prev === form.id ? null : form.id))}>⋮</Button>

                              {formsMenuOpenId === form.id && (
                                <div className="absolute right-0 top-10 z-30 w-44 bg-white border rounded-xl shadow-md p-1">
                                  <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={() => { openEditForm(form); setFormsMenuOpenId(null); }}>Editar</button>
                                  <button className="w-full text-left text-sm px-3 py-2 rounded hover:bg-slate-100" onClick={async () => {
                                    const clone = { title: `${form.title} (copia)`, description: form.description, questions: form.questions };
                                    const created = await interviewsModuleApi.createForm(projectId, campaignId, clone);
                                    await reload();
                                    openEditForm(created);
                                    setFormsMenuOpenId(null);
                                    toast({ title: 'Formulario duplicado' });
                                  }}>Duplicar</button>
                                  <button className="w-full text-left text-sm px-3 py-2 rounded text-red-700 hover:bg-red-50" onClick={async () => {
                                    if (!window.confirm('¿Borrar formulario?')) return;
                                    await center.runMutation(() => interviewsModuleApi.deleteForm(form.id), 'Formulario eliminado');
                                    setFormsMenuOpenId(null);
                                  }}>Borrar</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!center.loading && !center.error && tab === 'hypotheses' && (
          <div className="space-y-2">
            <div className="bg-white border rounded-xl p-4 grid md:grid-cols-5 gap-2">
              <input className="border rounded p-2 md:col-span-2" placeholder="Título" value={hypDraft.title} onChange={(e) => setHypDraft((prev) => ({ ...prev, title: e.target.value }))} />
              <select className="border rounded p-2" value={hypDraft.type} onChange={(e) => setHypDraft((prev) => ({ ...prev, type: e.target.value }))}><option value="exploratoria">exploratoria</option><option value="validacion">validacion</option></select>
              <select className="border rounded p-2" value={hypDraft.audience_id} onChange={(e) => setHypDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia (opcional)</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
              <Button className="bg-indigo-600 text-white" onClick={() => center.runMutation(() => interviewsModuleApi.createHypothesis(projectId, campaignId, hypDraft), 'Hipótesis creada')}>Guardar</Button>
              <textarea className="border rounded p-2 md:col-span-5" rows={2} placeholder="Descripción" value={hypDraft.description} onChange={(e) => setHypDraft((prev) => ({ ...prev, description: e.target.value }))} />
            </div>
            {center.hypotheses.map((hypothesis) => (
              <div key={hypothesis.id} className="bg-white border rounded-xl p-4 flex justify-between">
                <div>
                  <p className="font-semibold">{hypothesis.title}</p>
                  <p className="text-sm text-slate-500">{hypothesis.type} · {hypothesis.status || 'active'} · {hypothesis.audience_name || 'Sin audiencia'}</p>
                </div>
                <Button className="bg-red-50 border text-red-700" onClick={() => center.runMutation(() => interviewsModuleApi.deleteHypothesis(hypothesis.id), 'Hipótesis eliminada')}>Borrar</Button>
              </div>
            ))}
          </div>
        )}

        {!center.loading && !center.error && tab === 'sessions' && (
          <div className="space-y-3">
            <div className="bg-white border rounded-xl p-3 grid md:grid-cols-5 gap-2">
              <select className="border rounded p-2" value={sessionFilter.audience_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Audiencia</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.client_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, client_id: e.target.value }))}><option value="">Cliente</option>{center.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.form_id} onChange={(e) => setSessionFilter((prev) => ({ ...prev, form_id: e.target.value }))}><option value="">Formulario</option>{center.forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}</select>
              <input className="border rounded p-2" type="date" value={sessionFilter.from} onChange={(e) => setSessionFilter((prev) => ({ ...prev, from: e.target.value }))} />
              <input className="border rounded p-2" type="date" value={sessionFilter.to} onChange={(e) => setSessionFilter((prev) => ({ ...prev, to: e.target.value }))} />
            </div>
            {!filteredSessions.length ? <EmptyState title="No hay entrevistas" description="Inicia una entrevista para ver sesiones aquí." action={<Button className="bg-indigo-600 text-white" onClick={() => setRunModalOpen(true)}>Realizar entrevista</Button>} /> : filteredSessions.map((session) => {
              const leanScore = getLeanScore(session.responses_json?.__lean_evaluation || {});
              return (
                <button key={session.id} className="w-full bg-white border rounded-xl p-3 text-left hover:bg-slate-50" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{session.client_name} · {session.form_title}</p>
                    {leanScore != null && <span className="text-xs px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">Lean {leanScore}</span>}
                  </div>
                  <p className="text-xs text-slate-500">{session.audience_name || 'Sin audiencia'} · {new Date(session.created_at).toLocaleString()}</p>
                </button>
              );
            })}
          </div>
        )}
      </InterviewModuleShell>

      <Modal title={clientDraft?.id ? 'Editar cliente' : 'Crear cliente'} open={clientModalOpen} onClose={() => { setClientModalOpen(false); setClientDraft(blankClient); }}>
        <div className="space-y-4">
          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Información básica</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="border rounded p-2" placeholder="Nombre" value={clientDraft.name || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, name: e.target.value }))} />
              <input className="border rounded p-2" placeholder="Contacto" value={clientDraft.contact || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, contact: e.target.value }))} />
              <select className="border rounded p-2 md:col-span-2" value={clientDraft.audience_id || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Sin audiencia</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
            </div>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación demográfica</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="border rounded p-2" placeholder="Edad" value={clientDraft.profile?.demographic?.age || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, age: e.target.value } } }))} />
              <select className="border rounded p-2" value={clientDraft.profile?.demographic?.gender || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, gender: e.target.value } } }))}><option value="">Género</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option><option value="no_binario">No binario</option><option value="prefiero_no_decir">Prefiero no decir</option></select>
              <input className="border rounded p-2" placeholder="Ubicación" value={clientDraft.profile?.demographic?.location || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, location: e.target.value } } }))} />
              <select className="border rounded p-2" value={clientDraft.profile?.demographic?.marital_status || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, marital_status: e.target.value } } }))}><option value="">Estado civil</option><option value="soltero">Soltero/a</option><option value="casado">Casado/a</option><option value="union_libre">Unión libre</option><option value="divorciado">Divorciado/a</option></select>
              <input className="border rounded p-2" placeholder="Nivel educativo" value={clientDraft.profile?.demographic?.education_level || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, education_level: e.target.value } } }))} />
              <input className="border rounded p-2" placeholder="Situación laboral" value={clientDraft.profile?.demographic?.employment_status || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, employment_status: e.target.value } } }))} />
              <select className="border rounded p-2 md:col-span-2" value={clientDraft.profile?.demographic?.income_range || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, demographic: { ...prev.profile.demographic, income_range: e.target.value } } }))}><option value="">Nivel de ingresos</option><option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto">Alto</option></select>
            </div>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación psicográfica</h4>
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Valores principales" value={clientDraft.profile?.psychographic?.core_values || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, core_values: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Miedos principales" value={clientDraft.profile?.psychographic?.main_fears || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, main_fears: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Deseos principales" value={clientDraft.profile?.psychographic?.main_desires || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, main_desires: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Frustraciones" value={clientDraft.profile?.psychographic?.frustrations || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, frustrations: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Rasgos de personalidad percibidos" value={clientDraft.profile?.psychographic?.personality_traits || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, psychographic: { ...prev.profile.psychographic, personality_traits: e.target.value } } }))} />
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Segmentación conductual</h4>
            <select className="border rounded p-2 w-full" value={clientDraft.profile?.behavioral?.problem_frequency || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, problem_frequency: e.target.value } } }))}><option value="">Frecuencia del problema</option><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Intentos previos de solución" value={clientDraft.profile?.behavioral?.previous_attempts || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, previous_attempts: e.target.value } } }))} />
            <textarea className="border rounded p-2 w-full" rows={2} placeholder="Herramientas utilizadas" value={clientDraft.profile?.behavioral?.tools_used || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, tools_used: e.target.value } } }))} />
            <select className="border rounded p-2 w-full" value={clientDraft.profile?.behavioral?.urgency_level || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, profile: { ...prev.profile, behavioral: { ...prev.profile.behavioral, urgency_level: e.target.value } } }))}><option value="">Nivel de urgencia</option><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
          </section>

          <section className="border rounded-xl p-4 space-y-2">
            <h4 className="font-semibold">Notas</h4>
            <textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas generales" value={clientDraft.notes || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, notes: e.target.value }))} />
          </section>

          <Button className="bg-indigo-600 text-white" onClick={async () => {
            const payload = {
              ...clientDraft,
              notes: composeClientNotes(clientDraft.notes, clientDraft.profile),
            };
            if (clientDraft.id) {
              await center.runMutation(() => interviewsModuleApi.updateClient(clientDraft.id, payload), 'Cliente actualizado');
              setSelectedClientId(clientDraft.id);
            } else {
              const created = await createClient(payload);
              setSelectedClientId(created.id);
            }
            setClientDraft(blankClient);
            setClientModalOpen(false);
          }}>Guardar cliente</Button>
        </div>
      </Modal>

      <Modal title={selectedClient ? `Cliente · ${selectedClient.name}` : 'Cliente'} open={Boolean(selectedClient)} onClose={() => setSelectedClientId(null)}>
        {selectedClient && (
          <div className="space-y-4">
            <div className="border rounded-xl p-4 bg-slate-50/60">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">{selectedClient.name}</h3>
              <p className="text-sm text-slate-600">Audiencia: <b>{selectedClient.audience_name || 'Sin audiencia'}</b> · Contacto: <b>{selectedClient.contact || '—'}</b></p>
              <div className="grid md:grid-cols-3 gap-2 mt-3">
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Total entrevistas</p><p className="text-lg font-semibold">{selectedClientSummary?.total || 0}</p></div>
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Última entrevista</p><p className="text-sm font-medium">{selectedClientSummary?.lastInterview ? new Date(selectedClientSummary.lastInterview.created_at).toLocaleString() : 'Sin entrevistas'}</p></div>
                <div className="bg-white border rounded-lg p-3"><p className="text-xs text-slate-500">Formularios usados</p><p className="text-lg font-semibold">{selectedClientSummary?.formsUsed || 0}</p></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button className="bg-white border" onClick={() => openClientEditor(selectedClient, true)}>Editar cliente</Button>
                <Button className="bg-indigo-600 text-white" onClick={() => { setRunInterviewPrefill({ clientId: selectedClient.id, audienceId: selectedClient.audience_id || null }); setRunModalOpen(true); }}>Iniciar entrevista</Button>
                <Button className="bg-amber-50 border text-amber-700" onClick={() => center.runMutation(() => interviewsModuleApi.updateClient(selectedClient.id, { ...selectedClient, status: selectedClient.status === 'archived' ? 'active' : 'archived' }), selectedClient.status === 'archived' ? 'Cliente reactivado' : 'Cliente archivado')}>{selectedClient.status === 'archived' ? 'Reactivar' : 'Archivar'}</Button>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold tracking-tight">Notas globales</p>
                <p className={`text-xs ${clientNotesSaveState === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{clientNotesSaveState === 'saving' ? 'Guardando…' : clientNotesSaveState === 'saved' ? 'Guardado' : clientNotesSaveState === 'error' ? 'Error al guardar' : ''}</p>
              </div>
              <textarea className="border rounded-lg p-2 w-full" rows={4} value={clientNotesDraft} onChange={(e) => setClientNotesDraft(e.target.value)} placeholder="Notas acumuladas del cliente" />
            </div>
            <div className="bg-white border rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold tracking-tight">Perfil demográfico</p>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <p><b>Edad:</b> {selectedClient.profile?.demographic?.age || '—'}</p>
                <p><b>Género:</b> {selectedClient.profile?.demographic?.gender || '—'}</p>
                <p><b>Ubicación:</b> {selectedClient.profile?.demographic?.location || '—'}</p>
                <p><b>Estado civil:</b> {selectedClient.profile?.demographic?.marital_status || '—'}</p>
                <p><b>Nivel educativo:</b> {selectedClient.profile?.demographic?.education_level || '—'}</p>
                <p><b>Situación laboral:</b> {selectedClient.profile?.demographic?.employment_status || '—'}</p>
                <p><b>Nivel de ingresos:</b> {selectedClient.profile?.demographic?.income_range || '—'}</p>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold tracking-tight">Perfil psicográfico</p>
              <p className="text-sm"><b>Valores:</b> {selectedClient.profile?.psychographic?.core_values || '—'}</p>
              <p className="text-sm"><b>Miedos:</b> {selectedClient.profile?.psychographic?.main_fears || '—'}</p>
              <p className="text-sm"><b>Deseos:</b> {selectedClient.profile?.psychographic?.main_desires || '—'}</p>
              <p className="text-sm"><b>Frustraciones:</b> {selectedClient.profile?.psychographic?.frustrations || '—'}</p>
              <p className="text-sm"><b>Rasgos:</b> {selectedClient.profile?.psychographic?.personality_traits || '—'}</p>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold tracking-tight">Perfil conductual</p>
              <p className="text-sm"><b>Frecuencia del problema:</b> {selectedClient.profile?.behavioral?.problem_frequency || '—'}</p>
              <p className="text-sm"><b>Intentos previos:</b> {selectedClient.profile?.behavioral?.previous_attempts || '—'}</p>
              <p className="text-sm"><b>Herramientas usadas:</b> {selectedClient.profile?.behavioral?.tools_used || '—'}</p>
              <p className="text-sm"><b>Urgencia:</b> {selectedClient.profile?.behavioral?.urgency_level || '—'}</p>
            </div>

            <div className="bg-white border rounded-xl p-4 space-y-4">
              <p className="text-sm font-semibold tracking-tight">Timeline de entrevistas</p>
              {!selectedClientSummary?.interviews.length ? <p className="text-sm text-slate-500">Sin entrevistas todavía.</p> : (
                <div className="space-y-3">
                  {selectedClientSummary.interviews.map((session, index) => (
                    <div key={session.id} className="relative pl-8 py-1">
                      {index < selectedClientSummary.interviews.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-14px] w-px bg-slate-200" />}
                      <div className="absolute left-0 top-1 h-6 w-6 rounded-full border border-indigo-200 bg-indigo-50 flex items-center justify-center text-[10px] text-indigo-700">●</div>
                      <div className="group border rounded-xl p-3 bg-white hover:bg-slate-50 hover:shadow-sm transition-all duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{session.form_title || 'Formulario'}</p>
                            <div className="flex items-center gap-2 mt-1"><p className="text-xs text-slate-500">{new Date(session.created_at).toLocaleString()}</p><span className={`text-[11px] px-2 py-0.5 rounded-full border ${(session.status || 'draft') === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{session.status || 'draft'}</span></div>
                          </div>
                          <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                            <Button className="bg-white border" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Abrir</Button>
                            <Button className="bg-white border" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Editar</Button>
                            {(session.status || 'draft') === 'draft' && <Button className="bg-indigo-600 text-white" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>Continuar</Button>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal title="Realizar entrevista" open={runModalOpen} onClose={() => { setRunModalOpen(false); setRunInterviewPrefill({ clientId: null, audienceId: null }); }}>
        <InterviewRunner
          audiences={center.audiences}
          clients={center.clients}
          forms={center.forms}
          hypotheses={center.hypotheses}
          onCreateClient={createClient}
          onStartInterview={startInterviewSession}
          onAutosave={autosaveInterviewSession}
          onCompleteInterview={completeInterviewSession}
          onViewSession={(id) => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${id}`)}
          initialClientId={runInterviewPrefill.clientId}
          initialAudienceId={runInterviewPrefill.audienceId}
          loading={saving}
        />
      </Modal>
    </>
  );
};

export default InterviewCenterPage;
