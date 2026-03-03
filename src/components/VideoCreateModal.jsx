import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';
import { baseVideo, fieldMapByType, labels, numericFields } from '@/components/videoFormConfig';

const tabs = ['paid', 'organic', 'live'];

const VideoCreateModal = ({
  isOpen,
  onClose,
  mode = 'create',
  defaultType = 'organic',
  campaignId,
  hypothesisId,
  initialVideo = null,
  onCreated,
  onSaved,
  audiences = [],
}) => {
  const { toast } = useToast();
  const { createCampaignVideo, updateVideo } = useVideos();
  const isEditMode = mode === 'edit';
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

  const renderInput = (field) => {
    if (field === 'audience_id') {
      return (
        <select className="w-full rounded-lg border p-2" value={form.audience_id} onChange={(e) => setForm((current) => ({ ...current, audience_id: e.target.value }))}>
          <option value="">Sin público</option>
          {audiences.map((aud) => <option key={aud.id} value={aud.id}>{aud.name}</option>)}
        </select>
      );
    }

    if (field === 'contexto_cualitativo') {
      return <textarea className="w-full rounded-lg border p-2" rows="2" value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} />;
    }

    const isNumeric = numericFields.includes(field);
    return <input type={isNumeric ? 'number' : 'text'} className="w-full rounded-lg border p-2" required={field === 'title'} value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} />;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!isEditMode && !campaignId) {
      toast({ title: 'Error', description: 'campaignId es obligatorio para crear videos', variant: 'destructive' });
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
        const updatePayload = { ...payload };
        delete updatePayload.id;
        delete updatePayload.user_id;
        delete updatePayload.hypothesis_id;
        delete updatePayload.video_id;

        const updated = await updateVideo(initialVideo.id, updatePayload);
        toast({ title: 'Video actualizado', description: `Video ${activeTab.toUpperCase()} actualizado correctamente.` });
        if (onSaved) await onSaved(updated);
      } else {
        const created = await createCampaignVideo(campaignId, payload);
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
          <h3 className="text-lg font-semibold">{isEditMode ? 'Editar video' : 'Crear video'} ({activeTab.toUpperCase()})</h3>
          <Button className="bg-gray-200 text-gray-700" onClick={onClose}>Cerrar</Button>
        </div>

        <div className="flex gap-2 mb-4">
          {tabs.map((tab) => (
            <Button key={tab} className={activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'} onClick={() => setActiveTab(tab)} type="button">
              {tab.toUpperCase()}
            </Button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4 border rounded-xl p-4 bg-purple-50">
          {isEditMode && (initialVideo?.video_id || initialVideo?.video_id === 0) ? (
            <div>
              <label className="block text-sm font-medium mb-1">video_id</label>
              <input type="text" className="w-full rounded-lg border p-2 bg-gray-100" value={String(initialVideo.video_id)} readOnly disabled />
            </div>
          ) : null}
          {fieldMapByType[activeTab].map((field) => (
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
