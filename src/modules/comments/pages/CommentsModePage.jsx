import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, MessageSquareText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const defaultCodeDraft = { name: '', slug: '', parent_slug: '' };

const slugify = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const buildClusters = (codes = [], fragments = []) => {
  const counts = new Map();
  fragments.forEach((fragment) => {
    (fragment.code_slugs || []).forEach((slug) => counts.set(slug, (counts.get(slug) || 0) + 1));
  });
  return codes
    .map((code) => ({
      id: `cluster:${code.slug}`,
      name: `Cluster · ${code.name}`,
      code_slug: code.slug,
      fragments_count: counts.get(code.slug) || 0,
    }))
    .filter((row) => row.fragments_count > 0)
    .sort((a, b) => b.fragments_count - a.fragments_count);
};

const CommentsModePage = () => {
  const { projectId, campaignId } = useParams();
  const storageKey = `comments-mode:${projectId}:${campaignId}`;

  const [tab, setTab] = useState('comments');
  const [commentText, setCommentText] = useState('');
  const [codeDraft, setCodeDraft] = useState(defaultCodeDraft);

  const [store, setStore] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      };
    } catch {
      return { comments: [], fragments: [], codes: [] };
    }
  });

  const persist = (next) => {
    setStore(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const comments = store.comments || [];
  const fragments = store.fragments || [];
  const codes = store.codes || [];

  const clusters = useMemo(() => buildClusters(codes, fragments), [codes, fragments]);

  const addComment = () => {
    const text = commentText.trim();
    if (!text) return;
    const id = `c_${Date.now()}`;
    const comment = { id, text, created_at: new Date().toISOString() };
    const fragment = {
      id: `f_${Date.now()}`,
      comment_id: id,
      excerpt: text.length > 180 ? `${text.slice(0, 180)}…` : text,
      code_slugs: [],
      created_at: new Date().toISOString(),
    };
    persist({ ...store, comments: [comment, ...comments], fragments: [fragment, ...fragments] });
    setCommentText('');
  };

  const addCode = () => {
    const name = codeDraft.name.trim();
    const slug = slugify(codeDraft.slug || name);
    if (!name || !slug) return;
    if (codes.some((code) => code.slug === slug)) return;
    persist({
      ...store,
      codes: [{ id: `code_${Date.now()}`, name, slug, parent_slug: codeDraft.parent_slug || null }, ...codes],
    });
    setCodeDraft(defaultCodeDraft);
  };

  const toggleFragmentCode = (fragmentId, slug) => {
    const nextFragments = fragments.map((fragment) => {
      if (fragment.id !== fragmentId) return fragment;
      const has = (fragment.code_slugs || []).includes(slug);
      return { ...fragment, code_slugs: has ? fragment.code_slugs.filter((item) => item !== slug) : [...(fragment.code_slugs || []), slug] };
    });
    persist({ ...store, fragments: nextFragments });
  };

  return (
    <>
      <Helmet><title>Modo comentarios</title></Helmet>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-6 space-y-4">
          <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="mr-1 h-4 w-4" /> Volver a campaña
          </Link>

          <div className="rounded-2xl border bg-white p-5">
            <div className="flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-indigo-600" />
              <h1 className="text-xl font-semibold">Modo comentarios</h1>
            </div>
            <p className="mt-1 text-sm text-slate-600">Módulo independiente para análisis semántico con flujo: comentarios → fragmentos → códigos → clusters.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['comments', 'Base de comentarios'],
                ['fragments', 'Fragmentos'],
                ['codes', 'Códigos'],
                ['clusters', 'Clusters'],
              ].map(([id, label]) => (
                <Button key={id} className={tab === id ? 'bg-indigo-600 text-white' : 'bg-white border'} onClick={() => setTab(id)}>{label}</Button>
              ))}
            </div>
          </div>

          {tab === 'comments' && (
            <div className="rounded-2xl border bg-white p-5 space-y-3">
              <h2 className="font-semibold">Base de comentarios</h2>
              <textarea className="w-full rounded border p-2" rows={4} placeholder="Pega o escribe un comentario" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
              <div className="flex justify-end"><Button className="bg-indigo-600 text-white" onClick={addComment}>Agregar comentario</Button></div>
              <div className="space-y-2">
                {comments.length === 0 ? <p className="text-sm text-slate-500">Sin comentarios cargados.</p> : comments.map((comment) => (
                  <div key={comment.id} className="rounded border p-2 text-sm">
                    <p>{comment.text}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(comment.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'fragments' && (
            <div className="rounded-2xl border bg-white p-5 space-y-3">
              <h2 className="font-semibold">Fragmentos</h2>
              {fragments.length === 0 ? <p className="text-sm text-slate-500">No hay fragmentos todavía.</p> : fragments.map((fragment) => (
                <div key={fragment.id} className="rounded border p-3">
                  <p className="text-sm">{fragment.excerpt}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {codes.map((code) => (
                      <button key={code.slug} className={`rounded border px-2 py-1 text-xs ${fragment.code_slugs.includes(code.slug) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`} onClick={() => toggleFragmentCode(fragment.id, code.slug)}>
                        {code.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'codes' && (
            <div className="rounded-2xl border bg-white p-5 space-y-3">
              <h2 className="font-semibold">Códigos</h2>
              <div className="grid gap-2 md:grid-cols-4">
                <input className="rounded border p-2" placeholder="Nombre" value={codeDraft.name} onChange={(e) => setCodeDraft((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="rounded border p-2" placeholder="Slug (opcional)" value={codeDraft.slug} onChange={(e) => setCodeDraft((prev) => ({ ...prev, slug: e.target.value }))} />
                <select className="rounded border p-2" value={codeDraft.parent_slug} onChange={(e) => setCodeDraft((prev) => ({ ...prev, parent_slug: e.target.value }))}>
                  <option value="">Sin padre</option>
                  {codes.map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                </select>
                <Button className="bg-indigo-600 text-white" onClick={addCode}>Crear código</Button>
              </div>
              <div className="space-y-2">
                {codes.length === 0 ? <p className="text-sm text-slate-500">No hay códigos todavía.</p> : codes.map((code) => (
                  <div key={code.slug} className="rounded border p-2 text-sm">
                    <p className="font-medium">{code.name}</p>
                    <p className="text-xs text-slate-500">slug: {code.slug} · padre: {code.parent_slug || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'clusters' && (
            <div className="rounded-2xl border bg-white p-5 space-y-3">
              <h2 className="font-semibold">Clusters</h2>
              <p className="text-sm text-slate-600">Se calculan automáticamente por uso de códigos en fragmentos de comentarios.</p>
              {clusters.length === 0 ? <p className="text-sm text-slate-500">Aún no hay clusters detectados.</p> : clusters.map((cluster) => (
                <div key={cluster.id} className="rounded border p-2 text-sm">
                  <p className="font-medium">{cluster.name}</p>
                  <p className="text-xs text-slate-500">Fragmentos: {cluster.fragments_count}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CommentsModePage;
