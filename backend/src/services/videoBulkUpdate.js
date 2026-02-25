const FIELD_ALIASES = {
  record_id: 'video_id',
  record_name: 'video_name',
  name: 'video_name',
  leads: 'lead_form',
  tiempo_prom_sec: 'avg_watch_time_sec',
  duration_sec: 'duration_sec',
};

const BULK_FIELD_CONFIG = {
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

const REQUIRED_VIDEO_COLUMNS = {
  name: 'TEXT',
  session_id: 'TEXT',
  campaign_id: 'TEXT',
  adset_id: 'TEXT',
  ad_id: 'TEXT',
  creative_id: 'TEXT',
  url: 'TEXT',
  cpc: 'REAL DEFAULT 0',
  views: 'INTEGER DEFAULT 0',
  engagement: 'REAL DEFAULT 0',
  likes: 'INTEGER DEFAULT 0',
  shares: 'INTEGER DEFAULT 0',
  comments: 'INTEGER DEFAULT 0',
  clicks: 'INTEGER DEFAULT 0',
  views_profile: 'INTEGER DEFAULT 0',
  ctr: 'REAL DEFAULT 0',
  new_followers: 'INTEGER DEFAULT 0',
  initiate_checkouts: 'INTEGER DEFAULT 0',
  view_content: 'INTEGER DEFAULT 0',
  lead_form: 'INTEGER DEFAULT 0',
  purchase: 'INTEGER DEFAULT 0',
  saves: 'INTEGER DEFAULT 0',
  avg_viewers: 'REAL DEFAULT 0',
  peak_viewers: 'INTEGER DEFAULT 0',
  duration_min: 'REAL DEFAULT 0',
  duration_sec: 'INTEGER DEFAULT 0',
  retention_pct: 'REAL DEFAULT 0',
  views_finish_pct: 'REAL DEFAULT 0',
  avg_watch_time_sec: 'REAL DEFAULT 0',
  hook_text: 'TEXT',
  hook_type: 'TEXT',
  cta_text: 'TEXT',
  cta_type: 'TEXT',
  context: 'TEXT',
  metrics_json: 'TEXT',
};

function normalizeIdentifierValue(value) {
  return String(value || '').trim().toLowerCase();
}

function parseMaybeJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function coerceFieldValue(type, value) {
  if (value === null || value === undefined) return null;
  if (type === 'string') return String(value);

  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (type === 'int') return Math.trunc(numeric);
  return numeric;
}

function normalizeInputUpdate(item, inputIndex) {
  const normalized = { ...item };

  for (const [source, target] of Object.entries(FIELD_ALIASES)) {
    if (normalized[source] !== undefined && normalized[target] === undefined) {
      normalized[target] = normalized[source];
    }
  }

  const rawFields = normalized.fields;
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    return { inputIndex, status: 'invalid', reason: 'missing_fields' };
  }

  const fields = {};
  const extras = {};
  const invalidKeys = [];

  for (const [key, value] of Object.entries(rawFields)) {
    const canonicalKey = FIELD_ALIASES[key] || key;
    const type = BULK_FIELD_CONFIG[canonicalKey];
    if (!type) {
      invalidKeys.push(key);
      continue;
    }

    const coerced = coerceFieldValue(type, value);
    if (Number.isNaN(coerced)) {
      return { inputIndex, status: 'invalid', reason: `invalid_number:${canonicalKey}` };
    }

    if (REQUIRED_VIDEO_COLUMNS[canonicalKey]) {
      fields[canonicalKey] = coerced;
    } else {
      extras[canonicalKey] = coerced;
    }
  }

  if (invalidKeys.length) {
    return { inputIndex, status: 'invalid', reason: `unknown_fields:${invalidKeys.join(',')}` };
  }

  if (!Object.keys(fields).length && !Object.keys(extras).length) {
    return { inputIndex, status: 'invalid', reason: 'empty_fields' };
  }

  return {
    inputIndex,
    status: 'valid',
    videoId: normalized.video_id,
    sessionId: normalized.session_id,
    videoName: normalized.video_name,
    fields,
    extras,
  };
}

export async function ensureVideoBulkColumns(pool) {
  const [columns] = await pool.query('PRAGMA table_info(videos)');
  const existing = new Set(columns.map((column) => column.name));

  for (const [column, typeSql] of Object.entries(REQUIRED_VIDEO_COLUMNS)) {
    if (existing.has(column)) continue;
    await pool.query(`ALTER TABLE videos ADD COLUMN \`${column}\` ${typeSql}`);
  }
}

