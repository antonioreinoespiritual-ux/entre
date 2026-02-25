import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Folder, File, Link as LinkIcon, MoveRight, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const CloudPage = () => {
  const { nodeId } = useParams();
  const navigate = useNavigate();
  const [currentNodeId, setCurrentNodeId] = useState(nodeId || null);
  const [search, setSearch] = useState('');
  const [tree, setTree] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);

  const loadTree = async (targetNodeId = currentNodeId, searchText = search) => {
    const q = new URLSearchParams();
    if (targetNodeId) q.set('parentId', targetNodeId);
    if (searchText) q.set('search', searchText);
    const response = await fetch(`${apiBaseUrl}/api/cloud/tree?${q.toString()}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (response.ok) {
      const json = await response.json();
      setTree(json.data || []);
      setBreadcrumbs(json.breadcrumbs || []);
    }
  };

  useEffect(() => {
    setCurrentNodeId(nodeId || null);
  }, [nodeId]);

  useEffect(() => {
    loadTree(currentNodeId, search);
  }, [currentNodeId]);

  const openNode = async (node) => {
    if (node.type === 'folder') {
      setCurrentNodeId(node.id);
      navigate(`/cloud/${node.id}`);
      return;
    }
    if (node.type === 'shortcut') {
      const r = await fetch(`${apiBaseUrl}/api/cloud/download/${node.id}`, { headers: { Authorization: `Bearer ${token()}` } });
      const json = await r.json();
      if (json.link) navigate(json.link);
      return;
    }
  };

  const createFolder = async () => {
    const name = window.prompt('Nombre de carpeta');
    if (!name) return;
    await fetch(`${apiBaseUrl}/api/cloud/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ parentId: currentNodeId, name }),
    });
    await loadTree();
  };

  const renameNode = async (node) => {
    const name = window.prompt('Nuevo nombre', node.name);
    if (!name) return;
    await fetch(`${apiBaseUrl}/api/cloud/node/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ name }),
    });
    await loadTree();
  };


  const moveNode = async (node) => {
    const destination = window.prompt('ID de carpeta destino (vacío = raíz)', node.parent_id || '');
    if (destination === null) return;
    const parentId = destination.trim() || null;
    if (parentId === node.id) {
      window.alert('No puedes mover un nodo dentro de sí mismo.');
      return;
    }
    await fetch(`${apiBaseUrl}/api/cloud/node/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ parentId }),
    });
    await loadTree();
  };

  const removeNode = async (node) => {
    if (!window.confirm(`Eliminar ${node.name}?`)) return;
    await fetch(`${apiBaseUrl}/api/cloud/node/${node.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    await loadTree();
  };

  const uploadFile = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = String(reader.result || '').split(',')[1] || '';
        await fetch(`${apiBaseUrl}/api/cloud/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ parentId: currentNodeId, name: file.name, mimeType: file.type, contentBase64: base64 }),
        });
        await loadTree();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const downloadFile = async (node) => {
    const response = await fetch(`${apiBaseUrl}/api/cloud/download/${node.id}`, { headers: { Authorization: `Bearer ${token()}` } });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      if (json.shortcut) return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const goRoot = () => {
    setCurrentNodeId(null);
    navigate('/cloud');
  };

  const visibleTree = useMemo(() => tree, [tree]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Cloud Drive</title></Helmet>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Button className="bg-gray-800 border border-gray-600 text-white" onClick={() => navigate('/projects')}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>
          <div className="flex items-center gap-2">
            <Button className="bg-indigo-600 text-white" onClick={createFolder}><Plus className="w-4 h-4 mr-2" />Nueva carpeta</Button>
            <Button className="bg-indigo-600 text-white" onClick={uploadFile}>Subir archivo</Button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold">Cloud</h1>
            <Button className="bg-gray-700 text-white" onClick={goRoot}>Ir a raíz</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-gray-300 mb-3">
            <button className="underline" onClick={goRoot}>Cloud</button>
            {breadcrumbs.map((crumb) => <button key={crumb.id} className="underline" onClick={() => { setCurrentNodeId(crumb.id); navigate(`/cloud/${crumb.id}`); }}>/{crumb.name}</button>)}
          </div>
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadTree(currentNodeId, e.currentTarget.value)} className="w-full rounded-lg bg-gray-900 border border-gray-600 pl-8 pr-3 py-2" placeholder="Buscar..." />
          </div>

          {visibleTree.length === 0 ? <p className="text-sm text-gray-400">Sin elementos.</p> : (
            <div className="space-y-2">
              {visibleTree.map((node) => (
                <div key={node.id} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 flex items-center justify-between gap-3">
                  <button className="flex items-center gap-3 text-left flex-1" onClick={() => openNode(node)}>
                    {node.type === 'folder' && <Folder className="w-4 h-4 text-blue-300" />}
                    {node.type === 'file' && <File className="w-4 h-4 text-emerald-300" />}
                    {node.type === 'shortcut' && <LinkIcon className="w-4 h-4 text-purple-300" />}
                    <span>{node.name}</span>
                  </button>
                  <div className="flex gap-2">
                    <Button className="bg-gray-700 text-white" onClick={() => renameNode(node)}>Renombrar</Button>
                    <Button className="bg-gray-700 text-white" onClick={() => moveNode(node)}><MoveRight className="w-4 h-4" /></Button>
                    {node.type === 'file' && <Button className="bg-gray-700 text-white" onClick={() => downloadFile(node)}><Download className="w-4 h-4" /></Button>}
                    <Button className="bg-red-800 text-white" onClick={() => removeNode(node)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CloudPage;
