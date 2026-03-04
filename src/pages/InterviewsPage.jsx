import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, FileText, GripVertical, Lightbulb, MessageSquare, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { interviewsApi } from '@/services/interviewsApi';

const tabs = [
  { key: 'dashboard', label: 'Dashboard', icon: ClipboardList },
  { key: 'clients', label: 'Clientes', icon: Users },
  { key: 'forms', label: 'Formularios', icon: FileText },
  { key: 'hypotheses', label: 'Hipótesis', icon: Lightbulb },
  { key: 'sessions', label: 'Entrevistas', icon: MessageSquare },
];

const emptyClient = { name: '', contact: '', notes: '', audience_id: '' };
const emptyHypothesis = { type: 'exploratoria', title: '', description: '', status: 'active', audience_id: '' };

const qid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `q_${Date.now()}_${Math.random().toString(16).slice(2)}`);

function normalizeQuestion(question, index = 0) {
  return {
    id: String(question?.id || qid()),
    type: ['short_text', 'long_text', 'single_choice', 'multi_choice', 'scale_1_5'].includes(question?.type) ? question.type : 'short_text',
    title: String(question?.title || question?.label || `Pregunta ${index + 1}`),
    description: String(question?.description || ''),
    required: Boolean(question?.required),
    options: Array.isArray(question?.options) ? question.options.map((o) => String(o)) : [],
    placeholder: String(question?.placeholder || ''),
    scale: {
      minLabel: String(question?.scale?.minLabel || ''),
      maxLabel: String(question?.scale?.maxLabel || ''),
    },
    validation: {
      minLength: Number(question?.validation?.minLength || 0) || 0,
      maxLength: Number(question?.validation?.maxLength || 0) || 0,
    },
  };
}

function normalizeForm(form) {
  const raw = Array.isArray(form?.questions_json) ? form.questions_json : [];
  return {
    ...form,
    title: String(form?.title || 'Formulario sin título'),
    description: String(form?.description || ''),
    questions: raw.map(normalizeQuestion),
  };
}

const blankQuestion = () => normalizeQuestion({ type: 'short_text', title: '', required: false, options: [] });

const InterviewsPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);

  const [audiences, setAudiences] = useState([]);
  const [clients, setClients] = useState([]);
  const [forms, setForms] = useState([]);
  const [hypotheses, setHypotheses] = useState([]);
  const [sessions, setSessions] = useState([]);

  const [clientFilter, setClientFilter] = useState({ audience_id: '', q: '' });
  const [sessionFilter, setSessionFilter] = useState({ audience_id: '', client_id: '', form_id: '', hypothesis_id: '', from: '', to: '' });
  const [hypFilter, setHypFilter] = useState({ type: '', status: '', audience_id: '' });

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientDraft, setClientDraft] = useState(emptyClient);
  const [selectedClientId, setSelectedClientId] = useState('');

  const [hypModalOpen, setHypModalOpen] = useState(false);
  const [editingHypothesis, setEditingHypothesis] = useState(null);
  const [hypDraft, setHypDraft] = useState(emptyHypothesis);

  const [sessionDetail, setSessionDetail] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizard, setWizard] = useState({ audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} });

  const [editor, setEditor] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [previewErrors, setPreviewErrors] = useState([]);
  const [dragQuestionId, setDragQuestionId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [auds, cls, frms, hyps, sess] = await Promise.all([
        interviewsApi.listAudiences(campaignId),
        interviewsApi.listClients(projectId, campaignId),
        interviewsApi.listForms(projectId, campaignId),
        interviewsApi.listInterviewHypotheses(projectId, campaignId),
        interviewsApi.listInterviewSessions(projectId, campaignId),
      ]);
      const normalizedForms = frms.map(normalizeForm);
      setAudiences(auds);
      setClients(cls);
      setForms(normalizedForms);
      setHypotheses(hyps);
      setSessions(sess);
      if (editor?.id) {
        const refreshed = normalizedForms.find((f) => String(f.id) === String(editor.id));
        if (refreshed) {
          setEditor((prev) => ({ ...prev, ...refreshed, dirty: prev?.dirty || false }));
        }
      }
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [projectId, campaignId]);

  useEffect(() => {
    if (!editor?.dirty) return undefined;
    const timer = setTimeout(() => {
      saveEditor(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [editor?.title, editor?.description, JSON.stringify(editor?.questions || []), editor?.dirty]);

  const selectedClient = useMemo(() => clients.find((c) => String(c.id) === String(selectedClientId)) || null, [clients, selectedClientId]);
  const selectedClientHistory = useMemo(() => sessions.filter((s) => String(s.client_id) === String(selectedClientId)), [sessions, selectedClientId]);

  const filteredClients = useMemo(() => clients.filter((c) => {
    const byAudience = clientFilter.audience_id ? String(c.audience_id || '') === String(clientFilter.audience_id) : true;
    const q = clientFilter.q.trim().toLowerCase();
    const byQ = !q || String(c.name || '').toLowerCase().includes(q) || String(c.contact || '').toLowerCase().includes(q);
    return byAudience && byQ;
  }), [clients, clientFilter]);

  const filteredHypotheses = useMemo(() => hypotheses.filter((h) => {
    if (hypFilter.type && h.type !== hypFilter.type) return false;
    if (hypFilter.status && h.status !== hypFilter.status) return false;
    if (hypFilter.audience_id && String(h.audience_id || '') !== String(hypFilter.audience_id)) return false;
    return true;
  }), [hypotheses, hypFilter]);

  const filteredSessions = useMemo(() => sessions.filter((s) => {
    if (sessionFilter.audience_id && String(s.audience_id || '') !== String(sessionFilter.audience_id)) return false;
    if (sessionFilter.client_id && String(s.client_id || '') !== String(sessionFilter.client_id)) return false;
    if (sessionFilter.form_id && String(s.form_id || '') !== String(sessionFilter.form_id)) return false;
    if (sessionFilter.hypothesis_id && String(s.interview_hypothesis_id || '') !== String(sessionFilter.hypothesis_id)) return false;
    const date = new Date(s.conducted_at || s.created_at).getTime();
    if (sessionFilter.from && date < new Date(sessionFilter.from).getTime()) return false;
    if (sessionFilter.to && date > new Date(sessionFilter.to).getTime() + 86400000) return false;
    return true;
  }), [sessions, sessionFilter]);

  const dashboard = useMemo(() => {
    const byAudience = new Map();
    sessions.forEach((s) => {
      const key = s.audience_name || 'Sin audiencia';
      byAudience.set(key, (byAudience.get(key) || 0) + 1);
    });
    return {
      totalClients: clients.length,
      totalSessions: sessions.length,
      activeForms: forms.length,
      exploratory: hypotheses.filter((h) => h.type === 'exploratoria').length,
      validation: hypotheses.filter((h) => h.type === 'validación').length,
      topAudiences: [...byAudience.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      latest: [...sessions].sort((a, b) => new Date(b.conducted_at || b.created_at) - new Date(a.conducted_at || a.created_at)).slice(0, 5),
    };
  }, [clients, forms, hypotheses, sessions]);

  const openCreateClient = () => { setEditingClient(null); setClientDraft(emptyClient); setClientModalOpen(true); };
  const openEditClient = (client) => { setEditingClient(client); setClientDraft({ name: client.name || '', contact: client.contact || '', notes: client.notes || '', audience_id: client.audience_id || '' }); setClientModalOpen(true); };

  const saveClient = async () => {
    try {
      if (editingClient) {
        await interviewsApi.updateClient(editingClient.id, clientDraft);
        toast({ title: 'Cliente actualizado' });
      } else {
        await interviewsApi.createClient(projectId, campaignId, clientDraft);
        toast({ title: 'Cliente creado' });
      }
      setClientModalOpen(false);
      await loadData();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const deleteClient = async (client) => {
    if (!window.confirm(`¿Eliminar cliente ${client.name}?`)) return;
    await interviewsApi.deleteClient(client.id);
    toast({ title: 'Cliente eliminado' });
    if (String(selectedClientId) === String(client.id)) setSelectedClientId('');
    loadData();
  };

  const openCreateHypothesis = () => { setEditingHypothesis(null); setHypDraft(emptyHypothesis); setHypModalOpen(true); };
  const openEditHypothesis = (h) => { setEditingHypothesis(h); setHypDraft({ type: h.type || 'exploratoria', title: h.title || '', description: h.description || '', status: h.status || 'active', audience_id: h.audience_id || '' }); setHypModalOpen(true); };
  const saveHypothesis = async () => {
    if (editingHypothesis) await interviewsApi.updateInterviewHypothesis(editingHypothesis.id, hypDraft);
    else await interviewsApi.createInterviewHypothesis(projectId, campaignId, hypDraft);
    toast({ title: editingHypothesis ? 'Hipótesis actualizada' : 'Hipótesis creada' });
    setHypModalOpen(false);
    loadData();
  };

  const deleteHypothesis = async (h) => {
    if (!window.confirm(`¿Eliminar hipótesis ${h.title}?`)) return;
    await interviewsApi.deleteInterviewHypothesis(h.id);
    toast({ title: 'Hipótesis eliminada' });
    loadData();
  };

  const startNewForm = () => {
    setActiveTab('forms');
    setPreviewMode(false);
    setEditor({
      id: null,
      title: 'Formulario sin título',
      description: '',
      questions: [blankQuestion()],
      selectedQuestionId: '',
      dirty: true,
      saveState: 'unsaved',
      saveMessage: 'Cambios sin guardar',
    });
  };

  const openFormEditor = (form) => {
    setActiveTab('forms');
    setPreviewMode(false);
    setEditor({
      ...normalizeForm(form),
      selectedQuestionId: '',
      dirty: false,
      saveState: 'saved',
      saveMessage: 'Guardado',
    });
  };

  const patchEditor = (patch) => setEditor((prev) => (prev ? { ...prev, ...patch, dirty: true, saveState: 'unsaved', saveMessage: 'Cambios sin guardar' } : prev));

  const updateQuestionById = (id, patch) => setEditor((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      questions: prev.questions.map((q) => (String(q.id) === String(id) ? { ...q, ...patch } : q)),
      dirty: true,
      saveState: 'unsaved',
      saveMessage: 'Cambios sin guardar',
    };
  });

  const addQuestion = () => {
    const newQuestion = blankQuestion();
    setEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: [...prev.questions, newQuestion],
        selectedQuestionId: newQuestion.id,
        dirty: true,
        saveState: 'unsaved',
        saveMessage: 'Cambios sin guardar',
      };
    });
  };

  const duplicateQuestion = (id) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const idx = prev.questions.findIndex((q) => String(q.id) === String(id));
      if (idx < 0) return prev;
      const cloned = { ...prev.questions[idx], id: qid(), title: `${prev.questions[idx].title || 'Pregunta'} (copia)` };
      const questions = [...prev.questions];
      questions.splice(idx + 1, 0, cloned);
      return { ...prev, questions, selectedQuestionId: cloned.id, dirty: true, saveState: 'unsaved', saveMessage: 'Cambios sin guardar' };
    });
  };

  const removeQuestion = (id) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const questions = prev.questions.filter((q) => String(q.id) !== String(id));
      return {
        ...prev,
        questions,
        selectedQuestionId: questions[0]?.id || '',
        dirty: true,
        saveState: 'unsaved',
        saveMessage: 'Cambios sin guardar',
      };
    });
  };

  const reorderQuestions = (fromId, toId) => {
    setEditor((prev) => {
      if (!prev || fromId === toId) return prev;
      const from = prev.questions.findIndex((q) => String(q.id) === String(fromId));
      const to = prev.questions.findIndex((q) => String(q.id) === String(toId));
      if (from < 0 || to < 0) return prev;
      const next = [...prev.questions];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, questions: next, dirty: true, saveState: 'unsaved', saveMessage: 'Cambios sin guardar' };
    });
  };

  const saveEditor = async (silent = false) => {
    if (!editor) return;
    try {
      setEditor((prev) => (prev ? { ...prev, saveState: 'saving', saveMessage: 'Guardando...' } : prev));
      const payload = {
        title: editor.title || 'Formulario sin título',
        description: editor.description || '',
        questions: (editor.questions || []).map(normalizeQuestion),
      };
      let saved;
      if (editor.id) saved = await interviewsApi.updateForm(editor.id, payload);
      else saved = await interviewsApi.createForm(projectId, campaignId, payload);

      const normalized = normalizeForm(saved || { ...editor, questions_json: payload.questions });
      setForms((prev) => {
        const without = prev.filter((f) => String(f.id) !== String(normalized.id));
        return [normalized, ...without].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      });
      setEditor((prev) => (prev ? { ...prev, ...normalized, dirty: false, saveState: 'saved', saveMessage: 'Guardado' } : prev));
      if (!silent) toast({ title: 'Formulario guardado' });
    } catch (error) {
      setEditor((prev) => (prev ? { ...prev, saveState: 'error', saveMessage: 'Error al guardar' } : prev));
      toast({ title: 'Error al guardar', description: error.message, variant: 'destructive' });
    }
  };

  const duplicateForm = async (form) => {
    await interviewsApi.createForm(projectId, campaignId, {
      title: `${form.title} (copia)`,
      description: form.description || '',
      questions: form.questions || [],
    });
    toast({ title: 'Formulario duplicado' });
    loadData();
  };

  const deleteForm = async (form) => {
    if (!window.confirm(`¿Eliminar formulario ${form.title}?`)) return;
    await interviewsApi.deleteForm(form.id);
    toast({ title: 'Formulario eliminado' });
    if (String(editor?.id || '') === String(form.id)) setEditor(null);
    loadData();
  };

  const activeQuestion = useMemo(() => editor?.questions?.find((q) => String(q.id) === String(editor?.selectedQuestionId || '')) || null, [editor]);

  const validatePreview = () => {
    if (!editor) return [];
    const errors = [];
    for (const question of editor.questions || []) {
      if (!question.required) continue;
      const value = previewAnswers[question.id];
      if (question.type === 'multi_choice') {
        if (!Array.isArray(value) || !value.length) errors.push(question.title || 'Pregunta requerida');
      } else if (value == null || String(value).trim() === '') {
        errors.push(question.title || 'Pregunta requerida');
      }
    }
    return errors;
  };

  const runPreviewSubmit = () => {
    const errors = validatePreview();
    setPreviewErrors(errors);
    if (errors.length) return;
    toast({ title: 'Preview válido', description: 'Las respuestas pasan validación (no se guarda entrevista).' });
  };

  const activeWizardForm = forms.find((f) => String(f.id) === String(wizard.form_id));
  const beginWizard = () => { setWizardOpen(true); setWizardStep(1); setWizard({ audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} }); };

  const nextWizard = async () => {
    if (wizardStep < 4) return setWizardStep((s) => s + 1);
    await interviewsApi.createSession(projectId, campaignId, wizard);
    toast({ title: 'Entrevista guardada', description: 'La sesión se registró correctamente.' });
    setWizardOpen(false);
    await loadData();
    setActiveTab('sessions');
  };

  const openSessionDetail = async (sessionId) => {
    const detail = await interviewsApi.readSession(sessionId);
    setSessionDetail(detail);
  };

  const deleteSession = async (session) => {
    if (!window.confirm('¿Eliminar entrevista?')) return;
    await interviewsApi.deleteSession(session.id);
    toast({ title: 'Entrevista eliminada' });
    if (sessionDetail && String(sessionDetail.id) === String(session.id)) setSessionDetail(null);
    loadData();
  };

  const renderPreviewInput = (question) => {
    const value = previewAnswers[question.id] || '';
    if (question.type === 'long_text') {
      return <textarea className="border rounded p-2 w-full" rows={3} placeholder={question.placeholder || ''} value={value} onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))} />;
    }
    if (question.type === 'single_choice') {
      return <div className="space-y-1">{(question.options || []).map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="radio" name={question.id} checked={value === option} onChange={() => setPreviewAnswers((prev) => ({ ...prev, [question.id]: option }))} />{option}</label>)}</div>;
    }
    if (question.type === 'multi_choice') {
      const selected = Array.isArray(value) ? value : [];
      return <div className="space-y-1">{(question.options || []).map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(option)} onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [question.id]: e.target.checked ? [...selected, option] : selected.filter((v) => v !== option) }))} />{option}</label>)}</div>;
    }
    if (question.type === 'scale_1_5') {
      return <div className="space-y-2"><div className="flex justify-between text-xs text-gray-500"><span>{question.scale?.minLabel || 'Mínimo'}</span><span>{question.scale?.maxLabel || 'Máximo'}</span></div><input type="range" min="1" max="5" value={Number(value || 3)} onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [question.id]: Number(e.target.value) }))} className="w-full" /></div>;
    }
    return <input className="border rounded p-2 w-full" placeholder={question.placeholder || ''} value={value} onChange={(e) => setPreviewAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))} />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <Helmet><title>Centro de Entrevistas</title></Helmet>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <Link to="/projects" className="hover:underline">Proyecto</Link><span>›</span>
            <Link to={`/campaigns/${campaignId}`} className="hover:underline">Campaña</Link><span>›</span>
            <span className="font-medium text-gray-800">Entrevistas</span>
          </div>
          <Button className="bg-white border text-gray-700" onClick={() => navigate(`/campaigns/${campaignId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 border border-indigo-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Centro de Entrevistas</h1>
            <p className="text-gray-600">Módulo independiente de videos. Clientes, formularios, hipótesis y sesiones.</p>
          </div>
          <div className="flex gap-2">
            <Button className="bg-indigo-600 text-white" onClick={beginWizard}>Realizar entrevista</Button>
            <Button className="bg-emerald-600 text-white" onClick={startNewForm}>Crear formulario</Button>
            <Button className="bg-blue-600 text-white" onClick={openCreateClient}>Crear cliente</Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border shadow p-2 flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${activeTab === tab.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>

        {loading ? <div className="bg-white rounded-xl p-6">Cargando…</div> : null}

        {activeTab === 'dashboard' ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[{ label: 'Total clientes', value: dashboard.totalClients }, { label: 'Total entrevistas', value: dashboard.totalSessions }, { label: 'Formularios activos', value: dashboard.activeForms }, { label: 'Hipótesis exploratorias', value: dashboard.exploratory }, { label: 'Hipótesis validación', value: dashboard.validation }].map((card) => <div key={card.label} className="bg-white rounded-xl border p-4"><p className="text-sm text-gray-500">{card.label}</p><p className="text-2xl font-bold">{card.value}</p></div>)}
            <div className="bg-white rounded-xl border p-4 md:col-span-2"><h3 className="font-semibold mb-2">Entrevistas por audiencia (top 5)</h3>{dashboard.topAudiences.length ? dashboard.topAudiences.map(([name, count]) => <p key={name} className="text-sm">{name}: <b>{count}</b></p>) : <p className="text-sm text-gray-500">Sin datos.</p>}</div>
            <div className="bg-white rounded-xl border p-4"><h3 className="font-semibold mb-2">Últimas entrevistas</h3>{dashboard.latest.length ? dashboard.latest.map((s) => <p key={s.id} className="text-sm">{s.client_name} · {new Date(s.conducted_at || s.created_at).toLocaleDateString()}</p>) : <p className="text-sm text-gray-500">Sin entrevistas.</p>}</div>
          </div>
        ) : null}

        {activeTab === 'clients' ? (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border p-4 space-y-3">
              <div className="flex gap-2">
                <input className="border rounded p-2 flex-1" placeholder="Buscar cliente..." value={clientFilter.q} onChange={(e) => setClientFilter({ ...clientFilter, q: e.target.value })} />
                <select className="border rounded p-2" value={clientFilter.audience_id} onChange={(e) => setClientFilter({ ...clientFilter, audience_id: e.target.value })}><option value="">Todas audiencias</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-auto">
                {filteredClients.map((c) => (
                  <div key={c.id} className={`border rounded p-3 ${String(selectedClientId) === String(c.id) ? 'border-indigo-400 bg-indigo-50' : ''}`}>
                    <button className="text-left w-full" onClick={() => setSelectedClientId(c.id)}><p className="font-semibold">{c.name}</p><p className="text-sm text-gray-500">{c.audience_name || 'Sin audiencia'} · {c.contact || 'Sin contacto'}</p></button>
                    <div className="mt-2 flex gap-2"><Button className="bg-gray-100 text-gray-700 border" onClick={() => openEditClient(c)}>Editar</Button><Button className="bg-red-600 text-white" onClick={() => deleteClient(c)}>Eliminar</Button></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <h3 className="font-semibold mb-2">Detalle del cliente</h3>
              {!selectedClient ? <p className="text-sm text-gray-500">Selecciona un cliente.</p> : (<><p className="font-semibold">{selectedClient.name}</p><p className="text-sm text-gray-500">{selectedClient.contact || 'Sin contacto'} · {selectedClient.audience_name || 'Sin audiencia'}</p><p className="text-sm mt-2">{selectedClient.notes || 'Sin notas'}</p><h4 className="font-medium mt-4 mb-1">Historial de entrevistas</h4><div className="space-y-1 max-h-48 overflow-auto">{selectedClientHistory.length ? selectedClientHistory.map((s) => <button key={s.id} className="text-left w-full text-sm border rounded p-2 hover:bg-gray-50" onClick={() => openSessionDetail(s.id)}>{new Date(s.conducted_at || s.created_at).toLocaleString()} · {s.form_title || '-'}</button>) : <p className="text-sm text-gray-500">Sin entrevistas.</p>}</div></>)}
            </div>
          </div>
        ) : null}

        {activeTab === 'forms' ? (
          <div className="grid lg:grid-cols-12 gap-4">
            <aside className="lg:col-span-3 bg-white rounded-xl border p-3 space-y-2 max-h-[75vh] overflow-auto">
              <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Formularios</h3><Button className="bg-emerald-600 text-white" onClick={startNewForm}><Plus className="w-4 h-4 mr-1" />Nuevo</Button></div>
              {forms.map((f) => (
                <button key={f.id} className={`w-full text-left border rounded-lg p-3 ${String(editor?.id || '') === String(f.id) ? 'border-indigo-400 bg-indigo-50' : ''}`} onClick={() => openFormEditor(f)}>
                  <p className="font-medium">{f.title}</p>
                  <p className="text-xs text-gray-500">{(f.questions || []).length} preguntas</p>
                  <p className="text-xs text-gray-400">Actualizado: {new Date(f.updated_at || f.created_at).toLocaleString()}</p>
                  <div className="flex gap-1 mt-2">
                    <span className="px-2 py-1 text-xs rounded bg-gray-100">Editar</span>
                    <span className="px-2 py-1 text-xs rounded bg-gray-100" onClick={(e) => { e.stopPropagation(); duplicateForm(f); }}>Duplicar</span>
                    <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-700" onClick={(e) => { e.stopPropagation(); deleteForm(f); }}>Eliminar</span>
                  </div>
                </button>
              ))}
            </aside>

            <div className="lg:col-span-9 grid xl:grid-cols-12 gap-4">
              {!editor ? <div className="xl:col-span-12 bg-white rounded-xl border p-6 text-gray-500">Selecciona un formulario o crea uno nuevo.</div> : (
                <>
                  <section className="xl:col-span-9 bg-white rounded-xl border p-4 relative">
                    <div className="sticky top-0 z-10 bg-white pb-3 border-b mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 space-y-2">
                          <input className="text-2xl font-bold w-full outline-none border-b border-transparent focus:border-indigo-300" value={editor.title} onChange={(e) => patchEditor({ title: e.target.value })} />
                          <input className="text-sm text-gray-600 w-full outline-none border-b border-transparent focus:border-indigo-300" placeholder="Descripción del formulario" value={editor.description} onChange={(e) => patchEditor({ description: e.target.value })} />
                        </div>
                        <div className="flex gap-2 items-center">
                          <span className={`text-xs px-2 py-1 rounded ${editor.saveState === 'error' ? 'bg-red-100 text-red-700' : editor.saveState === 'saving' ? 'bg-yellow-100 text-yellow-700' : editor.dirty ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{editor.saveMessage || 'Guardado'}</span>
                          <Button className="bg-gray-100 text-gray-700 border" onClick={() => setPreviewMode((v) => !v)}>{previewMode ? 'Editar' : 'Vista previa'}</Button>
                          {editor.id ? <Button className="bg-indigo-100 text-indigo-700 border" onClick={() => duplicateForm(editor)}>Duplicar</Button> : null}
                          <Button className="bg-indigo-600 text-white" onClick={() => saveEditor(false)} disabled={editor.saveState === 'saving'}>{editor.saveState === 'saving' ? 'Guardando…' : 'Guardar'}</Button>
                        </div>
                      </div>
                    </div>

                    {!previewMode ? (
                      <div className="space-y-3 pr-16">
                        {editor.questions.map((q) => (
                          <div
                            key={q.id}
                            draggable
                            onDragStart={() => setDragQuestionId(q.id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => reorderQuestions(dragQuestionId, q.id)}
                            className={`border rounded-xl p-3 ${String(editor.selectedQuestionId || '') === String(q.id) ? 'border-indigo-400 bg-indigo-50/50' : 'bg-white'}`}
                            onClick={() => setEditor((prev) => ({ ...prev, selectedQuestionId: q.id }))}
                          >
                            <div className="flex items-center gap-2 mb-2"><GripVertical className="w-4 h-4 text-gray-500" /><input className="flex-1 border rounded p-2" placeholder="Título de la pregunta" value={q.title} onChange={(e) => updateQuestionById(q.id, { title: e.target.value })} /><select className="border rounded p-2" value={q.type} onChange={(e) => updateQuestionById(q.id, { type: e.target.value })}><option value="short_text">short_text</option><option value="long_text">long_text</option><option value="single_choice">single_choice</option><option value="multi_choice">multi_choice</option><option value="scale_1_5">scale_1_5</option></select></div>
                            <div className="flex items-center gap-2 mb-2"><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={q.required} onChange={(e) => updateQuestionById(q.id, { required: e.target.checked })} />Obligatoria</label><Button className="bg-gray-100 text-gray-700 border" onClick={(e) => { e.stopPropagation(); duplicateQuestion(q.id); }}>Duplicar</Button><Button className="bg-red-600 text-white" onClick={(e) => { e.stopPropagation(); removeQuestion(q.id); }}>Borrar</Button></div>
                            {(q.type === 'single_choice' || q.type === 'multi_choice') ? (
                              <div className="space-y-1">{q.options.map((opt, idx) => <div key={`${q.id}-${idx}`} className="flex gap-2"><input className="border rounded p-1 flex-1" value={opt} onChange={(e) => updateQuestionById(q.id, { options: q.options.map((v, i) => (i === idx ? e.target.value : v)) })} /><Button className="bg-red-50 text-red-700 border" onClick={() => updateQuestionById(q.id, { options: q.options.filter((_, i) => i !== idx) })}>x</Button></div>)}
                                <input className="border rounded p-1 w-full" placeholder="Escribe opción y Enter" onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const val = e.currentTarget.value.trim();
                                    if (!val) return;
                                    updateQuestionById(q.id, { options: [...q.options, val] });
                                    e.currentTarget.value = '';
                                  }
                                }} />
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {editor.questions.map((q) => <div key={q.id} className="border rounded-xl p-3"><p className="font-medium">{q.title} {q.required ? '*' : ''}</p>{q.description ? <p className="text-xs text-gray-500 mb-2">{q.description}</p> : null}{renderPreviewInput(q)}</div>)}
                        {previewErrors.length ? <div className="text-sm text-red-600">{previewErrors.map((e) => <p key={e}>• {e}</p>)}</div> : null}
                        <Button className="bg-indigo-600 text-white" onClick={runPreviewSubmit}>Enviar (preview)</Button>
                      </div>
                    )}

                    {!previewMode ? <button className="absolute right-4 bottom-4 h-12 w-12 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg" onClick={addQuestion} title="Agregar pregunta"><Plus className="w-5 h-5" /></button> : null}
                  </section>

                  <aside className="xl:col-span-3 bg-white rounded-xl border p-3 space-y-2">
                    <h4 className="font-semibold">Propiedades</h4>
                    {!activeQuestion ? (
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500">Título formulario</label>
                        <input className="border rounded p-2 w-full" value={editor.title} onChange={(e) => patchEditor({ title: e.target.value })} />
                        <label className="text-xs text-gray-500">Descripción</label>
                        <textarea className="border rounded p-2 w-full" rows={3} value={editor.description} onChange={(e) => patchEditor({ description: e.target.value })} />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500">Tipo</label>
                        <select className="border rounded p-2 w-full" value={activeQuestion.type} onChange={(e) => updateQuestionById(activeQuestion.id, { type: e.target.value })}><option value="short_text">short_text</option><option value="long_text">long_text</option><option value="single_choice">single_choice</option><option value="multi_choice">multi_choice</option><option value="scale_1_5">scale_1_5</option></select>
                        <label className="text-xs text-gray-500">Obligatoria</label>
                        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={activeQuestion.required} onChange={(e) => updateQuestionById(activeQuestion.id, { required: e.target.checked })} />Sí</label>
                        <label className="text-xs text-gray-500">Descripción/ayuda</label>
                        <textarea className="border rounded p-2 w-full" rows={2} value={activeQuestion.description || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { description: e.target.value })} />
                        {(activeQuestion.type === 'short_text' || activeQuestion.type === 'long_text') ? (
                          <>
                            <label className="text-xs text-gray-500">Placeholder</label>
                            <input className="border rounded p-2 w-full" value={activeQuestion.placeholder || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { placeholder: e.target.value })} />
                            <div className="grid grid-cols-2 gap-2">
                              <input className="border rounded p-2" type="number" placeholder="min" value={activeQuestion.validation?.minLength || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { validation: { ...activeQuestion.validation, minLength: Number(e.target.value || 0) } })} />
                              <input className="border rounded p-2" type="number" placeholder="max" value={activeQuestion.validation?.maxLength || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { validation: { ...activeQuestion.validation, maxLength: Number(e.target.value || 0) } })} />
                            </div>
                          </>
                        ) : null}
                        {activeQuestion.type === 'scale_1_5' ? (
                          <>
                            <label className="text-xs text-gray-500">Label mínimo</label>
                            <input className="border rounded p-2 w-full" value={activeQuestion.scale?.minLabel || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { scale: { ...activeQuestion.scale, minLabel: e.target.value } })} />
                            <label className="text-xs text-gray-500">Label máximo</label>
                            <input className="border rounded p-2 w-full" value={activeQuestion.scale?.maxLabel || ''} onChange={(e) => updateQuestionById(activeQuestion.id, { scale: { ...activeQuestion.scale, maxLabel: e.target.value } })} />
                          </>
                        ) : null}
                      </div>
                    )}
                  </aside>
                </>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'hypotheses' ? (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border p-3 flex flex-wrap gap-2">
              <select className="border rounded p-2" value={hypFilter.type} onChange={(e) => setHypFilter({ ...hypFilter, type: e.target.value })}><option value="">Tipo</option><option value="exploratoria">exploratoria</option><option value="validación">validación</option></select>
              <select className="border rounded p-2" value={hypFilter.status} onChange={(e) => setHypFilter({ ...hypFilter, status: e.target.value })}><option value="">Estado</option><option value="active">active</option><option value="paused">paused</option><option value="done">done</option></select>
              <select className="border rounded p-2" value={hypFilter.audience_id} onChange={(e) => setHypFilter({ ...hypFilter, audience_id: e.target.value })}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <Button className="bg-purple-600 text-white ml-auto" onClick={openCreateHypothesis}><Plus className="w-4 h-4 mr-1" />Nueva hipótesis</Button>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{filteredHypotheses.map((h) => <div key={h.id} className="bg-white rounded-xl border p-4"><div className="flex gap-2 text-xs mb-2"><span className="px-2 py-1 rounded bg-indigo-100 text-indigo-700">{h.type}</span><span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{h.status}</span></div><p className="font-semibold">{h.title}</p><p className="text-sm text-gray-500">{h.audience_name || 'Sin audiencia'}</p><p className="text-sm mt-2">{h.description || 'Sin descripción'}</p><div className="flex gap-2 mt-3"><Button className="bg-gray-100 text-gray-700 border" onClick={() => openEditHypothesis(h)}>Editar</Button><Button className="bg-red-600 text-white" onClick={() => deleteHypothesis(h)}>Eliminar</Button></div></div>)}</div>
          </div>
        ) : null}

        {activeTab === 'sessions' ? (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border p-3 grid md:grid-cols-6 gap-2">
              <select className="border rounded p-2" value={sessionFilter.audience_id} onChange={(e) => setSessionFilter({ ...sessionFilter, audience_id: e.target.value })}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.client_id} onChange={(e) => setSessionFilter({ ...sessionFilter, client_id: e.target.value })}><option value="">Cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.form_id} onChange={(e) => setSessionFilter({ ...sessionFilter, form_id: e.target.value })}><option value="">Formulario</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
              <select className="border rounded p-2" value={sessionFilter.hypothesis_id} onChange={(e) => setSessionFilter({ ...sessionFilter, hypothesis_id: e.target.value })}><option value="">Hipótesis</option>{hypotheses.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</select>
              <input type="date" className="border rounded p-2" value={sessionFilter.from} onChange={(e) => setSessionFilter({ ...sessionFilter, from: e.target.value })} />
              <input type="date" className="border rounded p-2" value={sessionFilter.to} onChange={(e) => setSessionFilter({ ...sessionFilter, to: e.target.value })} />
            </div>
            <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="text-left p-2">Fecha</th><th className="text-left p-2">Cliente</th><th className="text-left p-2">Audiencia</th><th className="text-left p-2">Formulario</th><th className="text-left p-2">Hipótesis</th><th className="text-left p-2">Acciones</th></tr></thead><tbody>{filteredSessions.map((s) => <tr key={s.id} className="border-t"><td className="p-2">{new Date(s.conducted_at || s.created_at).toLocaleString()}</td><td className="p-2">{s.client_name}</td><td className="p-2">{s.audience_name || '—'}</td><td className="p-2">{s.form_title || '—'}</td><td className="p-2">{s.hypothesis_title || '—'}</td><td className="p-2 flex gap-2"><Button className="bg-gray-100 text-gray-700 border" onClick={() => openSessionDetail(s.id)}>Ver</Button><Button className="bg-red-600 text-white" onClick={() => deleteSession(s)}>Eliminar</Button></td></tr>)}</tbody></table></div>
          </div>
        ) : null}
      </div>

      {clientModalOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-4 w-full max-w-lg space-y-2"><h3 className="font-semibold">{editingClient ? 'Editar cliente' : 'Crear cliente'}</h3><input className="border rounded p-2 w-full" placeholder="Nombre" value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} /><input className="border rounded p-2 w-full" placeholder="Contacto" value={clientDraft.contact} onChange={(e) => setClientDraft({ ...clientDraft, contact: e.target.value })} /><select className="border rounded p-2 w-full" value={clientDraft.audience_id} onChange={(e) => setClientDraft({ ...clientDraft, audience_id: e.target.value })}><option value="">Sin audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={clientDraft.notes} onChange={(e) => setClientDraft({ ...clientDraft, notes: e.target.value })} /><div className="flex justify-end gap-2"><Button className="bg-gray-100 text-gray-700 border" onClick={() => setClientModalOpen(false)}>Cancelar</Button><Button className="bg-blue-600 text-white" onClick={saveClient}>Guardar</Button></div></div></div>
      ) : null}

      {hypModalOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-4 w-full max-w-lg space-y-2"><h3 className="font-semibold">{editingHypothesis ? 'Editar hipótesis' : 'Crear hipótesis'}</h3><input className="border rounded p-2 w-full" placeholder="Título" value={hypDraft.title} onChange={(e) => setHypDraft({ ...hypDraft, title: e.target.value })} /><textarea className="border rounded p-2 w-full" rows={3} placeholder="Descripción" value={hypDraft.description} onChange={(e) => setHypDraft({ ...hypDraft, description: e.target.value })} /><div className="grid grid-cols-3 gap-2"><select className="border rounded p-2" value={hypDraft.type} onChange={(e) => setHypDraft({ ...hypDraft, type: e.target.value })}><option value="exploratoria">exploratoria</option><option value="validación">validación</option></select><select className="border rounded p-2" value={hypDraft.status} onChange={(e) => setHypDraft({ ...hypDraft, status: e.target.value })}><option value="active">active</option><option value="paused">paused</option><option value="done">done</option></select><select className="border rounded p-2" value={hypDraft.audience_id} onChange={(e) => setHypDraft({ ...hypDraft, audience_id: e.target.value })}><option value="">Sin audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div className="flex justify-end gap-2"><Button className="bg-gray-100 text-gray-700 border" onClick={() => setHypModalOpen(false)}>Cancelar</Button><Button className="bg-purple-600 text-white" onClick={saveHypothesis}>Guardar</Button></div></div></div>
      ) : null}

      {wizardOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-4 w-full max-w-2xl space-y-3"><h3 className="font-semibold">Realizar entrevista · Paso {wizardStep}/4</h3>{wizardStep === 1 ? <select className="border rounded p-2 w-full" value={wizard.audience_id} onChange={(e) => setWizard({ ...wizard, audience_id: e.target.value })}><option value="">Audiencia (opcional)</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select> : null}{wizardStep === 2 ? <div className="space-y-2"><select className="border rounded p-2 w-full" value={wizard.client_id} onChange={(e) => setWizard({ ...wizard, client_id: e.target.value })}><option value="">Seleccionar cliente</option>{clients.filter((c) => !wizard.audience_id || String(c.audience_id || '') === String(wizard.audience_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><Button className="bg-blue-600 text-white" onClick={openCreateClient}>Crear cliente rápido</Button></div> : null}{wizardStep === 3 ? <select className="border rounded p-2 w-full" value={wizard.form_id} onChange={(e) => setWizard({ ...wizard, form_id: e.target.value, responses: {} })}><option value="">Seleccionar formulario</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select> : null}{wizardStep === 4 ? <div className="space-y-2 max-h-[50vh] overflow-auto"><select className="border rounded p-2 w-full" value={wizard.interview_hypothesis_id} onChange={(e) => setWizard({ ...wizard, interview_hypothesis_id: e.target.value })}><option value="">Hipótesis opcional</option>{hypotheses.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</select>{(activeWizardForm?.questions || []).map((q) => <div key={q.id} className="border rounded p-2"><p className="text-sm font-medium">{q.title}</p><input className="border rounded p-2 w-full" value={wizard.responses[q.id] || ''} onChange={(e) => setWizard({ ...wizard, responses: { ...wizard.responses, [q.id]: e.target.value } })} /></div>)}<textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={wizard.notes} onChange={(e) => setWizard({ ...wizard, notes: e.target.value })} /></div> : null}<div className="flex justify-between"><Button className="bg-gray-100 text-gray-700 border" onClick={() => (wizardStep === 1 ? setWizardOpen(false) : setWizardStep((s) => s - 1))}>Atrás</Button><Button className="bg-indigo-600 text-white" onClick={nextWizard}>{wizardStep < 4 ? 'Siguiente' : 'Finalizar'}</Button></div></div></div>
      ) : null}

      {sessionDetail ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-4 w-full max-w-2xl space-y-2 max-h-[90vh] overflow-auto"><h3 className="font-semibold">Detalle entrevista</h3><p className="text-sm text-gray-600">{sessionDetail.client_name} · {sessionDetail.audience_name || 'sin audiencia'} · {sessionDetail.form_title || '-'}</p><p className="text-sm">Hipótesis: {sessionDetail.hypothesis_title || '—'}</p><p className="text-sm">Notas: {sessionDetail.notes || '—'}</p><div className="space-y-2">{Object.entries(sessionDetail.responses_json || {}).map(([key, value]) => <div key={key} className="border rounded p-2 text-sm"><b>{key}</b><p>{String(value)}</p></div>)}</div><div className="flex justify-end"><Button className="bg-gray-100 text-gray-700 border" onClick={() => setSessionDetail(null)}>Cerrar</Button></div></div></div>
      ) : null}
    </div>
  );
};

export default InterviewsPage;
