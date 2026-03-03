import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { parseAndValidateBulkVideoJson } from '@/lib/bulkVideoUpdates';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const BulkVideoUpdateModal = ({ triggerClassName, onApplied }) => {
  const { toast } = useToast();
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkPayload, setBulkPayload] = useState(null);

  const closeModal = () => {
    if (bulkApplying) return;
    setShowBulkModal(false);
    setBulkInput('');
    setBulkPreview(null);
    setBulkPayload(null);
  };

  const runBulkValidation = () => {
    const parsed = parseAndValidateBulkVideoJson(bulkInput);
    if (!parsed.ok || !parsed.payload) {
      setBulkPayload(null);
      setBulkPreview({ received: 0, applicable: 0, not_found: 0, invalid: parsed.errors?.length || 1, results: [] });
      toast({ title: 'Validación fallida', description: parsed.errors?.[0] || 'Corrige el JSON para continuar', variant: 'destructive' });
      return;
    }

    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    fetch(`${apiBaseUrl}/api/videos/bulk-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
      body: JSON.stringify({ ...parsed.payload, dryRun: true }),
    })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'No se pudo validar en backend');
        setBulkPayload(parsed.payload);
        setBulkPreview(json);
        toast({ title: 'Validación OK', description: `Applicable: ${json.applicable || 0} · Not found: ${json.not_found || 0}` });
      })
      .catch((error) => {
        setBulkPayload(null);
        setBulkPreview({ received: 0, applicable: 0, not_found: 0, invalid: 1, results: [] });
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      });
  };

  const applyBulkUpdate = async () => {
    if (!bulkPayload) return;
    const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
    setBulkApplying(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/videos/bulk-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify(bulkPayload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudo aplicar actualización masiva');
      const updatedCount = (json.results || []).filter((row) => row.status === 'updated').length;
      toast({ title: 'Actualización masiva completada', description: `Actualizados ${updatedCount}/${json.received || 0}` });
      if (onApplied) await onApplied(json);
      closeModal();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setBulkApplying(false);
    }
  };

  return (
    <>
      <Button className={triggerClassName} onClick={() => setShowBulkModal(true)} disabled={bulkApplying}>
        <Upload className="w-4 h-4 mr-2" />
        {bulkApplying ? 'Aplicando...' : 'Actualización masiva'}
      </Button>

      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl rounded-2xl border border-cyan-700/60 bg-slate-950/95 shadow-[0_0_50px_rgba(34,211,238,0.25)] p-6 text-slate-100">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-2xl font-semibold text-cyan-300">Actualización masiva</h3>
                <p className="text-sm text-slate-300">Pega el JSON de updates y valida antes de aplicar.</p>
              </div>
              <Button className="bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={closeModal} disabled={bulkApplying}><X className="w-4 h-4" /></Button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <label className="block text-sm font-medium text-cyan-200 mb-2">JSON DE UPDATES</label>
                <textarea
                  className="w-full min-h-[320px] rounded-lg border border-slate-700 bg-slate-950 text-slate-100 p-3 font-mono text-sm"
                  value={bulkInput}
                  onChange={(event) => setBulkInput(event.target.value)}
                  placeholder='{"updates":[{"video_id":"...","fields":{"views":1200,"clicks":"45"}}]}'
                />
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <h4 className="text-sm font-medium text-cyan-200 mb-2">Previsualización</h4>
                {!bulkPreview ? (
                  <p className="text-sm text-slate-400">Aún no validado.</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-700 p-2">Recibidos: <b>{bulkPreview.received || 0}</b></div>
                      <div className="rounded-lg border border-slate-700 p-2">Applicable: <b>{bulkPreview.applicable || 0}</b></div>
                      <div className="rounded-lg border border-slate-700 p-2">Inválidos: <b>{bulkPreview.invalid || 0}</b></div>
                      <div className="rounded-lg border border-slate-700 p-2">No encontrados: <b>{bulkPreview.not_found || 0}</b></div>
                    </div>

                    <div className="max-h-[200px] overflow-auto rounded-lg border border-slate-700">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-800 sticky top-0">
                          <tr><th className="text-left p-2">inputIndex</th><th className="text-left p-2">Estado</th><th className="text-left p-2">identifierUsed</th><th className="text-left p-2">matchedVideoId</th><th className="text-left p-2">Fields</th><th className="text-left p-2">Reason</th></tr>
                        </thead>
                        <tbody>
                          {(bulkPreview.results || []).map((row) => (
                            <tr key={`${row.inputIndex}-${row.identifierUsed || 'none'}`} className="border-t border-slate-800">
                              <td className="p-2">{row.inputIndex}</td>
                              <td className="p-2">{row.status}</td>
                              <td className="p-2">{row.identifierUsed || '-'}</td>
                              <td className="p-2">{row.matchedVideoId || '-'}</td>
                              <td className="p-2">{(row.updatedFields || []).join(', ') || '-'}</td>
                              <td className="p-2">{row.error || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">Identificador prioritario: video_id -&gt; session_id -&gt; video_name.</p>
              <div className="flex items-center gap-2">
                <Button className="bg-cyan-700 hover:bg-cyan-600 text-white" onClick={runBulkValidation} disabled={bulkApplying}>Validar</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-500 text-white" disabled={!bulkPayload || bulkApplying} onClick={applyBulkUpdate}>{bulkApplying ? 'Aplicando...' : 'Aplicar'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkVideoUpdateModal;
