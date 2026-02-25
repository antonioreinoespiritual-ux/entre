const FIELD_ALIASES = {
  record_id: 'video_id',
  record_name: 'video_name',
  name: 'video_name',
  leads: 'lead_form',
  tiempo_prom_sec: 'avg_watch_time_sec',
};

const FIELD_TYPES = {
  campaign_id: 'string',
  adset_id: 'string',
  ad_id: 'string',
  creative_id: 'string',
  session_id: 'string',
  url: 'string',
  clicks: 'int',
  views: 'int',
  views_profile: 'int',
  ctr: 'float',
  cpc: 'float',
  new_followers: 'int',
  initiate_checkouts: 'int',
  view_content: 'int',
  lead_form: 'int',
  purchase: 'int',
  likes: 'int',
  comments: 'int',
  shares: 'int',
  saves: 'int',
  avg_viewers: 'float',
  peak_viewers: 'int',
  duration_min: 'float',
  duration_sec: 'int',
  retention_pct: 'float',
  views_finish_pct: 'float',
  avg_watch_time_sec: 'float',
  hook_text: 'string',
  hook_type: 'string',
  cta_text: 'string',
  cta_type: 'string',
  context: 'string',
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

function coerceValue(type, value) {
  if (value === null || value === undefined) return null;
  if (type === 'string') return String(value);

  const parsed = Number(typeof value === 'string' ? value.trim() : value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return type === 'int' ? Math.trunc(parsed) : parsed;
}

export function validateBulkVideoUpdates(rawJson, videos = []) {
  let payload;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return {
      ok: false,
      errors: ['JSON inválido. Verifica la sintaxis.'],
      warnings: [],
      summary: null,
      rows: [],
      normalizedPayload: null,
    };
  }

  if (!payload || !Array.isArray(payload.updates)) {
    return {
      ok: false,
      errors: ['La raíz debe tener el formato: { "updates": [...] }'],
      warnings: [],
      summary: null,
      rows: [],
      normalizedPayload: null,
    };
  }

  const idMap = new Map(videos.map((video) => [String(video.id), video.id]));
  const sessionMap = new Map(
    videos
      .filter((video) => video.session_id)
      .map((video) => [normalizeText(video.session_id), video.id]),
  );
  const nameMap = new Map(
    videos
      .filter((video) => video.name || video.title)
      .map((video) => [normalizeText(video.name || video.title), video.id]),
  );

  const warnings = [];
  const errors = [];
  const rows = [];
  const resolvedById = new Map();

  payload.updates.forEach((entry, inputIndex) => {
    const normalized = { ...entry };
    Object.entries(FIELD_ALIASES).forEach(([source, target]) => {
      if (normalized[source] !== undefined && normalized[target] === undefined) {
        normalized[target] = normalized[source];
      }
    });

    if (!normalized.fields || typeof normalized.fields !== 'object' || Array.isArray(normalized.fields)) {
      rows.push({ inputIndex, detectedIdentifier: '-', status: 'invalid', reason: 'missing_fields', fieldKeys: [] });
      return;
    }

    const cleanFields = {};
    const invalidFields = [];

    Object.entries(normalized.fields).forEach(([rawKey, rawValue]) => {
      const key = FIELD_ALIASES[rawKey] || rawKey;
      const type = FIELD_TYPES[key];
      if (!type) {
        invalidFields.push(rawKey);
        return;
      }
      const converted = coerceValue(type, rawValue);
      if (Number.isNaN(converted)) {
        invalidFields.push(`${rawKey}(tipo)`);
        return;
      }
      cleanFields[key] = converted;
    });

    if (invalidFields.length) {
      rows.push({
        inputIndex,
        detectedIdentifier: '-',
        status: 'invalid',
        reason: `unknown_or_invalid_fields:${invalidFields.join(',')}`,
        fieldKeys: Object.keys(cleanFields),
      });
      return;
    }

    const fieldKeys = Object.keys(cleanFields);
    if (!fieldKeys.length) {
      rows.push({ inputIndex, detectedIdentifier: '-', status: 'invalid', reason: 'empty_fields', fieldKeys: [] });
      return;
    }

    let targetVideoId = null;
    let detectedIdentifier = '-';

    if (normalized.video_id && idMap.has(String(normalized.video_id))) {
      targetVideoId = idMap.get(String(normalized.video_id));
      detectedIdentifier = `video_id:${normalized.video_id}`;
    } else if (normalized.session_id && sessionMap.has(normalizeText(normalized.session_id))) {
      targetVideoId = sessionMap.get(normalizeText(normalized.session_id));
      detectedIdentifier = `session_id:${normalized.session_id}`;
    } else if (normalized.video_name && nameMap.has(normalizeText(normalized.video_name))) {
      targetVideoId = nameMap.get(normalizeText(normalized.video_name));
      detectedIdentifier = `video_name:${normalized.video_name}`;
    }

    if (!targetVideoId) {
      rows.push({ inputIndex, detectedIdentifier, status: 'not_found', reason: 'not_found', fieldKeys });
      return;
    }

    if (resolvedById.has(targetVideoId)) {
      const previous = resolvedById.get(targetVideoId);
      warnings.push(`Duplicado para video ${targetVideoId}: se conserva el último (índice ${inputIndex}).`);
      rows[previous.resultIndex] = { ...rows[previous.resultIndex], status: 'invalid', reason: 'duplicate_overridden' };
    }

    const normalizedUpdate = {
      video_id: targetVideoId,
      fields: cleanFields,
    };

    resolvedById.set(targetVideoId, { resultIndex: rows.length, update: normalizedUpdate });
    rows.push({ inputIndex, detectedIdentifier, status: 'will_update', reason: null, fieldKeys });
  });

  const summary = {
    received: payload.updates.length,
    valid: rows.filter((row) => row.status !== 'invalid').length,
    matched: rows.filter((row) => row.status === 'will_update').length,
    updated: rows.filter((row) => row.status === 'will_update').length,
    skipped: rows.filter((row) => row.status !== 'will_update').length,
  };

  const normalizedPayload = {
    updates: [...resolvedById.values()].map((entry) => entry.update),
  };

  const ok = errors.length === 0 && summary.updated > 0;

  return {
    ok,
    errors,
    warnings,
    summary,
    rows,
    normalizedPayload,
  };
}
