export const baseVideo = {
  title: '', audience_id: '', external_id: '', hook_texto: '', hook_tipo: '', cta_texto: '', cta_tipo: '', creative_id: '',
  contexto_cualitativo: '', clicks: 0, views: 0, views_profile: 0, initiatest: 0, initiate_checkouts: 0, view_content: 0, formulario_lead: 0,
  purchase: 0, likes: 0, comments: 0, shares: 0, saves: 0, nuevos_seguidores: 0, cpc: 0, ctr: 0, pico_viewers: 0, viewers_prom: 0,
  duracion_min: 0, duracion_seg: 0, duracion_del_video_seg: 0, organic_piece_type: '', url: '', views_finish_pct: 0, retencion_pct: 0,
  tiempo_prom_seg: 0, campaign_id_ref: '', ad_set_id: '',
};

export const numericFields = ['clicks', 'views', 'views_profile', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'likes', 'comments', 'shares', 'saves', 'nuevos_seguidores', 'cpc', 'ctr', 'pico_viewers', 'viewers_prom', 'duracion_min', 'duracion_seg', 'duracion_del_video_seg', 'views_finish_pct', 'retencion_pct', 'tiempo_prom_seg'];

export const fieldMapByType = {
  live: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'initiatest', 'pico_viewers', 'viewers_prom', 'duracion_min', 'nuevos_seguidores', 'likes', 'comments', 'shares', 'saves'],
  organic: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'nuevos_seguidores', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'organic_piece_type', 'likes', 'comments', 'shares', 'saves', 'url', 'views_finish_pct', 'retencion_pct', 'tiempo_prom_seg', 'duracion_seg'],
  paid: ['external_id', 'title', 'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views', 'views_profile', 'nuevos_seguidores', 'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'cpc', 'ctr', 'duracion_del_video_seg', 'campaign_id_ref', 'ad_set_id'],
};

export const labels = {
  external_id: 'session_id / ad_id / live_id', title: 'Nombre del video', audience_id: 'Público (audiencia opcional)', hook_texto: 'Hook texto', hook_tipo: 'Hook tipo', cta_texto: 'CTA texto', cta_tipo: 'CTA tipo', creative_id: 'Creative ID', contexto_cualitativo: 'Contexto cualitativo',
  clicks: 'Clicks', views: 'Views', views_profile: 'Views profile', initiatest: 'Initiatest', initiate_checkouts: 'Initiate checkouts', view_content: 'View content', formulario_lead: 'Formulario lead', purchase: 'Purchase', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', nuevos_seguidores: 'Nuevos seguidores',
  cpc: 'CPC', ctr: 'CTR', pico_viewers: 'Pico viewers', viewers_prom: 'Viewers prom', duracion_min: 'Duración (min)', duracion_seg: 'Duración (seg)', duracion_del_video_seg: 'Duración del video (seg)', organic_piece_type: 'Organic piece type', url: 'URL del video', views_finish_pct: '% views finish', retencion_pct: '% retención', tiempo_prom_seg: 'Tiempo prom (seg)',
  campaign_id_ref: 'Campaign ID (ad platform)', ad_set_id: 'Ad set ID',
};
