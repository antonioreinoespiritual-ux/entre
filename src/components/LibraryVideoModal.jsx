import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';
import { baseVideo, fieldMapByType, labels, numericFields } from '@/components/videoFormConfig';

const tabs = ['paid', 'organic', 'live'];
const globalFields = new Set([
  'external_id', 'title', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo',
  'url', 'organic_piece_type', 'campaign_id_ref', 'ad_set_id',
  ...numericFields,
]);

const LibraryVideoModal = ({ isOpen, onClose, mode = 'create', projectId, initialVideo = null, onSaved }) => {
  const { toast } = useToast();
  const { createGlobalVideo, updateVideo } = useVideos();
  const isEdit = mode === 'edit';
  const [activeTab, setActiveTab] = useState('organic');
  const [form, setForm] = useState(baseVideo);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && initialVideo) {
      setActiveTab(initialVideo.video_type || 'organic');
      setForm({ ...baseVideo, ...initialVideo });
    } else {
      setActiveTab('organic');
      setForm(baseVideo);
    }
  }, [isOpen, isEdit, initialVideo]);

  const fields = useMemo(() => fieldMapByType[activeTab].filter((field) => field !== 'audience_id' && globalFields.has(field)), [activeTab]);
  if (!isOpen) return null;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!projectId) {
      toast({ title: 'Error', description: 'projectId es obligatorio', variant: 'destructive' });
      return;
    }

    const payload = {
      ...Object.fromEntries(fields.map((field) => [field, form[field]])),
      project_id: projectId,
      video_type: activeTab,
    };
    numericFields.forEach((field) => {
      if (field in payload) payload[field] = Number(payload[field] || 0);
    });

    setSaving(true);
    try {
      const saved = isEdit ? await updateVideo(initialVideo.id, payload) : await createGlobalVideo(payload);
      toast({ title: isEdit ? 'Video actualizado' : 'Video creado', description: 'Guardado correctamente en biblioteca.' });
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{isEdit ? 'Editar video de biblioteca' : 'Crear video en biblioteca'} ({activeTab.toUpperCase()})</h3>
          <Button className="bg-gray-200 text-gray-700" onClick={onClose}>Cerrar</Button>
        </div>

        <div className="flex gap-2 mb-4">
          {tabs.map((tab) => (
            <Button key={tab} type="button" className={activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)}>
              {tab.toUpperCase()}
            </Button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50">
          {isEdit && (initialVideo?.video_id || initialVideo?.video_id === 0) ? (
            <div>
              <label className="block text-sm font-medium mb-1">video_id</label>
              <input className="w-full rounded-lg border p-2 bg-gray-100" value={String(initialVideo.video_id)} readOnly disabled />
            </div>
          ) : null}

          {fields.map((field) => (
            <div key={field} className={field === 'contexto_cualitativo' ? 'md:col-span-2' : ''}>
              <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
              {field === 'contexto_cualitativo' ? (
                <textarea className="w-full rounded-lg border p-2" rows="2" value={form[field]} onChange={(e) => setForm((c) => ({ ...c, [field]: e.target.value }))} />
              ) : (
                <input
                  type={numericFields.includes(field) ? 'number' : 'text'}
                  className="w-full rounded-lg border p-2"
                  value={form[field] ?? ''}
                  required={field === 'title'}
                  onChange={(e) => setForm((c) => ({ ...c, [field]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" className="bg-gray-200 text-gray-700" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="bg-purple-600 text-white" disabled={saving}>{saving ? 'Guardando...' : (isEdit ? 'Guardar cambios' : 'Crear video')}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LibraryVideoModal;
