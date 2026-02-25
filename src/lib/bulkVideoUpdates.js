const allowedFieldMap = new Map([
  ['campaign_id', { key: 'campaign_id', type: 'text' }],
  ['adset_id', { key: 'adset_id', type: 'text' }],
  ['ad_id', { key: 'ad_id', type: 'text' }],
  ['creative_id', { key: 'creative_id', type: 'text' }],
  ['session_id', { key: 'session_id', type: 'text' }],
  ['url', { key: 'url', type: 'text' }],
  ['clicks', { key: 'clicks', type: 'int' }],
  ['views', { key: 'views', type: 'int' }],
  ['views_profile', { key: 'views_profile', type: 'int' }],
  ['ctr', { key: 'ctr', type: 'float' }],
  ['cpc', { key: 'cpc', type: 'float' }],
  ['new_followers', { key: 'new_followers', type: 'int' }],
  ['initiate_checkouts', { key: 'initiate_checkouts', type: 'int' }],
  ['view_content', { key: 'view_content', type: 'int' }],
  ['lead_form', { key: 'lead_form', type: 'int' }],
  ['leads', { key: 'leads', type: 'int' }],
  ['purchase', { key: 'purchase', type: 'int' }],
  ['likes', { key: 'likes', type: 'int' }],
  ['comments', { key: 'comments', type: 'int' }],
  ['shares', { key: 'shares', type: 'int' }],
  ['saves', { key: 'saves', type: 'int' }],
  ['avg_viewers', { key: 'avg_viewers', type: 'float' }],
  ['peak_viewers', { key: 'peak_viewers', type: 'int' }],
  ['duration_min', { key: 'duration_min', type: 'float' }],
  ['duration_sec', { key: 'duration_sec', type: 'float' }],
  ['retention_pct', { key: 'retention_pct', type: 'float' }],
  ['views_finish_pct', { key: 'views_finish_pct', type: 'float' }],
  ['avg_watch_time_sec', { key: 'avg_watch_time_sec', type: 'float' }],
  ['tiempo_prom_sec', { key: 'tiempo_prom_sec', type: 'float' }],
  ['hook_text', { key: 'hook_text', type: 'text' }],
  ['hook_type', { key: 'hook_type', type: 'text' }],
  ['cta_text', { key: 'cta_text', type: 'text' }],
  ['cta_type', { key: 'cta_type', type: 'text' }],
  ['context', { key: 'context', type: 'text' }],
]);

function parseTypedValue(value, type) {
  if (value == null || value === '') return null;
  if (type === 'text') return String(value);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return type === 'int' ? Math.trunc(parsed) : parsed;
}

function detectIdentifier(update = {}) {
  if (update.video_id || update.record_id) return `video_id:${update.video_id || update.record_id}`;
  if (update.session_id) return `session_id:${update.session_id}`;
  if (update.video_name || update.record_name || update.name) return `video_name:${update.video_name || update.record_name || update.name}`;
  return 'sin_identificador';
}

function resolveVideo(videos, update) {
  const directId = String(update.video_id || update.record_id || '').trim();
  if (directId) return videos.find((video) => String(video.id) === directId) || null;

  const sessionId = String(update.session_id || '').trim().toLowerCase();
  if (sessionId) return videos.find((video) => String(video.external_id || '').trim().toLowerCase() === sessionId) || null;

  const name = String(update.video_name || update.record_name || update.name || '').trim().toLowerCase();
  if (name) return videos.find((video) => String(video.title || video.name || '').trim().toLowerCase() === name) || null;

  return null;
}

export function validateBulkVideoUpdates(rawText, videos = []) {
  let parsed;
  try {
    parsed = JSON.parse(rawText || '{}');
  } catch (error) {
    return { ok: false, errors: [`JSON inválido: ${error.message}`], summary: null, previewRows: [], payload: null, warnings: [] };
  }

  const updates = Array.isArray(parsed?.updates) ? parsed.updates : null;
  if (!updates) {
    return { ok: false, errors: ['El JSON debe incluir "updates" como array.'], summary: null, previewRows: [], payload: null, warnings: [] };
  }

  const warnings = [];
  const errors = [];
  const previewRows = [];
  const dedupeByVideo = new Map();

  updates.forEach((update, inputIndex) => {
    const rowWarnings = [];
    const normalizedFields = {};
    const invalidKeys = [];

    const fields = update?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      previewRows.push({ inputIndex, identifier: detectIdentifier(update), status: 'invalid', fieldKeys: [], reason: 'fields debe ser objeto' });
      errors.push(`Fila ${inputIndex}: fields debe ser objeto`);
      return;
    }

    Object.entries(fields).forEach(([rawKey, value]) => {
      const key = String(rawKey || '').trim().toLowerCase();
      const config = allowedFieldMap.get(key);
      if (!config) {
        invalidKeys.push(rawKey);
        return;
      }
      const typed = parseTypedValue(value, config.type);
      if (typed == null && value !== null && value !== '') {
        invalidKeys.push(rawKey);
        return;
      }
      normalizedFields[config.key] = typed;
    });

    const keys = Object.keys(normalizedFields);
    if (!keys.length || invalidKeys.length) {
      previewRows.push({ inputIndex, identifier: detectIdentifier(update), status: 'invalid', fieldKeys: keys, reason: invalidKeys.length ? `Campos inválidos: ${invalidKeys.join(', ')}` : 'Sin fields válidos' });
      errors.push(`Fila ${inputIndex}: ${invalidKeys.length ? `campos inválidos (${invalidKeys.join(', ')})` : 'sin fields válidos'}`);
      return;
    }

    const matched = resolveVideo(videos, update);
    if (!matched) {
      previewRows.push({ inputIndex, identifier: detectIdentifier(update), status: 'not_found', fieldKeys: keys, reason: 'No se encontró video' });
      return;
    }

    const merged = dedupeByVideo.get(matched.id);
    if (merged) {
      rowWarnings.push(`Duplicado sobre video ${matched.id}: se reemplaza input ${merged.inputIndex}`);
      warnings.push(`Input ${inputIndex} pisa a input ${merged.inputIndex} para video ${matched.id}`);
    }

    dedupeByVideo.set(matched.id, {
      inputIndex,
      update: {
        video_id: update.video_id || update.record_id || matched.id,
        session_id: update.session_id,
        video_name: update.video_name || update.record_name || update.name,
        fields: { ...(merged?.update?.fields || {}), ...normalizedFields },
      },
    });

    previewRows.push({ inputIndex, identifier: detectIdentifier(update), status: 'will_update', fieldKeys: keys, reason: rowWarnings.join(' · ') });
  });

  const payload = { updates: [...dedupeByVideo.values()].map((entry) => entry.update) };
  const willUpdate = payload.updates.length;
  const invalid = previewRows.filter((row) => row.status === 'invalid').length;
  const notFound = previewRows.filter((row) => row.status === 'not_found').length;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    previewRows,
    payload,
    summary: {
      received: updates.length,
      willUpdate,
      invalid,
      notFound,
    },
  };
}
