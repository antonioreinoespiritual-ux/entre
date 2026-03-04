import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const questionTemplate = { id: '', label: '', type: 'short_text', required: false, options: [] };

const InterviewsPage = () => {
  const { projectId, campaignId } = useParams();
  const navigate = useNavigate();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }), []);

  const [audiences, setAudiences] = useState([]);
  const [clients, setClients] = useState([]);
  const [hypotheses, setHypotheses] = useState([]);
  const [forms, setForms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [clientFilterAudienceId, setClientFilterAudienceId] = useState('');

  const [clientForm, setClientForm] = useState({ name: '', contact: '', notes: '', audience_id: '' });
  const [hypForm, setHypForm] = useState({ type: 'exploratoria', title: '', description: '', status: 'active', audience_id: '' });
  const [formBuilder, setFormBuilder] = useState({ title: '', description: '', questions: [] });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizard, setWizard] = useState({ client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} });

  const loadAll = async () => {
    const [aud, cli, hyp, frm, ses] = await Promise.all([
      fetch(`${apiBaseUrl}/api/campaigns/${campaignId}/audiences`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()),
      fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()),
      fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/hypotheses`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()),
      fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/forms`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()),
      fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()),
    ]);
    setAudiences(aud.data || []);
    setClients(cli.data || []);
    setHypotheses(hyp.data || []);
    setForms((frm.data || []).map((f) => ({ ...f, questions_json: Array.isArray(f.questions_json) ? f.questions_json : [] })));
    setSessions((ses.data || []).map((s) => ({ ...s, responses_json: s.responses_json || {} })));
  };

  useEffect(() => { loadAll(); }, [projectId, campaignId]);

  const visibleClients = clientFilterAudienceId ? clients.filter((c) => String(c.audience_id || '') === String(clientFilterAudienceId)) : clients;

  const createClient = async (e) => {
    e.preventDefault();
    await fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, { method: 'POST', headers: authHeaders, body: JSON.stringify(clientForm) });
    setClientForm({ name: '', contact: '', notes: '', audience_id: '' });
    loadAll();
  };

  const createHypothesis = async (e) => {
    e.preventDefault();
    await fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/hypotheses`, { method: 'POST', headers: authHeaders, body: JSON.stringify(hypForm) });
    setHypForm({ type: 'exploratoria', title: '', description: '', status: 'active', audience_id: '' });
    loadAll();
  };

  const addQuestion = () => {
    setFormBuilder((prev) => ({ ...prev, questions: [...prev.questions, { ...questionTemplate, id: `q_${Date.now()}` }] }));
  };

  const updateQuestion = (index, patch) => {
    setFormBuilder((prev) => {
      const next = [...prev.questions];
      next[index] = { ...next[index], ...patch };
      return { ...prev, questions: next };
    });
  };

  const createForm = async (e) => {
    e.preventDefault();
    await fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/forms`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify(formBuilder),
    });
    setFormBuilder({ title: '', description: '', questions: [] });
    loadAll();
  };

  const runInterview = async () => {
    await fetch(`${apiBaseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify(wizard),
    });
    setWizardOpen(false);
    setWizardStep(1);
    setWizard({ client_id: '', form_id: '', interview_hypothesis_id: '', notes: '', responses: {} });
    loadAll();
  };

  const activeForm = forms.find((f) => String(f.id) === String(wizard.form_id));

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <Helmet><title>Modo entrevistas</title></Helmet>
      <div className="max-w-7xl mx-auto space-y-6">
        <Button className="bg-white border text-gray-700" onClick={() => navigate(`/campaigns/${campaignId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver a campaña</Button>

        <div className="bg-white rounded-xl border p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Modo entrevistas</h1>
            <p className="text-sm text-gray-600">Módulo independiente de videos. Vinculado solo a Audiencias.</p>
          </div>
          <Button className="bg-indigo-600 text-white" onClick={() => setWizardOpen(true)}>Realizar entrevista</Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">Clientes</h2>
            <form onSubmit={createClient} className="grid grid-cols-2 gap-2">
              <input className="border rounded p-2" placeholder="Nombre" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} required />
              <input className="border rounded p-2" placeholder="Contacto" value={clientForm.contact} onChange={(e) => setClientForm({ ...clientForm, contact: e.target.value })} />
              <select className="border rounded p-2" value={clientForm.audience_id} onChange={(e) => setClientForm({ ...clientForm, audience_id: e.target.value })}>
                <option value="">Sin audiencia</option>
                {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input className="border rounded p-2" placeholder="Notas" value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} />
              <Button className="bg-blue-600 text-white col-span-2" type="submit">Crear cliente</Button>
            </form>

            <select className="border rounded p-2 w-full" value={clientFilterAudienceId} onChange={(e) => setClientFilterAudienceId(e.target.value)}>
              <option value="">Filtrar por audiencia</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            <div className="space-y-2 max-h-72 overflow-auto">
              {visibleClients.map((c) => (
                <div key={c.id} className="border rounded p-2 text-sm">
                  <p className="font-medium">{c.name} <span className="text-gray-500">({c.audience_name || 'sin audiencia'})</span></p>
                  <p className="text-gray-600">{c.contact || 'sin contacto'}</p>
                  <p className="text-gray-500">Entrevistas: {c.interviews_count || 0}</p>
                  <p className="text-gray-500">{c.notes || 'sin notas'}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">Hipótesis de entrevistas</h2>
            <form onSubmit={createHypothesis} className="grid grid-cols-2 gap-2">
              <select className="border rounded p-2" value={hypForm.type} onChange={(e) => setHypForm({ ...hypForm, type: e.target.value })}>
                <option value="exploratoria">exploratoria</option>
                <option value="validación">validación</option>
              </select>
              <select className="border rounded p-2" value={hypForm.status} onChange={(e) => setHypForm({ ...hypForm, status: e.target.value })}>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="done">done</option>
              </select>
              <input className="border rounded p-2 col-span-2" placeholder="Título" value={hypForm.title} onChange={(e) => setHypForm({ ...hypForm, title: e.target.value })} required />
              <input className="border rounded p-2 col-span-2" placeholder="Descripción" value={hypForm.description} onChange={(e) => setHypForm({ ...hypForm, description: e.target.value })} />
              <select className="border rounded p-2 col-span-2" value={hypForm.audience_id} onChange={(e) => setHypForm({ ...hypForm, audience_id: e.target.value })}>
                <option value="">Sin audiencia</option>
                {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <Button className="bg-purple-600 text-white col-span-2" type="submit">Crear hipótesis</Button>
            </form>
            <div className="space-y-2 max-h-72 overflow-auto">
              {hypotheses.map((h) => <div key={h.id} className="border rounded p-2 text-sm"><p className="font-medium">{h.title}</p><p>{h.type} · {h.status}</p><p className="text-gray-500">{h.audience_name || 'sin audiencia'}</p></div>)}
            </div>
          </section>

          <section className="bg-white rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">Formularios</h2>
            <form onSubmit={createForm} className="space-y-2">
              <input className="border rounded p-2 w-full" placeholder="Título" value={formBuilder.title} onChange={(e) => setFormBuilder({ ...formBuilder, title: e.target.value })} required />
              <input className="border rounded p-2 w-full" placeholder="Descripción" value={formBuilder.description} onChange={(e) => setFormBuilder({ ...formBuilder, description: e.target.value })} />
              <Button type="button" className="bg-gray-700 text-white" onClick={addQuestion}>Agregar pregunta</Button>
              {formBuilder.questions.map((q, idx) => (
                <div key={q.id} className="border rounded p-2 space-y-1">
                  <input className="border rounded p-1 w-full" placeholder="Pregunta" value={q.label} onChange={(e) => updateQuestion(idx, { label: e.target.value })} />
                  <select className="border rounded p-1 w-full" value={q.type} onChange={(e) => updateQuestion(idx, { type: e.target.value })}>
                    <option value="short_text">short_text</option>
                    <option value="long_text">long_text</option>
                    <option value="single_choice">single_choice</option>
                    <option value="multi_choice">multi_choice</option>
                    <option value="scale_1_5">scale_1_5</option>
                  </select>
                  {(q.type === 'single_choice' || q.type === 'multi_choice') ? (
                    <input className="border rounded p-1 w-full" placeholder="Opciones separadas por coma" onChange={(e) => updateQuestion(idx, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                  ) : null}
                </div>
              ))}
              <Button className="bg-emerald-600 text-white" type="submit">Guardar formulario</Button>
            </form>
            <div className="space-y-2 max-h-72 overflow-auto">
              {forms.map((f) => <div key={f.id} className="border rounded p-2 text-sm"><p className="font-medium">{f.title}</p><p>{(f.questions_json || []).length} preguntas</p></div>)}
            </div>
          </section>

          <section className="bg-white rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">Lista global de entrevistas</h2>
            <div className="space-y-2 max-h-96 overflow-auto">
              {sessions.map((s) => (
                <div key={s.id} className="border rounded p-2 text-sm">
                  <p className="font-medium">{new Date(s.conducted_at || s.created_at).toLocaleString()}</p>
                  <p>Cliente: {s.client_name} · Audiencia: {s.audience_name || 'sin audiencia'}</p>
                  <p>Formulario: {s.form_title || '-'}</p>
                  <p>Hipótesis: {s.hypothesis_title || '—'}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {wizardOpen ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl p-4 space-y-3">
            <h3 className="font-semibold">Realizar entrevista</h3>
            {wizardStep === 1 ? (
              <select className="border rounded p-2 w-full" value={wizard.client_id} onChange={(e) => setWizard({ ...wizard, client_id: e.target.value })}>
                <option value="">Seleccionar cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : null}
            {wizardStep === 2 ? (
              <select className="border rounded p-2 w-full" value={wizard.form_id} onChange={(e) => setWizard({ ...wizard, form_id: e.target.value, responses: {} })}>
                <option value="">Seleccionar formulario</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            ) : null}
            {wizardStep === 3 ? (
              <select className="border rounded p-2 w-full" value={wizard.interview_hypothesis_id} onChange={(e) => setWizard({ ...wizard, interview_hypothesis_id: e.target.value })}>
                <option value="">Sin hipótesis</option>
                {hypotheses.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}
              </select>
            ) : null}
            {wizardStep === 4 ? (
              <div className="space-y-2 max-h-80 overflow-auto">
                {(activeForm?.questions_json || []).map((q) => (
                  <div key={q.id} className="border rounded p-2">
                    <p className="text-sm font-medium">{q.label}</p>
                    <input className="border rounded p-1 w-full" value={wizard.responses[q.id] || ''} onChange={(e) => setWizard({ ...wizard, responses: { ...wizard.responses, [q.id]: e.target.value } })} />
                  </div>
                ))}
                <textarea className="border rounded p-2 w-full" rows={3} placeholder="Notas" value={wizard.notes} onChange={(e) => setWizard({ ...wizard, notes: e.target.value })} />
              </div>
            ) : null}

            <div className="flex justify-between">
              <Button className="bg-gray-200 text-gray-800" onClick={() => (wizardStep > 1 ? setWizardStep(wizardStep - 1) : setWizardOpen(false))}>Atrás</Button>
              {wizardStep < 4 ? <Button className="bg-indigo-600 text-white" onClick={() => setWizardStep(wizardStep + 1)}>Siguiente</Button> : <Button className="bg-green-600 text-white" onClick={runInterview}>Guardar entrevista</Button>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default InterviewsPage;
