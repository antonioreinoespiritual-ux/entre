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

const blankClient = { name: '', contact: '', notes: '', audience_id: '' };
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

  const saveTimerRef = useRef(null);
  const lastSavedRef = useRef('');

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
      try {
        setFormSaveStatus('saving');
        setFormSaveError('');
        const payload = { ...formDraft, questions: formDraft.questions || [] };
        const saved = formDraft.id
          ? await interviewsModuleApi.updateForm(formDraft.id, payload)
          : await interviewsModuleApi.createForm(projectId, campaignId, payload);
        setFormDraft(saved);
        lastSavedRef.current = JSON.stringify(saved);
        setFormSaveStatus('saved');
        await reload();
      } catch (error) {
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

  const filteredSessions = useMemo(() => center.sessions.filter((session) => {
    if (sessionFilter.audience_id && String(session.audience_id || '') !== String(sessionFilter.audience_id)) return false;
    if (sessionFilter.client_id && String(session.client_id || '') !== String(sessionFilter.client_id)) return false;
    if (sessionFilter.form_id && String(session.form_id || '') !== String(sessionFilter.form_id)) return false;
    const time = new Date(session.created_at).getTime();
    if (sessionFilter.from && time < new Date(sessionFilter.from).getTime()) return false;
    if (sessionFilter.to && time > (new Date(sessionFilter.to).getTime() + 86400000)) return false;
    return true;
  }), [center.sessions, sessionFilter]);

  const runInterview = async (payload) => {
    setSaving(true);
    try {
      const created = await interviewsModuleApi.createSession(projectId, campaignId, payload);
      toast({ title: 'Entrevista guardada' });
      setRunModalOpen(false);
      await center.reload();
      navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${created.id}`);
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
          <div className="space-y-2">
            {!center.clients.length ? <EmptyState title="No hay clientes" description="Crea tu primer cliente para iniciar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={() => setClientModalOpen(true)}>Crear cliente</Button>} /> : center.clients.map((client) => (
              <div key={client.id} className="bg-white border rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{client.name}</p>
                    <p className="text-sm text-slate-500">{client.contact || 'Sin contacto'} · Audiencia: {client.audience_name || 'Sin audiencia'}</p>
                    <p className="text-sm mt-1">{client.notes || 'Sin notas'}</p>
                    <p className="text-xs text-slate-500 mt-2">Entrevistas del cliente: {center.sessions.filter((session) => String(session.client_id) === String(client.id)).length}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button className="bg-white border" onClick={() => { setClientDraft(client); setClientModalOpen(true); }}>Editar</Button>
                    <Button className="bg-red-50 border text-red-700" onClick={() => center.runMutation(() => interviewsModuleApi.deleteClient(client.id), 'Cliente eliminado')}>Borrar</Button>
                  </div>
                </div>
              </div>
            ))}
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
                  try {
                    const payload = { ...formDraft, questions: formDraft.questions || [] };
                    const saved = formDraft.id
                      ? await interviewsModuleApi.updateForm(formDraft.id, payload)
                      : await interviewsModuleApi.createForm(projectId, campaignId, payload);
                    setFormDraft(saved);
                    lastSavedRef.current = JSON.stringify(saved);
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
                {!center.forms.length ? <EmptyState title="No hay formularios" description="Crea un formulario para ejecutar entrevistas." action={<Button className="bg-indigo-600 text-white" onClick={openCreateForm}>Crear formulario</Button>} /> : center.forms.map((form) => (
                  <div key={form.id} className="bg-white border rounded-xl p-4 flex justify-between gap-3">
                    <div>
                      <p className="font-semibold">{form.title}</p>
                      <p className="text-sm text-slate-500">{form.description || 'Sin descripción'}</p>
                      <p className="text-xs text-slate-500">{form.questions?.length || 0} preguntas · {form.status || 'active'}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button className="bg-white border" onClick={() => openEditForm(form)}>Editar</Button>
                      <Button className="bg-white border" onClick={async () => {
                        const clone = { title: `${form.title} (copia)`, description: form.description, questions: form.questions };
                        const created = await interviewsModuleApi.createForm(projectId, campaignId, clone);
                        await reload();
                        openEditForm(created);
                        toast({ title: 'Formulario duplicado' });
                      }}>Duplicar</Button>
                      <Button className="bg-red-50 border text-red-700" onClick={async () => {
                        if (!window.confirm('¿Borrar formulario?')) return;
                        await center.runMutation(() => interviewsModuleApi.deleteForm(form.id), 'Formulario eliminado');
                      }}>Borrar</Button>
                    </div>
                  </div>
                ))}
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
            {!filteredSessions.length ? <EmptyState title="No hay entrevistas" description="Inicia una entrevista para ver sesiones aquí." action={<Button className="bg-indigo-600 text-white" onClick={() => setRunModalOpen(true)}>Realizar entrevista</Button>} /> : filteredSessions.map((session) => (
              <button key={session.id} className="w-full bg-white border rounded-xl p-3 text-left hover:bg-slate-50" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${session.id}`)}>
                <p className="font-medium">{session.client_name} · {session.form_title}</p>
                <p className="text-xs text-slate-500">{session.audience_name || 'Sin audiencia'} · {new Date(session.created_at).toLocaleString()}</p>
              </button>
            ))}
          </div>
        )}
      </InterviewModuleShell>

      <Modal title={clientDraft?.id ? 'Editar cliente' : 'Crear cliente'} open={clientModalOpen} onClose={() => { setClientModalOpen(false); setClientDraft(blankClient); }}>
        <div className="space-y-2">
          <input className="border rounded p-2 w-full" placeholder="Nombre" value={clientDraft.name || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, name: e.target.value }))} />
          <input className="border rounded p-2 w-full" placeholder="Contacto" value={clientDraft.contact || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, contact: e.target.value }))} />
          <textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={clientDraft.notes || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, notes: e.target.value }))} />
          <select className="border rounded p-2 w-full" value={clientDraft.audience_id || ''} onChange={(e) => setClientDraft((prev) => ({ ...prev, audience_id: e.target.value }))}><option value="">Sin audiencia</option>{center.audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select>
          <Button className="bg-indigo-600 text-white" onClick={async () => {
            if (clientDraft.id) {
              await center.runMutation(() => interviewsModuleApi.updateClient(clientDraft.id, clientDraft), 'Cliente actualizado');
            } else {
              await createClient(clientDraft);
            }
            setClientDraft(blankClient);
            setClientModalOpen(false);
          }}>Guardar cliente</Button>
        </div>
      </Modal>

      <Modal title="Realizar entrevista" open={runModalOpen} onClose={() => setRunModalOpen(false)}>
        <InterviewRunner
          audiences={center.audiences}
          clients={center.clients}
          forms={center.forms}
          hypotheses={center.hypotheses}
          onCreateClient={createClient}
          onSubmit={runInterview}
          loading={saving}
        />
      </Modal>
    </>
  );
};

export default InterviewCenterPage;
