const allowedFieldMap = new Map([
  ['views', { key: 'views', type: 'int' }],
  ['clicks', { key: 'clicks', type: 'int' }],
  ['ctr', { key: 'ctr', type: 'float' }],
  ['cpc', { key: 'cpc', type: 'float' }],
  ['initiate_checkouts', { key: 'initiate_checkouts', type: 'int' }],
  ['view_content', { key: 'view_content', type: 'int' }],
  ['lead_form', { key: 'lead_form', type: 'int' }],
  ['purchase', { key: 'purchase', type: 'int' }],
  ['likes', { key: 'likes', type: 'int' }],
  ['comments', { key: 'comments', type: 'int' }],
  ['shares', { key: 'shares', type: 'int' }],
  ['saves', { key: 'saves', type: 'int' }],
  ['new_followers', { key: 'new_followers', type: 'int' }],
  ['avg_watch_time_sec', { key: 'avg_watch_time_sec', type: 'float' }],
  ['retention_pct', { key: 'retention_pct', type: 'float' }],
  ['views_finish_pct', { key: 'views_finish_pct', type: 'float' }],
  ['campaign_id', { key: 'campaign_id', type: 'text' }],
  ['ad_set_id', { key: 'ad_set_id', type: 'text' }],
  ['ad_id', { key: 'ad_id', type: 'text' }],
  ['url', { key: 'url', type: 'text' }],
  ['video_type', { key: 'video_type', type: 'enum', enumValues: ['paid', 'organic', 'live'] }],
]);

function parseTypedValue(value, config) {
  if (value == null || value === '') return null;
  if (config.type === 'text') return String(value);
  if (config.type === 'enum') {
    const normalized = String(value).trim().toLowerCase();
    return config.enumValues.includes(normalized) ? normalized : null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return config.type === 'int' ? Math.trunc(parsed) : parsed;
}

export function parseAndValidateBulkVideoJson(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText || '{}');
  } catch (error) {
    return { ok: false, errors: [`JSON inválido: ${error.message}`], payload: null };
  }

  const updates = Array.isArray(parsed?.updates) ? parsed.updates : null;
  if (!updates) {
    return { ok: false, errors: ['El JSON debe incluir "updates" como array.'], payload: null };
  }

  const errors = [];
  const normalizedUpdates = updates.map((update, index) => {
    const item = {
      ...update,
      video_id: update?.video_id ?? update?.record_id ?? null,
      video_name: update?.video_name ?? update?.record_name ?? update?.name ?? null,
    };

    const fields = item?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      errors.push(`Fila ${index}: fields debe ser objeto`);
      return item;
    }

    const normalizedFields = {};
    const invalidKeys = [];
    for (const [rawKey, rawValue] of Object.entries(fields)) {
      const key = String(rawKey || '').trim().toLowerCase();
      const config = allowedFieldMap.get(key);
      if (!config) {
        invalidKeys.push(rawKey);
        continue;
      }
      const parsedValue = parseTypedValue(rawValue, config);
      if (parsedValue == null && rawValue !== null && rawValue !== '') {
        invalidKeys.push(rawKey);
        continue;
      }
      normalizedFields[config.key] = parsedValue;
    }

    if (!Object.keys(normalizedFields).length || invalidKeys.length) {
      errors.push(`Fila ${index}: ${invalidKeys.length ? `campos inválidos (${invalidKeys.join(', ')})` : 'sin fields válidos'}`);
    }

    return { ...item, fields: normalizedFields };
  });

  return {
    ok: errors.length === 0,
    errors,
    payload: { updates: normalizedUpdates },
  };
}
