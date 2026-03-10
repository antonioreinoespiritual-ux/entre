import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, MessageSquareText, Tags, Network, Scissors } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { commentsIngestionApi } from '@/services/commentsIngestionApi';

const defaultCodeDraft = { name: '', slug: '', parent_slug: '' };
const defaultIngestionDraft = {
  videoUrl: '',
  videoId: '',
  channelId: '',
  keyword: '',
  maxComments: 100,
  includeReplies: true,
  order: 'time',
};

const parseYouTubeVideoId = (value = '') => {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtu.be')) return (url.pathname || '').replace('/', '').slice(0, 11);
    const v = url.searchParams.get('v') || '';
    if (v) return v.slice(0, 11);
    const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    return embedMatch?.[1] || '';
  } catch {
    return '';
  }
};

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
  const [commentsSubtab, setCommentsSubtab] = useState('ingestion');
  const [commentText, setCommentText] = useState('');
  const [codeDraft, setCodeDraft] = useState(defaultCodeDraft);
  const [ingestionDraft, setIngestionDraft] = useState(defaultIngestionDraft);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [ingestionError, setIngestionError] = useState('');
  const [commentsTable, setCommentsTable] = useState({ loading: false, error: '', items: [], total: 0, limit: 100, offset: 0, q: '' });

  const [store, setStore] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
        youtube_inputs: Array.isArray(parsed.youtube_inputs) ? parsed.youtube_inputs : [],
        youtube_runs: Array.isArray(parsed.youtube_runs) ? parsed.youtube_runs : [],
        youtube_datasets: Array.isArray(parsed.youtube_datasets) ? parsed.youtube_datasets : [],
      };
    } catch {
      return { comments: [], fragments: [], codes: [], youtube_inputs: [], youtube_runs: [], youtube_datasets: [] };
    }
  });

  const persist = (next) => {
    setStore(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const comments = store.comments || [];
  const fragments = store.fragments || [];
  const codes = store.codes || [];
  const youtubeInputs = store.youtube_inputs || [];
  const youtubeRuns = store.youtube_runs || [];

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

  const saveIngestionInput = () => {
    const normalized = {
      ...ingestionDraft,
      id: `yt_input_${Date.now()}`,
      name: ingestionDraft.videoUrl?.trim() || ingestionDraft.videoId?.trim() || ingestionDraft.channelId?.trim() || `input_${youtubeInputs.length + 1}`,
      created_at: new Date().toISOString(),
    };
    persist({ ...store, youtube_inputs: [normalized, ...youtubeInputs] });
  };

  const loadCommentsTable = async ({ offset = commentsTable.offset, q = commentsTable.q } = {}) => {
    try {
      setCommentsTable((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await commentsIngestionApi.listTable({
        projectId,
        campaignId,
        limit: commentsTable.limit,
        offset,
        q,
      });
      setCommentsTable((prev) => ({
        ...prev,
        loading: false,
        items: Array.isArray(data.items) ? data.items : [],
        total: Number(data.total || 0),
        offset,
        q,
      }));
    } catch (error) {
      setCommentsTable((prev) => ({ ...prev, loading: false, error: error.message || 'No se pudo cargar la tabla de comentarios.' }));
    }
  };

  const loadRuns = async () => {
    try {
      const data = await commentsIngestionApi.listRuns({ projectId, campaignId });
      const normalizedRuns = Array.isArray(data.items) ? data.items : [];
      persist({ ...store, youtube_runs: normalizedRuns });
    } catch (error) {
      setIngestionError(error.message || 'No se pudo cargar historial de runs.');
    }
  };

  useEffect(() => {
    if (tab !== 'comments') return;
    if (commentsSubtab === 'table') loadCommentsTable({ offset: 0, q: commentsTable.q });
    if (commentsSubtab === 'ingestion') loadRuns();
  }, [tab, commentsSubtab]);

  const runYouTubeIngestion = async () => {
    setIngestionError('');
    const inferredVideoId = parseYouTubeVideoId(ingestionDraft.videoUrl) || parseYouTubeVideoId(ingestionDraft.videoId);
    const sourceVideoId = inferredVideoId || ingestionDraft.videoId.trim();
    const sourceChannelId = ingestionDraft.channelId.trim();
    if (!sourceVideoId && !sourceChannelId) {
      setIngestionError('Debes configurar video URL / video ID o channel ID para ejecutar la ingesta.');
      return;
    }

    const maxComments = Math.min(1000, Math.max(1, Number(ingestionDraft.maxComments) || 100));
    const includeReplies = Boolean(ingestionDraft.includeReplies);
    const keyword = ingestionDraft.keyword.trim().toLowerCase();
    setIngestionBusy(true);

    try {
      await commentsIngestionApi.runIngestion({
        project_id: projectId,
        campaign_id: campaignId,
        video_url: ingestionDraft.videoUrl,
        video_id: sourceVideoId,
        channel_id: sourceChannelId,
        keyword,
        max_comments: maxComments,
        include_replies: includeReplies,
        order: ingestionDraft.order || 'time',
      });
      await loadRuns();
      await loadCommentsTable({ offset: 0, q: commentsTable.q });
      setCommentsSubtab('table');
    } catch (error) {
      setIngestionError(error.message || 'No se pudo completar la ingesta.');
    } finally {
      setIngestionBusy(false);
    }
  };

  const tabs = [
    { id: 'comments', label: 'Base de comentarios', icon: MessageSquareText },
    { id: 'fragments', label: 'Fragmentos', icon: Scissors },
    { id: 'codes', label: 'Códigos', icon: Tags },
    { id: 'clusters', label: 'Clusters', icon: Network },
  ];

  return (
    <>
      <Helmet><title>Modo comentarios</title></Helmet>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700">
                <ArrowLeft className="mr-1 h-4 w-4" /> Volver a campaña
              </Link>
              <p className="mt-2 text-sm text-slate-500">Proyecto / Campaña / Comentarios</p>
              <h1 className="text-2xl font-bold text-slate-900">Modo comentarios</h1>
              <p className="text-xs text-slate-500">Proyecto {projectId} · Campaña {campaignId}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-indigo-600 text-white" onClick={() => setTab('comments')}>Agregar comentario</Button>
              <Button className="bg-white border text-indigo-700" onClick={() => setTab('codes')}>Crear código</Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Comentarios</p>
              <p className="text-2xl font-semibold text-slate-900">{comments.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Fragmentos</p>
              <p className="text-2xl font-semibold text-slate-900">{fragments.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Códigos</p>
              <p className="text-2xl font-semibold text-slate-900">{codes.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Clusters</p>
              <p className="text-2xl font-semibold text-slate-900">{clusters.length}</p>
            </div>
          </div>

          <div className="bg-white border rounded-xl p-1 flex flex-wrap gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'comments' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Base de comentarios</h2>
              <div className="inline-flex rounded-lg border bg-slate-50 p-1">
                <button type="button" className={`rounded-md px-3 py-1.5 text-xs ${commentsSubtab === 'ingestion' ? 'bg-white text-indigo-700 border' : 'text-slate-600'}`} onClick={() => setCommentsSubtab('ingestion')}>Ingesta</button>
                <button type="button" className={`rounded-md px-3 py-1.5 text-xs ${commentsSubtab === 'table' ? 'bg-white text-indigo-700 border' : 'text-slate-600'}`} onClick={() => setCommentsSubtab('table')}>Tabla de comentarios</button>
              </div>

              {commentsSubtab === 'ingestion' ? (
              <>

              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-indigo-900">Ingesta YouTube (lógica tipo job configurable)</p>
                  <p className="text-xs text-indigo-800">Configura input, ejecuta run y genera dataset reutilizable para la base de comentarios.</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input className="rounded-lg border p-2 text-sm" placeholder="URL de video YouTube" value={ingestionDraft.videoUrl} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoUrl: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Video ID (opcional)" value={ingestionDraft.videoId} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoId: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Channel ID (opcional si no hay video)" value={ingestionDraft.channelId} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, channelId: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" placeholder="Palabra clave (filtro opcional)" value={ingestionDraft.keyword} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, keyword: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" type="number" min={1} max={1000} placeholder="Máximo de comentarios" value={ingestionDraft.maxComments} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, maxComments: e.target.value }))} />
                  <select className="rounded-lg border p-2 text-sm" value={ingestionDraft.order} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, order: e.target.value }))}>
                    <option value="time">Orden: más recientes (time)</option>
                    <option value="relevance">Orden: relevancia (relevance)</option>
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={ingestionDraft.includeReplies} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, includeReplies: e.target.checked }))} />
                  Incluir respuestas (replies)
                </label>
                {ingestionError ? <p className="text-xs text-rose-600">{ingestionError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button className="bg-white border text-slate-700" onClick={saveIngestionInput}>Guardar input</Button>
                  <Button className="bg-indigo-600 text-white" disabled={ingestionBusy} onClick={runYouTubeIngestion}>{ingestionBusy ? 'Ejecutando ingesta…' : 'Ejecutar ingesta'}</Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Inputs guardados</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                      {youtubeInputs.length === 0 ? <p className="text-xs text-slate-500">Sin configuraciones guardadas.</p> : youtubeInputs.map((input) => (
                        <button key={input.id} className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50" onClick={() => setIngestionDraft((prev) => ({ ...prev, ...input }))}>
                          {input.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Runs recientes</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                      {youtubeRuns.length === 0 ? <p className="text-xs text-slate-500">Sin ejecuciones.</p> : youtubeRuns.slice(0, 8).map((run) => (
                        <div key={run.id} className="rounded border px-2 py-1 text-xs">
                          <p className="font-medium text-slate-700">{run.status === 'succeeded' ? '✅' : '❌'} {new Date(run.created_at).toLocaleString()}</p>
                          <p className="text-slate-500">Dataset: {run.dataset_id || '—'} · Importados: {run.imported_count || 0}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <textarea className="w-full rounded-lg border p-3 text-sm" rows={4} placeholder="Pega o escribe un comentario" value={commentText} onChange={(e) => setCommentText((e.target.value))} />
              <div className="flex justify-end"><Button className="bg-indigo-600 text-white" onClick={addComment}>Agregar comentario</Button></div>
              </>
              ) : null}

              {commentsSubtab === 'table' ? (
                <div className="rounded-lg border bg-white overflow-hidden">
                  <div className="p-3 border-b flex flex-wrap items-center gap-2 justify-between">
                    <input className="rounded border px-2 py-1.5 text-sm w-full max-w-sm" placeholder="Buscar texto / autor / id" value={commentsTable.q} onChange={(e) => setCommentsTable((prev) => ({ ...prev, q: e.target.value }))} />
                    <Button className="bg-white border text-slate-700" onClick={() => loadCommentsTable({ offset: 0, q: commentsTable.q })}>Buscar</Button>
                  </div>
                  {commentsTable.error ? <p className="px-3 py-2 text-xs text-rose-600">{commentsTable.error}</p> : null}
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600 text-xs">
                        <tr>
                          <th className="px-3 py-2 text-left">Fuente</th>
                          <th className="px-3 py-2 text-left">Comentario</th>
                          <th className="px-3 py-2 text-left">Autor</th>
                          <th className="px-3 py-2 text-left">Video</th>
                          <th className="px-3 py-2 text-left">Likes</th>
                          <th className="px-3 py-2 text-left">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commentsTable.loading ? (
                          <tr><td className="px-3 py-3 text-slate-500" colSpan={6}>Cargando comentarios...</td></tr>
                        ) : commentsTable.items.length === 0 ? (
                          <tr><td className="px-3 py-3 text-slate-500" colSpan={6}>Sin registros en tabla.</td></tr>
                        ) : commentsTable.items.map((row) => (
                          <tr key={row.id} className="border-t align-top">
                            <td className="px-3 py-2">{row.source}</td>
                            <td className="px-3 py-2 text-slate-800 max-w-[520px]">
                              <p className="line-clamp-3">{row.text}</p>
                              <p className="text-[11px] text-slate-500 mt-1">{row.source_comment_id}</p>
                            </td>
                            <td className="px-3 py-2">{row.author_name || '—'}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.video_id || '—'}</td>
                            <td className="px-3 py-2">{row.like_count || 0}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.published_at ? new Date(row.published_at).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-3 border-t flex items-center justify-between text-xs text-slate-600">
                    <span>Total: {commentsTable.total}</span>
                    <div className="flex gap-2">
                      <Button className="bg-white border" disabled={commentsTable.offset <= 0} onClick={() => loadCommentsTable({ offset: Math.max(0, commentsTable.offset - commentsTable.limit), q: commentsTable.q })}>Anterior</Button>
                      <Button className="bg-white border" disabled={commentsTable.offset + commentsTable.limit >= commentsTable.total} onClick={() => loadCommentsTable({ offset: commentsTable.offset + commentsTable.limit, q: commentsTable.q })}>Siguiente</Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {commentsSubtab === 'ingestion' ? (
              <div className="space-y-2">
                {comments.length === 0 ? <p className="text-sm text-slate-500">Sin comentarios manuales cargados.</p> : comments.map((comment) => (
                  <div key={comment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="text-slate-800">{comment.text}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(comment.created_at).toLocaleString()} {comment.source ? `· ${comment.source}` : ''}</p>
                  </div>
                ))}
              </div>
              ) : null}
            </div>
          )}

          {tab === 'fragments' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Fragmentos</h2>
              {fragments.length === 0 ? <p className="text-sm text-slate-500">No hay fragmentos todavía.</p> : fragments.map((fragment) => (
                <div key={fragment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-800">{fragment.excerpt}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {codes.map((code) => (
                      <button key={code.slug} className={`rounded-full border px-2.5 py-1 text-xs ${fragment.code_slugs.includes(code.slug) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`} onClick={() => toggleFragmentCode(fragment.id, code.slug)}>
                        {code.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'codes' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Códigos</h2>
              <div className="grid gap-2 md:grid-cols-4">
                <input className="rounded-lg border p-2 text-sm" placeholder="Nombre" value={codeDraft.name} onChange={(e) => setCodeDraft((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="rounded-lg border p-2 text-sm" placeholder="Slug (opcional)" value={codeDraft.slug} onChange={(e) => setCodeDraft((prev) => ({ ...prev, slug: e.target.value }))} />
                <select className="rounded-lg border p-2 text-sm" value={codeDraft.parent_slug} onChange={(e) => setCodeDraft((prev) => ({ ...prev, parent_slug: e.target.value }))}>
                  <option value="">Sin padre</option>
                  {codes.map((code) => <option key={code.slug} value={code.slug}>{code.name}</option>)}
                </select>
                <Button className="bg-indigo-600 text-white" onClick={addCode}>Crear código</Button>
              </div>
              <div className="space-y-2">
                {codes.length === 0 ? <p className="text-sm text-slate-500">No hay códigos todavía.</p> : codes.map((code) => (
                  <div key={code.slug} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-medium text-slate-800">{code.name}</p>
                    <p className="text-xs text-slate-500">slug: {code.slug} · padre: {code.parent_slug || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'clusters' && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-slate-900">Clusters</h2>
              <p className="text-sm text-slate-600">Se calculan automáticamente por uso de códigos en fragmentos de comentarios.</p>
              {clusters.length === 0 ? <p className="text-sm text-slate-500">Aún no hay clusters detectados.</p> : clusters.map((cluster) => (
                <div key={cluster.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">{cluster.name}</p>
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
