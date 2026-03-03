import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';

const HypothesisAudienceModal = ({ isOpen, onClose, hypothesisId, videoId, currentAudience = '', audiences = [], onSaved }) => {
  const { toast } = useToast();
  const { upsertHypothesisAudience } = useVideos();
  const [audienceId, setAudienceId] = useState(currentAudience || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAudienceId(currentAudience || '');
  }, [isOpen, currentAudience]);

  if (!isOpen) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!hypothesisId || !videoId) {
      toast({ title: 'Error', description: 'hypothesisId y videoId son obligatorios', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await upsertHypothesisAudience({
        hypothesis_id: hypothesisId,
        video_id: videoId,
        audience_id: audienceId || null,
      });
      toast({ title: 'Público guardado', description: 'Se actualizó el público del vínculo hypothesis_videos.' });
      if (onSaved) await onSaved();
      onClose();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Editar público de hipótesis</h3>
          <Button className="bg-gray-200 text-gray-700" onClick={onClose}>Cerrar</Button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Público (audiencia opcional)</label>
            <select className="w-full rounded-lg border p-2" value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
              <option value="">Sin público</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id}>{audience.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-gray-200 text-gray-700" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="bg-purple-600 text-white" disabled={saving}>{saving ? 'Guardando...' : 'Guardar público'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HypothesisAudienceModal;
