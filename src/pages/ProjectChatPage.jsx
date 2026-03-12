import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Send, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/contexts/ProjectContext';
import { projectChatApi } from '@/services/projectChatApi';

const ProjectChatPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { fetchProjectById } = useProjects();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [projectData, history] = await Promise.all([
          fetchProjectById(projectId),
          projectChatApi.getHistory({ projectId }),
        ]);
        setProject(projectData || null);
        setMessages(Array.isArray(history?.items) ? history.items : []);
      } catch (err) {
        setError(err?.message || 'No se pudo cargar Chat IA.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchProjectById, projectId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const canSend = useMemo(() => Boolean(input.trim()) && !sending, [input, sending]);

  const onSend = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setError('');

    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const result = await projectChatApi.sendMessage({ projectId, message: text });
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticMessage.id),
        result?.user_message || optimisticMessage,
        result?.assistant_message || {
          id: `temp-assistant-${Date.now()}`,
          role: 'assistant',
          content: 'No se recibió contenido en la respuesta.',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      setError(err?.message || 'No se pudo enviar el mensaje al chat.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Chat IA — {project?.name || 'Proyecto'}</title>
      </Helmet>
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex items-center justify-between rounded-2xl border bg-white p-4 shadow-sm">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Proyecto activo</p>
              <h1 className="text-2xl font-bold text-slate-900">Chat IA — {project?.name || 'Proyecto'}</h1>
              <p className="text-sm text-slate-500">Tessa responde únicamente con contexto del proyecto actual.</p>
            </div>
            <Button className="bg-white text-slate-700 border" onClick={() => navigate(`/projects/${projectId}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver al proyecto
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Contexto restringido</h2>
              <p className="text-sm text-slate-600">Este chat no accede a otros proyectos. Solo usa datos del proyecto activo.</p>
            </aside>

            <section className="rounded-2xl border bg-white shadow-sm">
              <div ref={scrollRef} className="h-[62vh] space-y-3 overflow-y-auto p-4">
                {messages.length ? messages.map((message) => {
                  const isAssistant = message.role === 'assistant';
                  return (
                    <div key={message.id} className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${isAssistant ? 'bg-slate-100 text-slate-800' : 'bg-indigo-600 text-white'}`}>
                        <div className="mb-1 flex items-center gap-2 text-xs opacity-80">
                          {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                          <span>{isAssistant ? 'Tessa' : 'Tú'}</span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    Haz tu primera pregunta sobre este proyecto.
                  </div>
                )}
                {sending ? (
                  <div className="text-xs text-slate-500">Tessa está analizando el proyecto…</div>
                ) : null}
              </div>

              <form onSubmit={onSend} className="border-t p-4">
                {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pregunta algo sobre este proyecto..."
                    className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring"
                  />
                  <Button type="submit" disabled={!canSend} className="bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    <Send className="mr-2 h-4 w-4" /> Enviar
                  </Button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProjectChatPage;
