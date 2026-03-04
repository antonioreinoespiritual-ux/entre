import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Folder, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';

function token() {
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null')?.access_token || ''; } catch { return ''; }
}

const CloudPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const projectId = searchParams.get('projectId') || '';

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cloud/projects/${projectId}/overview`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'No se pudo cargar Cloud');
      setData(json);
    } catch (err) {
      setError(err?.message || String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const runSync = async () => {
    if (!projectId) return;
    await fetch(`${apiBaseUrl}/api/cloud/sync?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
    });
    await load();
  };

  useEffect(() => {
    load();
  }, [projectId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-gray-100 p-6">
      <Helmet><title>Cloud del Proyecto</title></Helmet>
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Button className="bg-gray-800 border border-gray-600 text-white" onClick={() => navigate('/projects')}><ArrowLeft className="w-4 h-4 mr-2" />Volver</Button>
          <Button className="bg-indigo-600 text-white" onClick={runSync} disabled={!projectId || loading}>Sincronizar Cloud</Button>
        </div>

        <div className="rounded-2xl border border-gray-700 bg-gray-800/80 p-4">
          <h1 className="text-2xl font-bold">Cloud (mínimo)</h1>
          <p className="text-sm text-gray-300 mt-1">Proyecto: {projectId || 'Selecciona projectId en la URL: /cloud?projectId=...'}</p>
        </div>

        {loading ? <p className="text-sm text-gray-300">Cargando...</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {data ? (
          <>
            <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-4">
              <h2 className="font-semibold mb-3">Biblioteca de videos (canonical)</h2>
              {(data.videos || []).length === 0 ? <p className="text-sm text-gray-400">Sin carpetas de video.</p> : (
                <div className="space-y-2">
                  {data.videos.map((node) => (
                    <div key={node.id} className="rounded border border-gray-700 bg-gray-900/40 p-2 flex items-center gap-2">
                      <Folder className="w-4 h-4 text-blue-300" />
                      <span>{node.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-700 bg-gray-800/80 p-4">
              <h2 className="font-semibold mb-3">Hipótesis (links a videos)</h2>
              {(data.hypotheses || []).length === 0 ? <p className="text-sm text-gray-400">Sin hipótesis.</p> : (
                <div className="space-y-4">
                  {data.hypotheses.map((item) => (
                    <div key={item.hypothesis_root?.id || Math.random()} className="rounded border border-gray-700 bg-gray-900/40 p-3">
                      <p className="font-medium">{item.hypothesis_root?.name || 'Hipótesis'}</p>
                      {(item.links || []).length === 0 ? <p className="text-sm text-gray-400 mt-1">Sin videos vinculados.</p> : (
                        <ul className="mt-2 space-y-1">
                          {item.links.map((link) => (
                            <li key={link.id} className="text-sm flex items-center gap-2"><LinkIcon className="w-4 h-4 text-indigo-300" />{link.child_name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default CloudPage;