export async function executeVideoBulkUpdate(pool, userId, body) {
  const updates = Array.isArray(body?.updates) ? body.updates : null;
  if (!updates) {
    throw new Error('Body must include updates array');
  }

  await ensureVideoBulkColumns(pool);

  const [videoRows] = await pool.query(
    'SELECT id, session_id, title, name, metrics_json FROM videos WHERE user_id = ?',
    [userId],
  );

  const idMap = new Map();
  const sessionMap = new Map();
  const nameMap = new Map();
  const metricsMap = new Map();

  for (const row of videoRows) {
    idMap.set(String(row.id), row.id);
    if (row.session_id) sessionMap.set(normalizeIdentifierValue(row.session_id), row.id);
    const displayName = row.name || row.title;
    if (displayName) nameMap.set(normalizeIdentifierValue(displayName), row.id);
    metricsMap.set(row.id, parseMaybeJson(row.metrics_json));
  }

  const results = [];
  const warnings = [];
  const resolvedByVideo = new Map();

  updates.forEach((entry, inputIndex) => {
    const normalized = normalizeInputUpdate(entry, inputIndex);

    if (normalized.status !== 'valid') {
      results.push(normalized);
      return;
    }

    let targetVideoId = null;
    let identifier = null;

    if (normalized.videoId && idMap.has(String(normalized.videoId))) {
      targetVideoId = idMap.get(String(normalized.videoId));
      identifier = `video_id:${normalized.videoId}`;
    } else if (normalized.sessionId && sessionMap.has(normalizeIdentifierValue(normalized.sessionId))) {
      targetVideoId = sessionMap.get(normalizeIdentifierValue(normalized.sessionId));
      identifier = `session_id:${normalized.sessionId}`;
    } else if (normalized.videoName && nameMap.has(normalizeIdentifierValue(normalized.videoName))) {
      targetVideoId = nameMap.get(normalizeIdentifierValue(normalized.videoName));
      identifier = `video_name:${normalized.videoName}`;
    }

    if (!targetVideoId) {
      results.push({ inputIndex, status: 'skipped', reason: 'not_found' });
      return;
    }

    const existing = resolvedByVideo.get(targetVideoId);
    if (existing) {
      warnings.push(`Duplicate update detected for video ${targetVideoId}; keeping last payload from index ${inputIndex}.`);
      existing.fields = { ...existing.fields, ...normalized.fields };
      existing.extras = { ...existing.extras, ...normalized.extras };
      results[existing.resultIndex] = { ...results[existing.resultIndex], status: 'skipped', reason: 'duplicate_overridden' };
      existing.resultIndex = results.length;
      results.push({ inputIndex, status: 'will_update', videoId: targetVideoId, identifier });
      return;
    }

    resolvedByVideo.set(targetVideoId, {
      inputIndex,
      fields: { ...normalized.fields },
      extras: { ...normalized.extras },
      resultIndex: results.length,
    });

    results.push({ inputIndex, status: 'will_update', videoId: targetVideoId, identifier });
  });

  const updatesToApply = [...resolvedByVideo.entries()];

  try {
    await pool.query('BEGIN');

    for (const [videoId, update] of updatesToApply) {
      const setFields = { ...update.fields };

      if (Object.keys(update.extras).length) {
        const mergedMetrics = { ...(metricsMap.get(videoId) || {}), ...update.extras };
        setFields.metrics_json = JSON.stringify(mergedMetrics);
      }

      const keys = Object.keys(setFields);
      if (!keys.length) {
        continue;
      }

      const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
      const params = [...keys.map((key) => setFields[key]), videoId, userId];
      await pool.query(
        `UPDATE videos SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        params,
      );
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  const updatedCount = results.filter((result) => result.status === 'will_update').length;
  const invalidCount = results.filter((result) => result.status === 'invalid').length;
  const skippedCount = results.filter((result) => result.status === 'skipped').length;

  return {
    ok: true,
    summary: {
      received: updates.length,
      valid: updates.length - invalidCount,
      matched: updatedCount,
      updated: updatedCount,
      skipped: skippedCount + invalidCount,
    },
    warnings,
    results: results.map((result) => ({
      ...result,
      status: result.status === 'will_update' ? 'updated' : result.status,
    })),
  };
}

export function getBulkAllowedFields() {
  return { ...BULK_FIELD_CONFIG };
}
