import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowLeft, BookOpenText, MessageSquareText, Tags, Network, Scissors } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { commentsIngestionApi } from '@/services/commentsIngestionApi';
import { Toolbar } from '@/modules/interviews/components/editor-toolbar/Toolbar';

const defaultCodeDraft = { name: '', slug: '', parent_slug: '' };
const defaultIngestionDraft = {
  videoUrl: '',
  videoId: '',
  channelId: '',
  keyword: '',
  videoSearchQuery: '',
  videosLimit: '',
  commentsPerVideo: 100,
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
  const [codeDraft, setCodeDraft] = useState(defaultCodeDraft);
  const [ingestionDraft, setIngestionDraft] = useState(defaultIngestionDraft);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [ingestionError, setIngestionError] = useState('');
  const [ingestionInputs, setIngestionInputs] = useState([]);
  const [ingestionRuns, setIngestionRuns] = useState([]);
  const [commentsTable, setCommentsTable] = useState({ loading: false, error: '', items: [], total: 0, limit: 100, offset: 0, q: '' });
  const [readerViewMode, setReaderViewMode] = useState('document');
  const [readerSelectionText, setReaderSelectionText] = useState('');
  const [selectedReaderCommentId, setSelectedReaderCommentId] = useState('');

  const [store, setStore] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        fragments: Array.isArray(parsed.fragments) ? parsed.fragments : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      };
    } catch {
      return { fragments: [], codes: [] };
    }
  });

  const persist = (next) => {
    setStore(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const fragments = store.fragments || [];
  const codes = store.codes || [];
  const readerComments = commentsTable.items || [];

  const selectedReaderComment = useMemo(() => {
    if (!readerComments.length) return null;
    const selected = readerComments.find((item) => String(item.id) === String(selectedReaderCommentId));
    return selected || readerComments[0] || null;
  }, [readerComments, selectedReaderCommentId]);

  const clusters = useMemo(() => buildClusters(codes, fragments), [codes, fragments]);

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

  const createCommentFragment = ({ text, comment }) => {
    const excerpt = String(text || '').trim();
    if (!excerpt || !comment) return;
    const nextFragment = {
      id: `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      excerpt,
      comment_id: comment.id,
      source_comment_id: comment.source_comment_id,
      video_id: comment.video_id || null,
      code_slugs: [],
      created_at: new Date().toISOString(),
    };
    persist({
      ...store,
      fragments: [nextFragment, ...fragments],
    });
    setReaderSelectionText('');
  };

  const loadInputs = async () => {
    try {
      const data = await commentsIngestionApi.listInputs({ projectId, campaignId });
      setIngestionInputs(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setIngestionError(error.message || 'No se pudieron cargar inputs guardados.');
    }
  };

  const saveIngestionInput = async () => {
    setIngestionError('');
    const inferredVideoId = parseYouTubeVideoId(ingestionDraft.videoUrl) || parseYouTubeVideoId(ingestionDraft.videoId);
    const sourceVideoId = inferredVideoId || ingestionDraft.videoId.trim();
    const sourceChannelId = ingestionDraft.channelId.trim();
    const videoSearchQuery = ingestionDraft.videoSearchQuery.trim();
    const commentsPerVideo = Number(ingestionDraft.commentsPerVideo);
    const videosLimit = ingestionDraft.videosLimit === '' ? null : Number(ingestionDraft.videosLimit);

    if (!Number.isFinite(commentsPerVideo) || commentsPerVideo <= 0) {
      setIngestionError('Comentarios por video es obligatorio y debe ser mayor que 0.');
      return;
    }
    if (videosLimit != null && (!Number.isFinite(videosLimit) || videosLimit <= 0)) {
      setIngestionError('Cantidad de videos debe ser mayor que 0 cuando se informa.');
      return;
    }

    try {
      const saved = await commentsIngestionApi.saveInput({
        project_id: projectId,
        campaign_id: campaignId,
        name: ingestionDraft.videoUrl?.trim() || ingestionDraft.videoId?.trim() || ingestionDraft.channelId?.trim() || ingestionDraft.videoSearchQuery?.trim() || `input_${ingestionInputs.length + 1}`,
        video_url: ingestionDraft.videoUrl,
        video_id: sourceVideoId,
        channel_id: sourceChannelId,
        keyword: ingestionDraft.keyword,
        video_search_query: videoSearchQuery,
        videos_limit: videosLimit,
        comments_per_video: commentsPerVideo,
        max_comments: commentsPerVideo,
        include_replies: ingestionDraft.includeReplies,
        order: ingestionDraft.order,
      });
      setIngestionInputs((prev) => [saved, ...prev.filter((row) => row.id !== saved.id)]);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo guardar input.');
    }
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
      setIngestionRuns(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo cargar historial de runs.');
    }
  };

  const deleteRun = async (runId) => {
    if (!runId) return;
    if (!window.confirm('¿Eliminar este run? También se eliminarán su input asociado y sus comentarios de la base total.')) return;
    try {
      await commentsIngestionApi.deleteRun({ runId, projectId, campaignId });
      await Promise.all([loadRuns(), loadInputs(), loadCommentsTable({ offset: 0, q: commentsTable.q })]);
    } catch (error) {
      setIngestionError(error.message || 'No se pudo eliminar el run.');
    }
  };

  useEffect(() => {
    if (tab !== 'comments' && tab !== 'reader') return;
    loadCommentsTable({ offset: commentsTable.offset, q: commentsTable.q });
    if (commentsSubtab === 'table') loadCommentsTable({ offset: 0, q: commentsTable.q });
    if (commentsSubtab === 'ingestion') {
      loadRuns();
      loadInputs();
    }
  }, [tab, commentsSubtab]);

  useEffect(() => {
    if (!selectedReaderCommentId && readerComments.length) {
      setSelectedReaderCommentId(String(readerComments[0].id));
      return;
    }
    if (selectedReaderCommentId && !readerComments.some((item) => String(item.id) === String(selectedReaderCommentId))) {
      setSelectedReaderCommentId(readerComments[0] ? String(readerComments[0].id) : '');
    }
  }, [readerComments, selectedReaderCommentId]);

  const captureReaderSelection = () => {
    const selection = window.getSelection?.();
    const text = String(selection?.toString() || '').trim();
    setReaderSelectionText(text);
  };

  const runYouTubeIngestion = async () => {
    setIngestionError('');
    const inferredVideoId = parseYouTubeVideoId(ingestionDraft.videoUrl) || parseYouTubeVideoId(ingestionDraft.videoId);
    const sourceVideoId = inferredVideoId || ingestionDraft.videoId.trim();
    const sourceChannelId = ingestionDraft.channelId.trim();
    const videoSearchQuery = ingestionDraft.videoSearchQuery.trim();

    const commentsPerVideo = Number(ingestionDraft.commentsPerVideo);
    if (!Number.isFinite(commentsPerVideo) || commentsPerVideo <= 0) {
      setIngestionError('Comentarios por video es obligatorio y debe ser mayor que 0.');
      return;
    }

    const videosLimit = ingestionDraft.videosLimit === '' ? null : Number(ingestionDraft.videosLimit);
    if (videosLimit != null && (!Number.isFinite(videosLimit) || videosLimit <= 0)) {
      setIngestionError('Cantidad de videos debe ser mayor que 0 cuando se informa.');
      return;
    }

    const maxComments = Math.min(1000, Math.max(1, Number(commentsPerVideo) || 100));
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
        video_search_query: videoSearchQuery,
        videos_limit: videosLimit,
        comments_per_video: commentsPerVideo,
        keyword,
        max_comments: maxComments,
        include_replies: includeReplies,
        order: ingestionDraft.order || 'time',
      });
      await loadRuns();
      await loadInputs();
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
    { id: 'reader', label: 'Lector', icon: BookOpenText },
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
              <Button className="bg-indigo-600 text-white" onClick={() => setTab('reader')}>Abrir lector</Button>
              <Button className="bg-white border text-indigo-700" onClick={() => setTab('codes')}>Crear código</Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs text-slate-500">Comentarios</p>
              <p className="text-2xl font-semibold text-slate-900">{commentsTable.total}</p>
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
                  <input className="rounded-lg border p-2 text-sm" placeholder="Búsqueda de videos en YouTube (opcional)" value={ingestionDraft.videoSearchQuery} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videoSearchQuery: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" type="number" min={1} max={50} placeholder="Cantidad de videos (opcional)" value={ingestionDraft.videosLimit} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, videosLimit: e.target.value }))} />
                  <input className="rounded-lg border p-2 text-sm" type="number" min={1} max={500} placeholder="Comentarios por video (obligatorio)" value={ingestionDraft.commentsPerVideo} onChange={(e) => setIngestionDraft((prev) => ({ ...prev, commentsPerVideo: e.target.value }))} required />
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
                      {ingestionInputs.length === 0 ? <p className="text-xs text-slate-500">Sin configuraciones guardadas.</p> : ingestionInputs.map((input) => (
                        <button key={input.id} className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50" onClick={() => setIngestionDraft((prev) => ({
                          ...prev,
                          videoUrl: input?.config?.video_url || '',
                          videoId: input?.config?.video_id || '',
                          channelId: input?.config?.channel_id || '',
                          keyword: input?.config?.keyword || '',
                          videoSearchQuery: input?.config?.video_search_query || '',
                          videosLimit: input?.config?.videos_limit ?? '',
                          commentsPerVideo: input?.config?.comments_per_video ?? input?.config?.max_comments ?? 100,
                          includeReplies: Boolean(input?.config?.include_replies),
                          order: input?.config?.order || 'time',
                        }))}>
                          {input.name || 'Input'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Runs recientes</p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                      {ingestionRuns.length === 0 ? <p className="text-xs text-slate-500">Sin ejecuciones.</p> : ingestionRuns.slice(0, 8).map((run) => (
                        <div key={run.id} className="rounded border px-2 py-1 text-xs">
                          <p className="font-medium text-slate-700">{run.status === 'succeeded' ? '✅' : run.status === 'running' ? '⏳' : '❌'} {new Date(run.created_at).toLocaleString()}</p>
                          <p className="text-slate-500">Input: {run.input_name || run.input_id || '—'} · Importados: {run.imported_count || 0}</p>
                          <div className="mt-1 flex justify-end">
                            <button type="button" className="text-[11px] text-rose-600 hover:underline" onClick={() => deleteRun(run.id)}>Eliminar run</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

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

            </div>
          )}

          {tab === 'reader' && (
            <div className="rounded-xl border bg-[#f8fafc] p-4 space-y-3">
              <div>
                <h2 className="font-semibold text-slate-900">Lector</h2>
                <p className="text-xs text-slate-500">Lector semántico de comentarios para extraer fragmentos desde la base de comentarios.</p>
              </div>
              <Toolbar
                collapsed={false}
                onBackToCloud={() => setTab('comments')}
                onDownloadDocument={() => loadCommentsTable({ offset: 0, q: commentsTable.q })}
                onCreateFragment={() => createCommentFragment({ text: readerSelectionText, comment: selectedReaderComment })}
                onCreateManualFragment={() => {
                  const manualText = window.prompt('Nuevo fragmento manual');
                  if (!manualText) return;
                  createCommentFragment({ text: manualText, comment: selectedReaderComment || readerComments[0] });
                }}
                onViewFragments={() => setTab('fragments')}
                onViewCodes={() => setTab('codes')}
                onLinkCode={() => setTab('codes')}
                onViewClusters={() => setTab('clusters')}
                onActivateAnalysis={() => setTab('comments')}
                onCreateMemo={() => {
                  const memoText = window.prompt('Memo de lectura');
                  if (!memoText) return;
                  createCommentFragment({ text: memoText, comment: selectedReaderComment || readerComments[0] });
                }}
                onToggleView={() => setReaderViewMode((prev) => (prev === 'document' ? 'focus' : 'document'))}
                canCreateFragment={Boolean(readerSelectionText && selectedReaderComment)}
                viewLabel={readerViewMode === 'focus' ? 'focus' : 'comentario'}
              />
              <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="rounded-xl border bg-white p-2 max-h-[560px] overflow-auto">
                  <p className="px-2 py-1 text-xs font-semibold text-slate-500">Comentarios ({readerComments.length})</p>
                  <div className="space-y-1.5">
                    {readerComments.length === 0 ? <p className="px-2 py-3 text-xs text-slate-500">No hay comentarios cargados.</p> : readerComments.map((comment) => (
                      <button
                        type="button"
                        key={comment.id}
                        className={`w-full rounded-lg border p-2 text-left text-xs ${String(selectedReaderComment?.id) === String(comment.id) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        onClick={() => {
                          setSelectedReaderCommentId(String(comment.id));
                          setReaderSelectionText('');
                        }}
                      >
                        <p className="line-clamp-2 text-slate-700">{comment.text || 'Sin texto'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{comment.author_name || 'Autor desconocido'} · {comment.video_id || 'sin video'}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border bg-white shadow-sm">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Comentario seleccionado</p>
                    <p className="text-xs text-slate-500">Selecciona texto y usa “Crear fragmento” en la barra de tareas.</p>
                  </div>
                  <div
                    className={`min-h-[320px] max-h-[560px] overflow-auto text-slate-800 whitespace-pre-wrap ${readerViewMode === 'focus' ? 'px-10 py-8 text-[16px] leading-8' : 'px-6 py-5 text-[14px] leading-7'}`}
                    onMouseUp={captureReaderSelection}
                  >
                    {selectedReaderComment?.text || 'Selecciona un comentario de la lista para comenzar.'}
                  </div>
                  <div className="border-t px-4 py-2 text-xs text-slate-600 flex flex-wrap items-center gap-2">
                    <span>Fuente: {selectedReaderComment?.source || 'youtube'}</span>
                    <span>·</span>
                    <span>Autor: {selectedReaderComment?.author_name || '—'}</span>
                    <span>·</span>
                    <span>Video: {selectedReaderComment?.video_id || '—'}</span>
                    {readerSelectionText ? <span className="ml-auto rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">Selección lista ({readerSelectionText.length} chars)</span> : null}
                  </div>
                </div>
              </div>
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
