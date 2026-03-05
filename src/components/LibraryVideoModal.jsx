import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useVideos } from '@/contexts/VideoContext';

const tabs = ['paid', 'organic', 'live'];

const globalFields = [
  'external_id',
  'title',
  'hook_texto',
  'hook_tipo',
  'cta_texto',
  'cta_tipo',
  'creative_id',
  'contexto_cualitativo',
  'url',
  'organic_piece_type',
  'campaign_id_ref',
  'ad_set_id',
];

const metricFields = [
  'clicks',
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'initiatest',
  'initiate_checkouts',
  'view_content',
  'formulario_lead',
  'purchase',
  'views_finish_pct',
  'retencion_pct',
  'tiempo_prom_seg',
  'duracion_seg',
  'duracion_del_video_seg',
  'duracion_min',
  'nuevos_seguidores',
  'views_profile',
  'cpc',
  'ctr',
  'pico_viewers',
  'viewers_prom',
];

const baseVideo = {
  video_type: 'organic',
  external_id: '',
  title: '',
  hook_texto: '',
  hook_tipo: '',
  cta_texto: '',
  cta_tipo: '',
  creative_id: '',
  contexto_cualitativo: '',
  url: '',
  organic_piece_type: '',
  campaign_id_ref: '',
  ad_set_id: '',
  clicks: 0,
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  initiatest: 0,
  initiate_checkouts: 0,
  view_content: 0,
  formulario_lead: 0,
  purchase: 0,
  views_finish_pct: 0,
  retencion_pct: 0,
  tiempo_prom_seg: 0,
  duracion_seg: 0,
  duracion_del_video_seg: 0,
  duracion_min: 0,
  nuevos_seguidores: 0,
  views_profile: 0,
  cpc: 0,
  ctr: 0,
  pico_viewers: 0,
  viewers_prom: 0,
};

const labels = {
  external_id: 'session_id / ad_id / live_id',
  title: 'Nombre del video',
  hook_texto: 'Hook texto',
  hook_tipo: 'Hook tipo',
  cta_texto: 'CTA texto',
  cta_tipo: 'CTA tipo',
  creative_id: 'Creative ID',
  contexto_cualitativo: 'Contexto cualitativo',
  url: 'URL del video',
  organic_piece_type: 'Organic piece type',
  campaign_id_ref: 'Campaign ID (ad platform)',
  ad_set_id: 'Ad set ID',
  clicks: 'Clicks',
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  initiatest: 'Initiatest',
  initiate_checkouts: 'Initiate checkouts',
  view_content: 'View content',
  formulario_lead: 'Formulario lead',
  purchase: 'Purchase',
  views_finish_pct: '% views finish',
  retencion_pct: '% retención',
  tiempo_prom_seg: 'Tiempo prom (seg)',
  duracion_seg: 'Duración (seg)',
  duracion_del_video_seg: 'Duración del video (seg)',
  duracion_min: 'Duración (min)',
  nuevos_seguidores: 'Nuevos seguidores',
  views_profile: 'Views profile',
  cpc: 'CPC',
  ctr: 'CTR',
  pico_viewers: 'Pico viewers',
  viewers_prom: 'Viewers prom',
};

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

  if (!isOpen) return null;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!projectId) {
      toast({ title: 'Error', description: 'projectId es obligatorio', variant: 'destructive' });
      return;
    }

    const payload = {
      ...Object.fromEntries([...globalFields, ...metricFields].map((field) => [field, form[field]])),
      project_id: projectId,
      video_type: activeTab,
    };
    metricFields.forEach((field) => {
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

        <form onSubmit={onSubmit} className="space-y-5 border rounded-xl p-4 bg-purple-50">
          {isEdit && (initialVideo?.video_id || initialVideo?.video_id === 0) ? (
            <div>
              <label className="block text-sm font-medium mb-1">video_id</label>
              <input className="w-full rounded-lg border p-2 bg-gray-100" value={String(initialVideo.video_id)} readOnly disabled />
            </div>
          ) : null}

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">A) Datos globales</h4>
            <div className="grid md:grid-cols-2 gap-4">
              {globalFields.map((field) => (
                <div key={field} className={field === 'contexto_cualitativo' ? 'md:col-span-2' : ''}>
                  <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
                  {field === 'contexto_cualitativo' ? (
                    <textarea className="w-full rounded-lg border p-2" rows="2" value={form[field]} onChange={(e) => setForm((c) => ({ ...c, [field]: e.target.value }))} />
                  ) : (
                    <input
                      type="text"
                      className="w-full rounded-lg border p-2"
                      value={form[field] ?? ''}
                      required={field === 'title'}
                      onChange={(e) => setForm((c) => ({ ...c, [field]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">B) Métricas numéricas</h4>
            <div className="grid md:grid-cols-3 gap-4">
              {metricFields.map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1">{labels[field] || field}</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border p-2"
                    value={form[field] ?? 0}
                    onChange={(e) => setForm((c) => ({ ...c, [field]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-gray-200 text-gray-700" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="bg-purple-600 text-white" disabled={saving}>{saving ? 'Guardando...' : (isEdit ? 'Guardar cambios' : 'Crear video')}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LibraryVideoModal;
