import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';
import { baseVideo, fieldMapByType, labels, numericFields } from '@/components/videoFormConfig';

const tabs = ['paid', 'organic', 'live'];
const contextOnlyFields = new Set(['audience_id']);
const contextReferenceFields = new Set(['external_id', 'title', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo']);
const libraryForbiddenPayloadFields = new Set(['audience_id', 'hypothesis_id', 'id', 'user_id', 'project_id', 'campaign_id', 'created_at', 'updated_at']);

const VideoCreateModal = ({
  isOpen,
  onClose,
  mode = 'create',
  context = 'hypothesis',
  defaultType = 'organic',
  projectId,
  hypothesisId,
  initialVideo = null,
  onCreated,
  onSaved,
  audiences = [],
}) => {
  const { toast } = useToast();
  const { createGlobalVideo, updateVideo, updateHypothesisVideoContext, linkVideosToHypothesis } = useVideos();
  const isEditMode = mode === 'edit';
  const isLibraryContext = context === 'library';
  const [activeTab, setActiveTab] = useState(defaultType || 'organic');
  const [form, setForm] = useState(baseVideo);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode && initialVideo) {
      setActiveTab(initialVideo.video_type || initialVideo.type || defaultType || 'organic');
      setForm({ ...baseVideo, ...initialVideo });
      return;
    }
    setActiveTab(defaultType || 'organic');
    setForm(baseVideo);
  }, [isOpen, defaultType, initialVideo, isEditMode]);

  if (!isOpen) return null;

  const isFieldEditable = (field) => {
    if (isLibraryContext) return field !== 'audience_id';
    if (contextOnlyFields.has(field)) return true;
    if (isEditMode) return false;
    return field === 'title' || field === 'external_id';
  };

  const visibleFields = isLibraryContext
    ? fieldMapByType[activeTab].filter((field) => field !== 'audience_id')
    : fieldMapByType[activeTab].filter((field) => !numericFields.includes(field) && contextReferenceFields.has(field) || field === 'audience_id');

  const renderInput = (field) => {
    const editable = isFieldEditable(field);
    if (field === 'audience_id') {
      return (
        <select className="w-full rounded-lg border p-2" disabled={!editable} value={form.audience_id} onChange={(e) => setForm((current) => ({ ...current, audience_id: e.target.value }))}>
          <option value="">Sin público</option>
          {audiences.map((aud) => <option key={aud.id} value={aud.id}>{aud.name}</option>)}
        </select>
      );
    }

    if (field === 'contexto_cualitativo') {
      return <textarea className="w-full rounded-lg border p-2" rows="2" disabled={!editable} value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} />;
    }

    const isNumeric = numericFields.includes(field);
    return <input type={isNumeric ? 'number' : 'text'} className="w-full rounded-lg border p-2" required={field === 'title'} disabled={!editable} value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} />;
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (!isEditMode && isLibraryContext && !projectId) {
      toast({ title: 'Error', description: 'projectId es obligatorio para biblioteca', variant: 'destructive' });
      return;
    }
    if (!isLibraryContext && (!hypothesisId || !projectId)) {
      toast({ title: 'Error', description: 'projectId e hypothesisId son obligatorios para contexto hipótesis', variant: 'destructive' });
      return;
    }

    const payload = { ...form, video_type: activeTab };
    numericFields.forEach((field) => { payload[field] = Number(payload[field] || 0); });

    setSubmitting(true);
    try {
      if (isEditMode) {
        let updated = null;
        if (isLibraryContext) {
          const updatePayload = Object.fromEntries(Object.entries(payload).filter(([field]) => !libraryForbiddenPayloadFields.has(field)));
          updated = await updateVideo(initialVideo.id, updatePayload);
        } else {
          updated = await updateHypothesisVideoContext(hypothesisId, initialVideo.id, { audience_id: payload.audience_id });
        }
        toast({ title: 'Video actualizado', description: 'Cambios guardados correctamente.' });
        if (onSaved) await onSaved(updated);
      } else if (isLibraryContext) {
        const createPayload = Object.fromEntries(Object.entries(payload).filter(([field]) => !libraryForbiddenPayloadFields.has(field)));
        const created = await createGlobalVideo({ ...createPayload, project_id: projectId });
        toast({ title: 'Video creado', description: `Video ${activeTab.toUpperCase()} creado correctamente.` });
        if (onCreated) await onCreated(created);
      } else {
        const createPayload = {
          title: payload.title,
          external_id: payload.external_id,
          video_type: activeTab,
          project_id: projectId,
        };
        const created = await createGlobalVideo(createPayload);
        if (!created?.id) throw new Error('No se pudo crear el video global');
        await linkVideosToHypothesis(hypothesisId, [created.id]);
        await updateHypothesisVideoContext(hypothesisId, created.id, { audience_id: payload.audience_id || null });
        toast({ title: 'Video creado', description: `Video ${activeTab.toUpperCase()} creado en biblioteca y vinculado a hipótesis.` });
        if (onCreated) await onCreated(created);
      }
      onClose();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{isEditMode ? 'Editar video' : 'Crear video'} ({activeTab.toUpperCase()})</h3>
          <Button className="bg-gray-200 text-gray-700" onClick={onClose}>Cerrar</Button>
        </div>

        <div className="flex gap-2 mb-4">
          {tabs.map((tab) => (
            <Button key={tab} disabled={!isLibraryContext && isEditMode} className={activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)} type="button">
              {tab.toUpperCase()}
            </Button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50">
          {!isLibraryContext ? <p className="md:col-span-2 text-xs text-gray-600">Contexto de hipótesis: solo Público se guarda aquí. Métricas/global son de biblioteca.</p> : null}
          {isEditMode && (initialVideo?.video_id || initialVideo?.video_id === 0) ? (
            <div>
              <label className="block text-sm font-medium mb-1">video_id</label>
              <input type="text" className="w-full rounded-lg border p-2 bg-gray-100" value={String(initialVideo.video_id)} readOnly disabled />
            </div>
          ) : null}

          {visibleFields.map((field) => (
            <div key={field} className={field === 'contexto_cualitativo' ? 'md:col-span-2' : ''}>
              <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
              {renderInput(field)}
            </div>
          ))}

          <div className="md:col-span-2 flex gap-2 justify-end">
            <Button type="button" className="bg-gray-200 text-gray-700" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={submitting} className="bg-purple-600 text-white">{submitting ? (isEditMode ? 'Guardando...' : 'Creando...') : (isEditMode ? 'Guardar cambios' : `Crear video ${activeTab}`)}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VideoCreateModal;
