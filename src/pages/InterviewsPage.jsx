import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, FileText, Lightbulb, MessageSquare, Plus, Users } from 'lucide-react';
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

const qid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `q_${Date.now()}_${Math.random().toString(16).slice(2)}`);
const normalizeQuestion = (q, i = 0) => ({ id: String(q?.id || qid()), type: q?.type || 'short_text', title: String(q?.title || q?.label || `Pregunta ${i + 1}`), required: Boolean(q?.required), options: Array.isArray(q?.options) ? q.options : [] });
const normalizeForm = (f) => ({ ...f, questions: (Array.isArray(f?.questions_json) ? f.questions_json : []).map(normalizeQuestion) });

const InterviewsPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [audiences, setAudiences] = useState([]);
  const [clients, setClients] = useState([]);
  const [forms, setForms] = useState([]);
  const [hypotheses, setHypotheses] = useState([]);
  const [sessions, setSessions] = useState([]);

  const [clientDraft, setClientDraft] = useState({ name: '', contact: '', notes: '', audience_id: '' });
  const [formDraft, setFormDraft] = useState({ title: '', description: '', questions: [] });
  const [hypDraft, setHypDraft] = useState({ type: 'exploratoria', title: '', description: '', status: 'active', audience_id: '' });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardQuestionIndex, setWizardQuestionIndex] = useState(0);
  const [wizard, setWizard] = useState({ id: null, audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', status: 'draft', responses: {}, dirty: false });

  const [clientQuickOpen, setClientQuickOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState({ audience_id: '', client_id: '', status: '', from: '', to: '' });

  const loadData = async () => {
    const [auds, cls, frms, hyps, sess] = await Promise.all([
      interviewsApi.listAudiences(campaignId),
      interviewsApi.listClients(projectId, campaignId),
      interviewsApi.listForms(projectId, campaignId),
      interviewsApi.listInterviewHypotheses(projectId, campaignId),
      interviewsApi.listInterviewSessions(projectId, campaignId),
    ]);
    setAudiences(auds);
    setClients(cls);
    setForms(frms.map(normalizeForm));
    setHypotheses(hyps);
    setSessions(sess);
  };

  useEffect(() => { loadData().catch((e) => toast({ title: 'Error', description: e.message, variant: 'destructive' })); }, [projectId, campaignId]);

  const wizardForm = useMemo(() => forms.find((f) => String(f.id) === String(wizard.form_id)), [forms, wizard.form_id]);
  const wizardQuestions = wizardForm?.questions || [];
  const currentQuestion = wizardQuestions[wizardQuestionIndex] || null;

  const filteredSessions = useMemo(() => sessions.filter((s) => {
    if (sessionFilter.audience_id && String(s.audience_id || '') !== String(sessionFilter.audience_id)) return false;
    if (sessionFilter.client_id && String(s.client_id || '') !== String(sessionFilter.client_id)) return false;
    if (sessionFilter.status && String(s.status || 'draft') !== sessionFilter.status) return false;
    const t = new Date(s.created_at).getTime();
    if (sessionFilter.from && t < new Date(sessionFilter.from).getTime()) return false;
    if (sessionFilter.to && t > new Date(sessionFilter.to).getTime() + 86400000) return false;
    return true;
  }), [sessions, sessionFilter]);

  const startWizard = () => {
    setWizardOpen(true);
    setWizardStep(1);
    setWizardQuestionIndex(0);
    setWizard({ id: null, audience_id: '', client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', status: 'draft', responses: {}, dirty: false });
  };

  const ensureDraft = async () => {
    if (wizard.id) return wizard.id;
    const created = await interviewsApi.createSession(projectId, campaignId, { ...wizard, status: 'draft' });
    setWizard((prev) => ({ ...prev, id: created.id, dirty: false }));
    return created.id;
  };

  const saveDraft = async () => {
    try {
      const id = await ensureDraft();
      const updated = await interviewsApi.updateSession(id, { ...wizard, status: 'draft' });
      setWizard((prev) => ({ ...prev, id: updated.id, dirty: false }));
      toast({ title: 'Borrador guardado' });
      await loadData();
    } catch (e) {
      toast({ title: 'Error al guardar borrador', description: e.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (!wizardOpen || wizardStep !== 5 || !wizard.dirty) return undefined;
    const timer = setTimeout(() => { saveDraft(); }, 1000);
    return () => clearTimeout(timer);
  }, [wizard.responses, wizard.notes, wizardQuestionIndex, wizardStep, wizardOpen, wizard.dirty]);

  const finishInterview = async () => {
    const required = wizardQuestions.filter((q) => q.required && (wizard.responses[q.id] == null || String(wizard.responses[q.id]).trim() === '' || (Array.isArray(wizard.responses[q.id]) && !wizard.responses[q.id].length)));
    if (required.length) return toast({ title: 'Faltan respuestas requeridas', description: required[0].title, variant: 'destructive' });
    try {
      const id = await ensureDraft();
      await interviewsApi.updateSession(id, { ...wizard, status: 'completed' });
      toast({ title: 'Entrevista finalizada' });
      setWizardOpen(false);
      await loadData();
      setActiveTab('sessions');
      navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${id}`);
    } catch (e) {
      toast({ title: 'Error al finalizar', description: e.message, variant: 'destructive' });
    }
  };

  const createQuickClient = async () => {
    const created = await interviewsApi.createClient(projectId, campaignId, clientDraft);
    setClients((prev) => [created, ...prev]);
    setWizard((prev) => ({ ...prev, client_id: created.id, audience_id: created.audience_id || prev.audience_id }));
    setClientQuickOpen(false);
    setClientDraft({ name: '', contact: '', notes: '', audience_id: '' });
  };

  const renderAnswerInput = (q) => {
    const val = wizard.responses[q.id];
    if (q.type === 'long_text') return <textarea className="border rounded p-2 w-full" rows={4} value={val || ''} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, responses: { ...p.responses, [q.id]: e.target.value } }))} />;
    if (q.type === 'single_choice') return <div className="space-y-2">{(q.options || []).map((o) => <label key={o} className="flex gap-2 text-sm"><input type="radio" checked={val === o} onChange={() => setWizard((p) => ({ ...p, dirty: true, responses: { ...p.responses, [q.id]: o } }))} />{o}</label>)}</div>;
    if (q.type === 'multi_choice') return <div className="space-y-2">{(q.options || []).map((o) => <label key={o} className="flex gap-2 text-sm"><input type="checkbox" checked={Array.isArray(val) && val.includes(o)} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, responses: { ...p.responses, [q.id]: e.target.checked ? [...(Array.isArray(p.responses[q.id]) ? p.responses[q.id] : []), o] : (Array.isArray(p.responses[q.id]) ? p.responses[q.id].filter((x) => x !== o) : []) } }))} />{o}</label>)}</div>;
    if (q.type === 'scale_1_5') return <div className="flex gap-2">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="text-sm flex flex-col items-center"><input type="radio" checked={String(val) === String(n)} onChange={() => setWizard((p) => ({ ...p, dirty: true, responses: { ...p.responses, [q.id]: n } }))} />{n}</label>)}</div>;
    return <input className="border rounded p-2 w-full" value={val || ''} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, responses: { ...p.responses, [q.id]: e.target.value } }))} />;
  };

  return (
    <>
      <Helmet><title>Centro de Entrevistas</title></Helmet>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50 p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-gray-500 flex gap-2"><Link to="/projects" className="hover:underline">Proyectos</Link> / <span>Entrevistas</span></div>
              <h1 className="text-3xl font-bold">Centro de Entrevistas</h1>
            </div>
            <div className="flex gap-2">
              <Button className="bg-white border text-gray-700" onClick={() => navigate(`/campaigns/${campaignId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Campaña</Button>
              <Button className="bg-indigo-600 text-white" onClick={startWizard}>Realizar entrevista</Button>
            </div>
          </div>

          <div className="bg-white rounded-xl p-2 border flex flex-wrap gap-2">{tabs.map((t) => <button key={t.key} className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`} onClick={() => setActiveTab(t.key)}><t.icon className="w-4 h-4" />{t.label}</button>)}</div>

          {activeTab === 'dashboard' && <div className="grid md:grid-cols-3 gap-3">{[['Clientes', clients.length], ['Entrevistas', sessions.length], ['Formularios', forms.length]].map(([k, v]) => <div key={k} className="bg-white rounded-xl border p-4"><p className="text-sm text-gray-500">{k}</p><p className="text-2xl font-bold">{v}</p></div>)}</div>}

          {activeTab === 'clients' && <div className="bg-white rounded-xl border p-4 space-y-2"><div className="flex gap-2"><input className="border rounded p-2" placeholder="Nombre" value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} /><input className="border rounded p-2" placeholder="Contacto" value={clientDraft.contact} onChange={(e) => setClientDraft({ ...clientDraft, contact: e.target.value })} /><Button className="bg-indigo-600 text-white" onClick={async () => { await interviewsApi.createClient(projectId, campaignId, clientDraft); setClientDraft({ name: '', contact: '', notes: '', audience_id: '' }); loadData(); }}>Crear cliente</Button></div>{clients.map((c) => <div key={c.id} className="border rounded p-2 flex justify-between"><div><p className="font-medium">{c.name}</p><p className="text-xs text-gray-500">{c.audience_name || 'Sin audiencia'}</p></div><Button className="bg-red-600 text-white" onClick={async () => { await interviewsApi.deleteClient(c.id); loadData(); }}>Eliminar</Button></div>)}</div>}

          {activeTab === 'forms' && <div className="bg-white rounded-xl border p-4 space-y-2"><div className="flex gap-2"><input className="border rounded p-2" placeholder="Título" value={formDraft.title} onChange={(e) => setFormDraft({ ...formDraft, title: e.target.value })} /><Button className="bg-indigo-600 text-white" onClick={() => setFormDraft((p) => ({ ...p, questions: [...p.questions, normalizeQuestion({ title: '' }, p.questions.length)] }))}><Plus className="w-4 h-4 mr-1" />Pregunta</Button><Button className="bg-emerald-600 text-white" onClick={async () => { await interviewsApi.createForm(projectId, campaignId, { ...formDraft, questions: formDraft.questions }); setFormDraft({ title: '', description: '', questions: [] }); loadData(); }}>Guardar formulario</Button></div>{formDraft.questions.map((q, idx) => <div key={q.id} className="border rounded p-2 grid md:grid-cols-4 gap-2"><input className="border rounded p-2 md:col-span-2" placeholder="Pregunta" value={q.title} onChange={(e) => setFormDraft((p) => ({ ...p, questions: p.questions.map((x) => x.id === q.id ? { ...x, title: e.target.value } : x) }))} /><select className="border rounded p-2" value={q.type} onChange={(e) => setFormDraft((p) => ({ ...p, questions: p.questions.map((x) => x.id === q.id ? { ...x, type: e.target.value } : x) }))}><option value="short_text">short_text</option><option value="long_text">long_text</option><option value="single_choice">single_choice</option><option value="multi_choice">multi_choice</option><option value="scale_1_5">scale_1_5</option></select><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={q.required} onChange={(e) => setFormDraft((p) => ({ ...p, questions: p.questions.map((x) => x.id === q.id ? { ...x, required: e.target.checked } : x) }))} />Obligatoria</label>{(q.type === 'single_choice' || q.type === 'multi_choice') && <input className="border rounded p-2 md:col-span-4" placeholder="Opciones separadas por coma" value={(q.options || []).join(', ')} onChange={(e) => setFormDraft((p) => ({ ...p, questions: p.questions.map((x) => x.id === q.id ? { ...x, options: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } : x) }))} />}</div>)}<div className="grid md:grid-cols-3 gap-2">{forms.map((f) => <div key={f.id} className="border rounded p-3"><p className="font-medium">{f.title}</p><p className="text-xs text-gray-500">{f.questions.length} preguntas</p><div className="flex gap-2 mt-2"><Button className="bg-gray-100 border text-gray-700" onClick={() => setFormDraft({ title: f.title, description: f.description || '', questions: f.questions })}>Duplicar</Button><Button className="bg-red-600 text-white" onClick={async () => { await interviewsApi.deleteForm(f.id); loadData(); }}>Eliminar</Button></div></div>)}</div></div>}

          {activeTab === 'hypotheses' && <div className="bg-white rounded-xl border p-4 space-y-2"><div className="flex gap-2"><input className="border rounded p-2" placeholder="Título" value={hypDraft.title} onChange={(e) => setHypDraft({ ...hypDraft, title: e.target.value })} /><Button className="bg-indigo-600 text-white" onClick={async () => { await interviewsApi.createInterviewHypothesis(projectId, campaignId, hypDraft); setHypDraft({ type: 'exploratoria', title: '', description: '', status: 'active', audience_id: '' }); loadData(); }}>Crear hipótesis</Button></div>{hypotheses.map((h) => <div key={h.id} className="border rounded p-2 flex justify-between"><p>{h.title} <span className="text-xs text-gray-500">{h.type}</span></p><Button className="bg-red-600 text-white" onClick={async () => { await interviewsApi.deleteInterviewHypothesis(h.id); loadData(); }}>Eliminar</Button></div>)}</div>}

          {activeTab === 'sessions' && <div className="bg-white rounded-xl border p-4 space-y-3"><div className="grid md:grid-cols-5 gap-2"><select className="border rounded p-2" value={sessionFilter.audience_id} onChange={(e) => setSessionFilter((p) => ({ ...p, audience_id: e.target.value }))}><option value="">Audiencia</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className="border rounded p-2" value={sessionFilter.client_id} onChange={(e) => setSessionFilter((p) => ({ ...p, client_id: e.target.value }))}><option value="">Cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select className="border rounded p-2" value={sessionFilter.status} onChange={(e) => setSessionFilter((p) => ({ ...p, status: e.target.value }))}><option value="">Status</option><option value="draft">draft</option><option value="completed">completed</option></select><input className="border rounded p-2" type="date" value={sessionFilter.from} onChange={(e) => setSessionFilter((p) => ({ ...p, from: e.target.value }))} /><input className="border rounded p-2" type="date" value={sessionFilter.to} onChange={(e) => setSessionFilter((p) => ({ ...p, to: e.target.value }))} /></div>{filteredSessions.map((s) => <button key={s.id} className="w-full border rounded p-3 text-left hover:bg-gray-50" onClick={() => navigate(`/projects/${projectId}/campaigns/${campaignId}/interviews/${s.id}`)}><p className="font-medium">{s.client_name} · {s.form_title}</p><p className="text-xs text-gray-500">{s.status || 'draft'} · {new Date(s.created_at).toLocaleString()}</p></button>)}</div>}
        </div>
      </div>

      {wizardOpen && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-3xl p-4 space-y-3 max-h-[90vh] overflow-auto"><div className="flex justify-between items-center"><h3 className="font-semibold text-lg">Realizar entrevista · Paso {wizardStep}/5</h3><div className="flex gap-2"><Button className="bg-gray-100 text-gray-700 border" onClick={saveDraft}>Guardar borrador</Button><Button className="bg-red-50 text-red-700 border" onClick={() => { if (!wizard.dirty || window.confirm('¿Cerrar y perder cambios no guardados?')) setWizardOpen(false); }}>Cancelar</Button></div></div><div className="h-2 bg-gray-100 rounded"><div className="h-2 bg-indigo-600 rounded" style={{ width: `${(wizardStep / 5) * 100}%` }} /></div>
        {wizardStep === 1 && <select className="border rounded p-2 w-full" value={wizard.audience_id} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, audience_id: e.target.value }))}><option value="">Seleccionar audiencia (opcional)</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        {wizardStep === 2 && <div className="space-y-2"><select className="border rounded p-2 w-full" value={wizard.client_id} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, client_id: e.target.value }))}><option value="">Seleccionar cliente</option>{clients.filter((c) => !wizard.audience_id || String(c.audience_id || '') === String(wizard.audience_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><Button className="bg-white text-indigo-700 border" onClick={() => setClientQuickOpen((v) => !v)}>Crear cliente rápido</Button>{clientQuickOpen && <div className="grid md:grid-cols-2 gap-2 border rounded p-2"><input className="border rounded p-2" placeholder="Nombre" value={clientDraft.name} onChange={(e) => setClientDraft({ ...clientDraft, name: e.target.value })} /><input className="border rounded p-2" placeholder="Contacto" value={clientDraft.contact} onChange={(e) => setClientDraft({ ...clientDraft, contact: e.target.value })} /><Button className="bg-indigo-600 text-white md:col-span-2" onClick={createQuickClient}>Guardar cliente</Button></div>}</div>}
        {wizardStep === 3 && <div className="space-y-2"><select className="border rounded p-2 w-full" value={wizard.form_id} onChange={(e) => { setWizardQuestionIndex(0); setWizard((p) => ({ ...p, dirty: true, form_id: e.target.value, responses: {} })); }}><option value="">Seleccionar formulario</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>{wizardForm && <div className="border rounded p-3"><p className="font-semibold">Preview: {wizardForm.title}</p><p className="text-sm text-gray-500">{wizardQuestions.length} preguntas</p></div>}</div>}
        {wizardStep === 4 && <div className="space-y-2"><select className="border rounded p-2 w-full" value={wizard.interview_hypothesis_id} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, interview_hypothesis_id: e.target.value }))}><option value="">Seleccionar hipótesis (opcional)</option>{hypotheses.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</select><textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={wizard.notes} onChange={(e) => setWizard((p) => ({ ...p, dirty: true, notes: e.target.value }))} /></div>}
        {wizardStep === 5 && currentQuestion && <div className="space-y-3"><p className="text-sm text-gray-500">Pregunta {wizardQuestionIndex + 1} de {wizardQuestions.length}</p><div className="border rounded-xl p-4"><p className="font-semibold">{currentQuestion.title} {currentQuestion.required ? '*' : ''}</p>{renderAnswerInput(currentQuestion)}</div><div className="flex justify-between"><Button className="bg-gray-100 text-gray-700 border" onClick={() => setWizardQuestionIndex((x) => Math.max(0, x - 1))}>Anterior pregunta</Button><Button className="bg-gray-100 text-gray-700 border" onClick={() => setWizardQuestionIndex((x) => Math.min(wizardQuestions.length - 1, x + 1))}>Siguiente pregunta</Button></div></div>}
        <div className="flex justify-between pt-2"><Button className="bg-gray-100 text-gray-700 border" onClick={() => setWizardStep((s) => Math.max(1, s - 1))}>Atrás</Button><div className="flex gap-2">{wizardStep < 5 ? <Button className="bg-indigo-600 text-white" onClick={() => { if (wizardStep === 2 && !wizard.client_id) return toast({ title: 'Selecciona cliente', variant: 'destructive' }); if (wizardStep === 3 && !wizard.form_id) return toast({ title: 'Selecciona formulario', variant: 'destructive' }); setWizardStep((s) => s + 1); }}>Siguiente</Button> : <Button className="bg-emerald-600 text-white" onClick={finishInterview}>Finalizar entrevista</Button>}</div></div>
      </div></div>}
    </>
  );
};

export default InterviewsPage;
