import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Folder, File, Link as LinkIcon, Search, Grid2X2, List, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const CloudPage = () => {
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [parentId, setParentId] = useState('');
  const [search, setSearch] = useState('');
  const [globalResults, setGlobalResults] = useState([]);
  const [viewMode, setViewMode] = useState('list');
  const [selected, setSelected] = useState(new Set());
  const [shortcutHint, setShortcutHint] = useState('');

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token()}` }), []);

  const loadOverview = async () => {
    const response = await fetch(`${apiBaseUrl}/api/cloud/projects/${projectId}/overview`, { headers: authHeader });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error || 'No se pudo cargar Cloud');
    setOverview(json);
    const rootId = json?.roots?.projectRoot?.id || '';
    if (!parentId && rootId) setParentId(rootId);
  };

  const loadList = async (nextParentId = parentId, q = search) => {
    if (!projectId || !nextParentId) return;
    setLoading(true);
    setError('');
    try {
      const url = new URL(`${apiBaseUrl}/api/cloud/list`);
      url.searchParams.set('projectId', projectId);
      url.searchParams.set('parentId', nextParentId);
      if (q) url.searchParams.set('search', q);
      const response = await fetch(url.toString(), { headers: authHeader });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'No se pudo listar carpeta');
      setItems(json.data || []);
      setBreadcrumbs(json.breadcrumbs || []);
      setParentId(nextParentId);
      setSelected(new Set());
    } catch (err) {
      setError(err?.message || String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOverview().catch((err) => setError(err.message)); }, [projectId]);
  useEffect(() => { if (parentId) loadList(parentId).catch(() => {}); }, [parentId]);

  const onOpen = async (item) => {
    if (item.kind === 'shortcut') {
      setShortcutHint(item.name);
      await loadList(item.targetId || item.id, search);
      return;
    }
    if (item.kind === 'folder') {
      setShortcutHint('');
      await loadList(item.id, search);
    }
  };

  const createFolder = async () => {
    const name = window.prompt('Nombre de carpeta');
    if (!name) return;
    await fetch(`${apiBaseUrl}/api/cloud/folder`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, parentId, name }),
    });
    await loadList(parentId);
  };

  const renameSelected = async () => {
    const first = [...selected][0];
    if (!first) return;
    const current = items.find((i) => i.id === first);
    const name = window.prompt('Nuevo nombre', current?.name || '');
    if (!name) return;
    await fetch(`${apiBaseUrl}/api/cloud/node/${first}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadList(parentId);
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Eliminar ${selected.size} item(s)?`)) return;
    for (const id of selected) {
      const url = new URL(`${apiBaseUrl}/api/cloud/node/${id}`);
      url.searchParams.set('parentId', parentId);
      await fetch(url.toString(), { method: 'DELETE', headers: authHeader });
    }
    await loadList(parentId);
  };

  const uploadFiles = async (event) => {
    const files = [...(event.target.files || [])];
    for (const file of files) {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('parentId', parentId);
      fd.append('file', file);
      await fetch(`${apiBaseUrl}/api/cloud/upload`, { method: 'POST', headers: authHeader, body: fd });
    }
    event.target.value = '';
    await loadList(parentId);
  };

  const runSearch = async () => {
    const url = new URL(`${apiBaseUrl}/api/cloud/search`);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('q', search);
    const response = await fetch(url.toString(), { headers: authHeader });
    const json = await response.json();
    setGlobalResults(json.data || []);
  };

  const isHypothesisVideosContainer = breadcrumbs.at(-1)?.name === 'Videos' && breadcrumbs.some((b) => b.name === 'Hipótesis');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Cloud Explorer</title></Helmet>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex gap-2 items-center">
          <Button className="bg-gray-800 border border-gray-600" onClick={() => navigate(`/projects/${projectId}`)}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>
          <Button className="bg-indigo-600" onClick={createFolder}>Nueva carpeta</Button>
          <Button className="bg-gray-700" onClick={renameSelected} disabled={selected.size !== 1}>Renombrar</Button>
          <Button className="bg-red-700" onClick={deleteSelected} disabled={!selected.size}>Borrar</Button>
          <label className={`px-3 py-2 rounded text-sm ${isHypothesisVideosContainer ? 'bg-gray-600 cursor-not-allowed' : 'bg-emerald-700 cursor-pointer'}`}>
            Subir
            <input type="file" multiple className="hidden" onChange={uploadFiles} disabled={isHypothesisVideosContainer} />
          </label>
          <Button className="bg-gray-700" onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>{viewMode === 'list' ? <Grid2X2 className="w-4 h-4" /> : <List className="w-4 h-4" />}</Button>
        </div>

        <div className="flex gap-2 items-center text-sm">
          {breadcrumbs.map((crumb, idx) => (
            <button key={crumb.id} className="hover:underline" onClick={() => loadList(crumb.id)}>{idx ? ' / ' : ''}{crumb.name}</button>
          ))}
          {shortcutHint ? <span className="text-indigo-300">(shortcut: {shortcutHint})</span> : null}
        </div>

        <div className="flex gap-2">
          <div className="flex-1 relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded pl-8 pr-2 py-2" placeholder="Buscar en carpeta o proyecto" /></div>
          <Button className="bg-gray-700" onClick={() => loadList(parentId, search)}>Buscar carpeta</Button>
          <Button className="bg-gray-700" onClick={runSearch}>Buscar proyecto</Button>
        </div>

        {globalResults.length ? <div className="text-xs text-gray-300">Resultados proyecto: {globalResults.map((r) => r.name).join(', ')}</div> : null}
        {error ? <p className="text-red-300">{error}</p> : null}
        {loading ? <p>Cargando...</p> : null}

        <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 gap-3' : 'space-y-2'}>
          {items.map((item) => (
            <div key={`${parentId}-${item.id}`} className="border border-gray-700 rounded p-3 bg-gray-800/60 flex items-center gap-2">
              <input type="checkbox" checked={selected.has(item.id)} onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(item.id); else next.delete(item.id);
                setSelected(next);
              }} />
              <button className="flex-1 flex items-center gap-2 text-left" onClick={() => onOpen(item)}>
                {item.kind === 'shortcut' ? <LinkIcon className="w-4 h-4 text-indigo-300" /> : item.kind === 'folder' ? <Folder className="w-4 h-4 text-blue-300" /> : <File className="w-4 h-4 text-gray-300" />}
                <span>{item.name}</span>
              </button>
              {item.kind === 'file' ? <a href={`${apiBaseUrl}/api/cloud/download?nodeId=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer"><Download className="w-4 h-4" /></a> : null}
              <span className="text-xs text-gray-400">{item.kind}</span>
              <span className="text-xs text-gray-400">{item.size || '-'}</span>
            </div>
          ))}
        </div>

        {!overview ? null : <div className="text-xs text-gray-400">Proyecto: {overview.project?.name}</div>}
      </div>
    </div>
  );
};

export default CloudPage;
