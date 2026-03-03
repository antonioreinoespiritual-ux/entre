import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';
import { baseVideo, fieldMapByType, labels, numericFields } from '@/components/videoFormConfig';

const tabs = ['paid', 'organic', 'live'];


const contextFields = new Set(['audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'contexto_cualitativo', 'video_type']);

const VideoCreateModal = ({
  isOpen,
  onClose,
  mode = 'create',
  scope = 'context',
  allowMetricsEdit,
  allowGlobalEdit,
  allowContextEdit,
  defaultType = 'organic',
  projectId,
  campaignId,
  hypothesisId,
  initialVideo = null,
  onCreated,
  onSaved,
  audiences = [],
}) => {
  const { toast } = useToast();
  const { createCampaignVideo, createProjectVideo, updateVideo, updateHypothesisVideoContext } = useVideos();
  const isEditMode = mode === 'edit';
  const isGlobalScope = scope === 'global';
  const canEditMetrics = allowMetricsEdit ?? isGlobalScope;
  const canEditGlobal = allowGlobalEdit ?? (isGlobalScope ? true : !isEditMode);
  const canEditContext = allowContextEdit ?? !isGlobalScope;
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
    if (numericFields.includes(field)) return canEditMetrics;
    if (contextFields.has(field)) return canEditContext;
    return canEditGlobal;
  };

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
    if (!isEditMode && !isGlobalScope && !campaignId) {
      toast({ title: 'Error', description: 'campaignId es obligatorio para crear videos', variant: 'destructive' });
      return;
    }
    if (!isEditMode && isGlobalScope && !projectId) {
      toast({ title: 'Error', description: 'projectId es obligatorio para crear videos globales', variant: 'destructive' });
      return;
    }
    if (isEditMode && !initialVideo?.id) {
      toast({ title: 'Error', description: 'Video inválido para edición', variant: 'destructive' });
      return;
    }

    const payload = {
      ...form,
      video_type: activeTab,
    };
    if (hypothesisId) payload.hypothesis_id = hypothesisId;
    numericFields.forEach((field) => { payload[field] = Number(payload[field] || 0); });

    setSubmitting(true);
    try {
      if (isEditMode) {
        let updated = null;
        if (isGlobalScope) {
          const updatePayload = Object.fromEntries(Object.entries(payload).filter(([field]) => isFieldEditable(field) && !contextFields.has(field)));
          updated = await updateVideo(initialVideo.id, updatePayload);
        } else {
          const contextPayload = {
            audience_id: payload.audience_id,
            hook_texto: payload.hook_texto,
            hook_tipo: payload.hook_tipo,
            cta_texto: payload.cta_texto,
            cta_tipo: payload.cta_tipo,
            ...(canEditContext ? { video_type: activeTab } : {}),
            contexto_cualitativo: payload.contexto_cualitativo,
          };
          updated = await updateHypothesisVideoContext(hypothesisId, initialVideo.id, contextPayload);
        }
        toast({ title: 'Video actualizado', description: 'Cambios guardados correctamente.' });
        if (onSaved) await onSaved(updated);
      } else {
        const created = isGlobalScope
          ? await createProjectVideo(projectId, Object.fromEntries(Object.entries(payload).filter(([field]) => isFieldEditable(field) && !contextFields.has(field))))
          : await createCampaignVideo(campaignId, Object.fromEntries(Object.entries(payload).filter(([field]) => isFieldEditable(field) || contextFields.has(field))));
        toast({ title: 'Video creado', description: `Video ${activeTab.toUpperCase()} creado correctamente.` });
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
          <h3 className="text-lg font-semibold">{isEditMode ? 'Editar video' : 'Crear video'} {isGlobalScope ? '(global)' : `(${activeTab.toUpperCase()})`}</h3>
          <Button className="bg-gray-200 text-gray-700" onClick={onClose}>Cerrar</Button>
        </div>

        <div className="flex gap-2 mb-4">
          {tabs.map((tab) => (
            <Button key={tab} disabled={!canEditContext} className={activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)} type="button">
              {tab.toUpperCase()}
            </Button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50">
          {!canEditMetrics ? <p className="md:col-span-2 text-xs text-gray-600">Métricas visibles en solo lectura en este contexto.</p> : null}
          {isEditMode && (initialVideo?.video_id || initialVideo?.video_id === 0) ? (
            <div>
              <label className="block text-sm font-medium mb-1">video_id</label>
              <input type="text" className="w-full rounded-lg border p-2 bg-gray-100" value={String(initialVideo.video_id)} readOnly disabled />
            </div>
          ) : null}
          {(isGlobalScope ? fieldMapByType[activeTab] : fieldMapByType[activeTab]).map((field) => (
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
