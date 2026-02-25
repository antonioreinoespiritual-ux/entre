import process from 'node:process';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { createPool, validateDbEnv } from './config/db.js';
import { loadBackendEnv } from './config/env.js';


const envSource = loadBackendEnv();

try {
  validateDbEnv(process.env);
} catch (error) {
  const sourceHint = envSource.loaded
    ? `Loaded env from ${envSource.path}`
    : 'No .env file found in project root (or .env.example).';
  console.error(`${error.message}. ${sourceHint} Copy .env.example to .env and adjust SQLite path if needed.`);
  process.exit(1);
}

const port = Number(process.env.BACKEND_PORT || 4000);
const pool = createPool(process.env);
const defaultCorsOrigins = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];
const corsOrigins = (process.env.CORS_ORIGIN || defaultCorsOrigins.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const sessions = new Map();
const allowedTables = new Set(['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'users']);

const schemaSql = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)',
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_campaigns_project_id ON campaigns(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id)',
  `CREATE TABLE IF NOT EXISTS audiences (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    contexto TEXT,
    notas TEXT,
    targeting TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_audiences_campaign_id ON audiences(campaign_id)',
  'CREATE INDEX IF NOT EXISTS idx_audiences_user_id ON audiences(user_id)',
  `CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    hypothesis_statement TEXT,
    variable_x TEXT,
    metrica_objetivo_y TEXT,
    umbral_operador TEXT,
    umbral_valor REAL,
    volumen_minimo REAL,
    volumen_unidad TEXT,
    canal_principal TEXT,
    contexto_cualitativo TEXT,
    condition TEXT,
    validation_status TEXT DEFAULT 'No Validada',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_hypotheses_campaign_id ON hypotheses(campaign_id)',
  'CREATE INDEX IF NOT EXISTS idx_hypotheses_user_id ON hypotheses(user_id)',
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    audience_id TEXT,
    user_id TEXT NOT NULL,
    video_type TEXT NOT NULL DEFAULT 'organic',
    title TEXT NOT NULL,
    url TEXT,
    external_id TEXT,
    external_id_type TEXT,
    hook_texto TEXT,
    hook_tipo TEXT,
    cta_texto TEXT,
    cta_tipo TEXT,
    creative_id TEXT,
    contexto_cualitativo TEXT,
    clicks INTEGER DEFAULT 0,
    views_profile INTEGER DEFAULT 0,
    initiatest INTEGER DEFAULT 0,
    initiate_checkouts INTEGER DEFAULT 0,
    view_content INTEGER DEFAULT 0,
    formulario_lead INTEGER DEFAULT 0,
    purchase INTEGER DEFAULT 0,
    pico_viewers INTEGER DEFAULT 0,
    viewers_prom REAL DEFAULT 0,
    duracion_min REAL DEFAULT 0,
    nuevos_seguidores INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    organic_piece_type TEXT,
    views_finish_pct REAL DEFAULT 0,
    retencion_pct REAL DEFAULT 0,
    tiempo_prom_seg REAL DEFAULT 0,
    duracion_seg REAL DEFAULT 0,
    campaign_id_ref TEXT,
    ad_set_id TEXT,
    cpc REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    duracion_del_video_seg REAL DEFAULT 0,
    views INTEGER DEFAULT 0,
    engagement REAL DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_videos_audience_id ON videos(audience_id)',
  'CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id)',
  `CREATE TABLE IF NOT EXISTS hypothesis_analysis_runs (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    config_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    dataset_hash TEXT NOT NULL,
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_analysis_runs_hypothesis_id ON hypothesis_analysis_runs(hypothesis_id)',
  `CREATE TABLE IF NOT EXISTS video_ab_tests (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    video_a_id TEXT NOT NULL,
    video_b_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    config_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    dataset_hash TEXT NOT NULL,
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_video_ab_tests_hypothesis_id ON video_ab_tests(hypothesis_id)',
];

const textEncoder = new TextEncoder();

function uuid() {
  return crypto.randomUUID();
}

function normalizeIdentifier(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid identifier: ${value}`);
  }
  return `\`${value}\``;
}

function resolveCorsOrigin(req) {
  const requestOrigin = req.headers.origin;
  if (!requestOrigin) return corsOrigins[0] || '*';
  if (corsOrigins.includes('*')) return requestOrigin;
  if (corsOrigins.includes(requestOrigin)) return requestOrigin;
  return corsOrigins[0] || 'http://localhost:3000';
}

function setCorsHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const test = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(textEncoder.encode(test), textEncoder.encode(digest));
}

function authFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!token) return null;
  return sessions.get(token) || null;
}

async function hasColumn(tableName, columnName) {
  const [rows] = await pool.query(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function ensureVideoHierarchyMigration() {
  if (!(await hasColumn('videos', 'hypothesis_id'))) {
    await pool.query('ALTER TABLE videos ADD COLUMN hypothesis_id TEXT');
  }

  if (!(await hasColumn('videos', 'video_type'))) {
    await pool.query("ALTER TABLE videos ADD COLUMN video_type TEXT NOT NULL DEFAULT 'organic'");
  }

  const optionalVideoColumns = [
    ['external_id', 'TEXT'],
    ['external_id_type', 'TEXT'],
    ['hook_texto', 'TEXT'],
    ['hook_tipo', 'TEXT'],
    ['cta_texto', 'TEXT'],
    ['cta_tipo', 'TEXT'],
    ['creative_id', 'TEXT'],
    ['contexto_cualitativo', 'TEXT'],
    ['clicks', 'INTEGER DEFAULT 0'],
    ['views_profile', 'INTEGER DEFAULT 0'],
    ['initiatest', 'INTEGER DEFAULT 0'],
    ['initiate_checkouts', 'INTEGER DEFAULT 0'],
    ['view_content', 'INTEGER DEFAULT 0'],
    ['formulario_lead', 'INTEGER DEFAULT 0'],
    ['purchase', 'INTEGER DEFAULT 0'],
    ['pico_viewers', 'INTEGER DEFAULT 0'],
    ['viewers_prom', 'REAL DEFAULT 0'],
    ['duracion_min', 'REAL DEFAULT 0'],
    ['nuevos_seguidores', 'INTEGER DEFAULT 0'],
    ['saves', 'INTEGER DEFAULT 0'],
    ['organic_piece_type', 'TEXT'],
    ['views_finish_pct', 'REAL DEFAULT 0'],
    ['retencion_pct', 'REAL DEFAULT 0'],
    ['tiempo_prom_seg', 'REAL DEFAULT 0'],
    ['duracion_seg', 'REAL DEFAULT 0'],
    ['campaign_id_ref', 'TEXT'],
    ['ad_set_id', 'TEXT'],
    ['ctr', 'REAL DEFAULT 0'],
    ['duracion_del_video_seg', 'REAL DEFAULT 0'],
  ];

  for (const [columnName, columnType] of optionalVideoColumns) {
    if (!(await hasColumn('videos', columnName))) {
      await pool.query(`ALTER TABLE videos ADD COLUMN ${columnName} ${columnType}`);
    }
  }


  const optionalAudienceColumns = [
    ['contexto', 'TEXT'],
    ['notas', 'TEXT'],
    ['targeting', 'TEXT'],
  ];

  for (const [columnName, columnType] of optionalAudienceColumns) {
    if (!(await hasColumn('audiences', columnName))) {
      await pool.query(`ALTER TABLE audiences ADD COLUMN ${columnName} ${columnType}`);
    }
  }
  const optionalHypothesisColumns = [
    ['hypothesis_statement', 'TEXT'],
    ['variable_x', 'TEXT'],
    ['metrica_objetivo_y', 'TEXT'],
    ['umbral_operador', 'TEXT'],
    ['umbral_valor', 'REAL'],
    ['volumen_minimo', 'REAL'],
    ['volumen_unidad', 'TEXT'],
    ['canal_principal', 'TEXT'],
    ['contexto_cualitativo', 'TEXT'],
  ];

  for (const [columnName, columnType] of optionalHypothesisColumns) {
    if (!(await hasColumn('hypotheses', columnName))) {
      await pool.query(`ALTER TABLE hypotheses ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  if (!(await hasColumn('videos', 'audience_id'))) {
    await pool.query('ALTER TABLE videos ADD COLUMN audience_id TEXT');
  }

  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_hypothesis_id ON videos(hypothesis_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(video_type)');

  const [legacyVideos] = await pool.query('SELECT id, audience_id, user_id FROM videos WHERE hypothesis_id IS NULL AND audience_id IS NOT NULL');

  for (const video of legacyVideos) {
    const [audienceRows] = await pool.query('SELECT id, campaign_id, name FROM audiences WHERE id = ?', [video.audience_id]);
    const audience = audienceRows[0];
    if (!audience) continue;

    const migrationCondition = `Migrated from audience ${audience.name || audience.id} (${audience.id})`;
    const [existingHypRows] = await pool.query(
      'SELECT id FROM hypotheses WHERE campaign_id = ? AND user_id = ? AND type = ? AND condition = ?',
      [audience.campaign_id, video.user_id, 'Auto-migrated', migrationCondition],
    );

    let hypothesisId = existingHypRows[0]?.id;
    if (!hypothesisId) {
      hypothesisId = uuid();
      await pool.query(
        'INSERT INTO hypotheses (id, campaign_id, user_id, type, condition, validation_status) VALUES (?, ?, ?, ?, ?, ?)',
        [hypothesisId, audience.campaign_id, video.user_id, 'Auto-migrated', migrationCondition, 'No Validada'],
      );
    }

    await pool.query('UPDATE videos SET hypothesis_id = ? WHERE id = ?', [hypothesisId, video.id]);
  }
}

async function runMigrations() {
  for (const statement of schemaSql) {
    await pool.query(statement);
  }
  await ensureVideoHierarchyMigration();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVolumeUnit(unit) {
  return String(unit || '').trim().toLowerCase() || 'videos';
}

function resolveVolumeField(unit) {
  const normalized = normalizeVolumeUnit(unit);
  const map = {
    views: 'views',
    clicks: 'clicks',
    videos: 'videos',
    initiatest: 'initiatest',
    duration_min: 'duracion_min',
    duracion_min: 'duracion_min',
    sessions: 'sessions',
  };
  return map[normalized] || 'videos';
}

function computeCurrentVolumeFromVideos(videos, unit) {
  const field = resolveVolumeField(unit);
  if (field === 'videos') return videos.length;
  if (field === 'sessions') {
    const unique = new Set();
    videos.forEach((video) => {
      const id = video.external_id || video.session_id || video.ad_id || video.live_id;
      if (id) unique.add(String(id));
    });
    return unique.size || videos.length;
  }
  return videos.reduce((sum, video) => sum + toNumber(video[field]), 0);
}

function buildVolumeSnapshot(hypothesis, videos) {
  const unit = normalizeVolumeUnit(hypothesis?.volumen_unidad || 'videos');
  const minimum = toNumber(hypothesis?.volumen_minimo, 0);
  const current = computeCurrentVolumeFromVideos(videos || [], unit);
  return {
    hypothesis_id: hypothesis?.id || null,
    unit,
    minimum,
    current,
    count_videos: Array.isArray(videos) ? videos.length : 0,
    meets_minimum: current >= minimum,
  };
}

function stdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  return Math.sqrt(Math.max(variance, 0));
}

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) prob = 1 - prob;
  return prob;
}

function bootstrapProbability(values, predicate, iterations = 500) {
  if (!values.length) return 0;
  let hits = 0;
  for (let i = 0; i < iterations; i += 1) {
    const sample = [];
    for (let j = 0; j < values.length; j += 1) {
      sample.push(values[Math.floor(Math.random() * values.length)]);
    }
    if (predicate(sample)) hits += 1;
  }
  return hits / iterations;
}

function percentile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedValues[base + 1] !== undefined) {
    return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
  }
  return sortedValues[base];
}

function metricFromVideo(video, metric) {
  if (metric === 'ctr') {
    if (toNumber(video.views) > 0) return toNumber(video.clicks) / toNumber(video.views);
    return toNumber(video.ctr, 0);
  }
  if (metric === 'purchase_rate') {
    if (toNumber(video.view_content) > 0) return toNumber(video.purchase) / toNumber(video.view_content);
    return 0;
  }
  return toNumber(video[metric], 0);
}

function runFrequentistAnalysis(videos, config) {
  const metric = config.primary_metric || 'ctr';
  const alpha = Number(config.alpha || 0.05);
  const threshold = Number(config.threshold_value ?? 0);
  const operator = config.threshold_operator || '>=';
  const baseline = videos.filter((video) => String(video.variant || '').toUpperCase() === 'A');
  const treatment = videos.filter((video) => String(video.variant || '').toUpperCase() === 'B');

  const baselineValues = baseline.map((video) => metricFromVideo(video, metric));
  const treatmentValues = treatment.map((video) => metricFromVideo(video, metric));
  const allValues = videos.map((video) => metricFromVideo(video, metric));
  const baselineMean = baselineValues.length ? baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length : 0;
  const treatmentMean = treatmentValues.length ? treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length : 0;
  const observedMean = allValues.length ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0;

  if (baselineValues.length >= 2 && treatmentValues.length >= 2) {
    const baselineStd = stdDev(baselineValues);
    const treatmentStd = stdDev(treatmentValues);
    const delta = treatmentMean - baselineMean;
    const se = Math.sqrt((baselineStd ** 2) / baselineValues.length + (treatmentStd ** 2) / treatmentValues.length) || 1;
    const z = delta / se;
    const pValue = 2 * (1 - normCdf(Math.abs(z)));
    const ciLow = delta - 1.96 * se;
    const ciHigh = delta + 1.96 * se;
    return {
      mode: 'ab_test',
      metric,
      delta_absolute: delta,
      delta_relative: baselineMean ? delta / baselineMean : null,
      ci_95: [ciLow, ciHigh],
      p_value: pValue,
      effect_size: (baselineStd || treatmentStd) ? delta / (((baselineStd + treatmentStd) / 2) || 1) : 0,
      passes: pValue < alpha && delta > 0,
    };
  }

  const std = stdDev(allValues);
  const se = std / Math.sqrt(Math.max(allValues.length, 1)) || 1;
  const delta = observedMean - threshold;
  const z = delta / se;
  const pValue = operator.includes('>') ? (1 - normCdf(z)) : normCdf(z);
  return {
    mode: 'threshold_test',
    metric,
    observed_mean: observedMean,
    threshold,
    delta_absolute: delta,
    ci_95: [observedMean - 1.96 * se, observedMean + 1.96 * se],
    p_value: pValue,
    effect_size: std ? delta / std : 0,
    passes: operator.includes('>') ? observedMean >= threshold && pValue < alpha : observedMean <= threshold && pValue < alpha,
  };
}

function runBayesianAnalysis(videos, config) {
  const metric = config.primary_metric || 'ctr';
  const threshold = Number(config.threshold_value ?? 0);
  if (metric === 'ctr') {
    const successes = videos.reduce((sum, video) => sum + toNumber(video.clicks), 0);
    const failures = Math.max(videos.reduce((sum, video) => sum + toNumber(video.views), 0) - successes, 0);
    const alphaPost = 1 + successes;
    const betaPost = 1 + failures;
    const mean = alphaPost / (alphaPost + betaPost);
    const variance = (alphaPost * betaPost) / (((alphaPost + betaPost) ** 2) * (alphaPost + betaPost + 1));
    const sd = Math.sqrt(Math.max(variance, 0));
    const probabilityAboveThreshold = 1 - normCdf((threshold - mean) / (sd || 1));
    return {
      model: 'beta_binomial',
      posterior_mean: mean,
      credible_interval_95: [Math.max(mean - 1.96 * sd, 0), Math.min(mean + 1.96 * sd, 1)],
      p_improvement_gt_0: 1 - normCdf((0 - mean) / (sd || 1)),
      p_improvement_gt_threshold: probabilityAboveThreshold,
      recommendation: probabilityAboveThreshold > 0.95 ? 'alto chance de éxito' : probabilityAboveThreshold < 0.3 ? 'improbable' : 'incierto',
    };
  }

  const values = videos.map((video) => metricFromVideo(video, metric));
  const sorted = [...values].sort((a, b) => a - b);
  const pAbove0 = bootstrapProbability(values, (sample) => (sample.reduce((a, b) => a + b, 0) / sample.length) > 0);
  const pAboveThreshold = bootstrapProbability(values, (sample) => (sample.reduce((a, b) => a + b, 0) / sample.length) > threshold);
  return {
    model: 'bootstrap_posterior',
    posterior_mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    credible_interval_95: [percentile(sorted, 0.025), percentile(sorted, 0.975)],
    p_improvement_gt_0: pAbove0,
    p_improvement_gt_threshold: pAboveThreshold,
    recommendation: pAboveThreshold > 0.95 ? 'alto chance de éxito' : pAboveThreshold < 0.3 ? 'improbable' : 'incierto',
  };
}

function runDataDiagnostics(videos, hypothesis, config) {
  const metric = config.primary_metric || hypothesis.metrica_objetivo_y || 'ctr';
  const missingTitle = videos.filter((video) => !video.title).length;
  const duplicateCreative = new Set();
  const seenCreative = new Set();
  for (const video of videos) {
    if (!video.creative_id) continue;
    if (seenCreative.has(video.creative_id)) duplicateCreative.add(video.creative_id);
    seenCreative.add(video.creative_id);
  }
  const values = videos.map((video) => metricFromVideo(video, metric));
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const std = stdDev(values);
  const outliers = values.filter((value) => std > 0 && Math.abs((value - mean) / std) > 3).length;
  const channels = new Set(videos.map((video) => video.video_type).filter(Boolean));
  const volume = buildVolumeSnapshot(hypothesis, videos);
  const sampleInsufficient = !volume.meets_minimum;
  const ctrInconsistencies = videos.filter((video) => toNumber(video.views) > 0 && Math.abs((toNumber(video.clicks) / toNumber(video.views)) - toNumber(video.ctr || 0)) > 0.2).length;

  return {
    checks: [
      { check: 'missing_title', status: missingTitle ? 'warning' : 'ok', detail: `${missingTitle} registros sin title` },
      { check: 'outliers', status: outliers ? 'warning' : 'ok', detail: `${outliers} outliers (>3σ)` },
      { check: 'duplicates_creative_id', status: duplicateCreative.size ? 'warning' : 'ok', detail: `${duplicateCreative.size} creative_id duplicados` },
      { check: 'mixed_channels', status: channels.size > 1 ? 'warning' : 'ok', detail: `${channels.size} tipos de canal en muestra` },
      { check: 'sample_size', status: sampleInsufficient ? 'warning' : 'ok', detail: `volumen actual=${volume.current} ${volume.unit}, mínimo=${volume.minimum} ${volume.unit}` },
      { check: 'ctr_consistency', status: ctrInconsistencies ? 'warning' : 'ok', detail: `${ctrInconsistencies} inconsistencias clicks/views vs ctr` },
    ],
    histogram: {
      metric,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      mean,
      std,
    },
    warnings_count: [missingTitle, outliers, duplicateCreative.size, channels.size > 1 ? 1 : 0, sampleInsufficient ? 1 : 0, ctrInconsistencies].filter(Boolean).length,
  };
}

function buildVerdict({ frequentist, bayesian, diagnostics, hypothesis, videos }) {
  const volume = buildVolumeSnapshot(hypothesis, videos);
  const volumeOk = volume.meets_minimum;
  const passesFrequentist = Boolean(frequentist?.passes);
  const bayesStrong = Number(bayesian?.p_improvement_gt_threshold || 0) >= 0.95;
  const cleanEnough = diagnostics.warnings_count <= 2;
  const validated = volumeOk && cleanEnough && (passesFrequentist || bayesStrong);
  const inconclusive = !validated && (!volumeOk || videos.length > 0);
  return {
    status: validated ? 'Validada' : inconclusive ? 'Inconclusa' : 'No validada',
    summary: validated
      ? 'La hipótesis supera umbral con evidencia estadística y calidad aceptable.'
      : inconclusive
        ? 'La hipótesis aún no alcanza evidencia suficiente o calidad de datos adecuada.'
        : 'No hay evidencia para validar la hipótesis.',
    confidence: {
      frequentist_pass: passesFrequentist,
      bayesian_probability: Number(bayesian?.p_improvement_gt_threshold || 0),
      volume_ok: volumeOk,
      volume_current: volume.current,
      volume_minimum: volume.minimum,
      volume_unit: volume.unit,
      warnings: diagnostics.warnings_count,
    },
    recommendation: validated
      ? 'Escalar'
      : volumeOk
        ? 'Iterar creativos / cambiar variable X'
        : 'Recolectar más muestra',
  };
}

async function loadHypothesisAnalysisContext(hypothesisId, userId, config = {}) {
  const [hypothesisRows] = await pool.query(
    `SELECT h.*
     FROM hypotheses h
     JOIN campaigns c ON c.id = h.campaign_id
     JOIN projects p ON p.id = c.project_id
     WHERE h.id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [hypothesisId, userId, userId, userId],
  );
  const hypothesis = hypothesisRows[0];
  if (!hypothesis) throw new Error('Hypothesis not found');

  const filters = ['hypothesis_id = ?', 'user_id = ?'];
  const values = [hypothesisId, userId];
  if (config.video_type) {
    filters.push('video_type = ?');
    values.push(config.video_type);
  }
  if (config.date_from) {
    filters.push('created_at >= ?');
    values.push(config.date_from);
  }
  if (config.date_to) {
    filters.push('created_at <= ?');
    values.push(config.date_to);
  }

  const [videos] = await pool.query(`SELECT * FROM videos WHERE ${filters.join(' AND ')} ORDER BY created_at DESC`, values);
  return { hypothesis, videos };
}

async function runHypothesisAnalysis(hypothesis, videos, config) {
  const volume = buildVolumeSnapshot(hypothesis, videos);
  const frequentist = runFrequentistAnalysis(videos, config);
  const bayesian = runBayesianAnalysis(videos, config);
  const diagnostics = runDataDiagnostics(videos, hypothesis, config);
  const sequential = {
    stopping_rule: 'bayesian_probability_threshold',
    can_stop: bayesian.p_improvement_gt_threshold > 0.95 || bayesian.p_improvement_gt_threshold < 0.10,
    risk_note: 'Riesgo de falso positivo controlado por regla bayesiana de stopping.',
  };
  const verdict = buildVerdict({ frequentist, bayesian, diagnostics, hypothesis, videos });
  return { frequentist, bayesian, sequential, diagnostics, verdict, volume };
}

async function fetchOwnedVideoById(videoId, userId) {
  const [rows] = await pool.query(
    `SELECT v.*
     FROM videos v
     JOIN hypotheses h ON h.id = v.hypothesis_id
     JOIN campaigns c ON c.id = h.campaign_id
     JOIN projects p ON p.id = c.project_id
     WHERE v.id = ? AND v.user_id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [videoId, userId, userId, userId, userId],
  );
  return rows[0] || null;
}

function computeDerivedVideoMetrics(video) {
  const views = Math.max(toNumber(video.views), 0);
  const clicks = Math.max(toNumber(video.clicks), 0);
  const purchase = Math.max(toNumber(video.purchase), 0);
  const viewContent = Math.max(toNumber(video.view_content), 0);
  return {
    ctr: views > 0 ? clicks / views : toNumber(video.ctr),
    purchase_rate: viewContent > 0 ? purchase / viewContent : (views > 0 ? purchase / views : 0),
    clicks_per_1000_views: views > 0 ? (1000 * clicks) / views : 0,
  };
}

function compareVideosAB(videoA, videoB, config = {}) {
  const primaryMetric = config.primaryMetric || 'ctr';
  const alpha = Number(config.alpha || 0.05);
  const mde = Number(config.mde || 0.1);
  const minExposure = Number(config.minExposure || 1000);
  const derivedA = computeDerivedVideoMetrics(videoA);
  const derivedB = computeDerivedVideoMetrics(videoB);
  const exposureA = Math.max(toNumber(videoA.views), 0);
  const exposureB = Math.max(toNumber(videoB.views), 0);
  const exposureOk = exposureA >= minExposure && exposureB >= minExposure;

  let frequentist;
  let bayesian;

  if (primaryMetric === 'ctr' || primaryMetric === 'purchase_rate') {
    const successA = primaryMetric === 'ctr' ? toNumber(videoA.clicks) : toNumber(videoA.purchase);
    const totalA = primaryMetric === 'ctr' ? Math.max(toNumber(videoA.views), 1) : Math.max(toNumber(videoA.view_content || videoA.views), 1);
    const successB = primaryMetric === 'ctr' ? toNumber(videoB.clicks) : toNumber(videoB.purchase);
    const totalB = primaryMetric === 'ctr' ? Math.max(toNumber(videoB.views), 1) : Math.max(toNumber(videoB.view_content || videoB.views), 1);
    const p1 = successA / totalA;
    const p2 = successB / totalB;
    const pooled = (successA + successB) / (totalA + totalB);
    const se = Math.sqrt(Math.max(pooled * (1 - pooled) * ((1 / totalA) + (1 / totalB)), 1e-12));
    const z = (p2 - p1) / se;
    const pValue = 2 * (1 - normCdf(Math.abs(z)));
    frequentist = {
      metric: primaryMetric,
      p_value: pValue,
      uplift_absolute: p2 - p1,
      uplift_relative: p1 ? (p2 - p1) / p1 : null,
      ci95_delta: [(p2 - p1) - 1.96 * se, (p2 - p1) + 1.96 * se],
      winner: pValue < alpha ? (p2 > p1 ? 'B' : 'A') : 'Inconcluso',
    };
    bayesian = {
      p_b_gt_a: normCdf((p2 - p1) / (se || 1)),
      p_uplift_gt_mde: normCdf(((p2 - p1) - mde) / (se || 1)),
    };
  } else {
    const aRate = derivedA.clicks_per_1000_views;
    const bRate = derivedB.clicks_per_1000_views;
    const delta = bRate - aRate;
    const se = Math.sqrt(Math.max((Math.abs(aRate) + Math.abs(bRate)) / Math.max(exposureA + exposureB, 1), 1e-6));
    const z = delta / se;
    const pValue = 2 * (1 - normCdf(Math.abs(z)));
    frequentist = {
      metric: primaryMetric,
      normalized_metric: 'clicks_per_1000_views',
      p_value: pValue,
      uplift_absolute: delta,
      uplift_relative: aRate ? delta / aRate : null,
      ci95_delta: [delta - 1.96 * se, delta + 1.96 * se],
      winner: pValue < alpha ? (delta > 0 ? 'B' : 'A') : 'Inconcluso',
    };
    bayesian = {
      p_b_gt_a: delta > 0 ? 0.8 : 0.2,
      p_uplift_gt_mde: Math.abs(delta) > mde ? 0.8 : 0.4,
    };
  }

  const sequentialDecision = !exposureOk
    ? 'Inconcluso'
    : bayesian.p_b_gt_a > 0.95
      ? 'Ganador B'
      : bayesian.p_b_gt_a < 0.05
        ? 'Ganador A'
        : 'Inconcluso';

  const mixedTypes = (videoA.video_type || '') !== (videoB.video_type || '');
  const qualityFlags = [];
  if (mixedTypes) qualityFlags.push('Comparar tipos distintos puede sesgar el resultado');
  if (toNumber(videoA.ctr) > 1 || toNumber(videoB.ctr) > 1) qualityFlags.push('CTR inconsistente detectado');

  const decision = !exposureOk
    ? 'Inconcluso'
    : frequentist.winner === 'Inconcluso'
      ? sequentialDecision
      : `Ganador ${frequentist.winner}`;

  return {
    primary_metric: primaryMetric,
    derived: { A: derivedA, B: derivedB },
    frequentist,
    bayesian,
    sequential: {
      min_exposure: minExposure,
      exposure_a: exposureA,
      exposure_b: exposureB,
      exposure_ok: exposureOk,
      decision: sequentialDecision,
    },
    quality_flags: qualityFlags,
    mixed_types: mixedTypes,
    decision,
    recommendations: decision === 'Ganador B'
      ? ['Escalar variante B', 'Mantener observación de calidad', 'Documentar aprendizaje creativo']
      : decision === 'Ganador A'
        ? ['Mantener variante A', 'Iterar elementos de B', 'Repetir test con más muestra']
        : ['Recolectar más muestra', 'No decidir todavía', 'Revisar hook/CTA'],
  };
}

async function executeCrudQuery(body, currentUserId) {
  const table = body.table;
  const operation = body.operation || 'select';
  const payload = body.payload || null;
  const filters = Array.isArray(body.filters) ? [...body.filters] : [];
  const orderBy = body.orderBy || null;

  if (!allowedTables.has(table)) throw new Error('Table not allowed');
  const quotedTable = normalizeIdentifier(table);

  if (table !== 'users') {
    const hasUserFilter = filters.some((entry) => entry?.field === 'user_id');
    if (!hasUserFilter) filters.push({ field: 'user_id', value: currentUserId });
  }

  if (table === 'projects' && operation === 'select') {
    for (let i = filters.length - 1; i >= 0; i -= 1) {
      if (filters[i]?.field === 'user_id') filters.splice(i, 1);
    }
    filters.push({ field: 'user_id', value: currentUserId });
  }

  const where = filters.length
    ? ` WHERE ${filters.map((entry) => `${normalizeIdentifier(entry.field)} = ?`).join(' AND ')}`
    : '';
  const whereValues = filters.map((entry) => entry.value);

  if (operation === 'select') {
    const orderSql = orderBy ? ` ORDER BY ${normalizeIdentifier(orderBy.column)} ${orderBy.ascending ? 'ASC' : 'DESC'}` : '';
    const [rows] = await pool.query(`SELECT * FROM ${quotedTable}${where}${orderSql}`, whereValues);
    return rows;
  }

  if (operation === 'insert') {
    const row = Array.isArray(payload) ? payload[0] : payload;
    const writeRow = { ...row, id: row?.id || uuid() };
    if (table === 'projects') {
      delete writeRow.user_id;
      writeRow.user_id = currentUserId;
    }
    if (table === 'videos') {
      delete writeRow.user_id;
      writeRow.user_id = currentUserId;
      if (!writeRow.hypothesis_id) {
        throw new Error('videos.hypothesis_id is required');
      }
      if (!writeRow.video_type || !['paid', 'organic', 'live'].includes(String(writeRow.video_type))) {
        throw new Error("videos.video_type must be one of: paid, organic, live");
      }

      const [ownershipRows] = await pool.query(
        `SELECT h.id
         FROM hypotheses h
         JOIN campaigns c ON c.id = h.campaign_id
         JOIN projects p ON p.id = c.project_id
         WHERE h.id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
         LIMIT 1`,
        [writeRow.hypothesis_id, currentUserId, currentUserId, currentUserId],
      );
      if (!ownershipRows.length) {
        throw new Error('Invalid hypothesis_id for current user');
      }
    }
    const fields = Object.keys(writeRow);
    const placeholders = fields.map(() => '?').join(', ');
    await pool.query(
      `INSERT INTO ${quotedTable} (${fields.map(normalizeIdentifier).join(', ')}) VALUES (${placeholders})`,
      fields.map((field) => writeRow[field]),
    );
    const [inserted] = await pool.query(`SELECT * FROM ${quotedTable} WHERE id = ?`, [writeRow.id]);
    return inserted;
  }

  if (operation === 'update') {
    const fields = Object.keys(payload || {});
    if (!fields.length) throw new Error('Empty update payload');
    const setSql = fields.map((field) => `${normalizeIdentifier(field)} = ?`).join(', ');
    await pool.query(`UPDATE ${quotedTable} SET ${setSql}${where}`, [...fields.map((field) => payload[field]), ...whereValues]);
    const [updated] = await pool.query(`SELECT * FROM ${quotedTable}${where}`, whereValues);
    return updated;
  }

  if (operation === 'delete') {
    await pool.query(`DELETE FROM ${quotedTable}${where}`, whereValues);
    return [];
  }

  throw new Error(`Unsupported operation: ${operation}`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.url === '/api/health' && req.method === 'GET') {
      await pool.query('SELECT 1 AS ok');
      sendJson(req, res, 200, { ok: true, error: null });
      return;
    }

    if (req.url === '/api/auth/signup' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.email || !body.password) {
        sendJson(req, res, 400, { error: 'Email and password are required' });
        return;
      }

      const [existing] = await pool.query('SELECT id, email FROM users WHERE email = ?', [body.email]);
      if (existing.length) {
        sendJson(req, res, 409, { error: 'Email already registered' });
        return;
      }

      const user = { id: uuid(), email: body.email, password_hash: hashPassword(body.password) };
      await pool.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [user.id, user.email, user.password_hash]);

      const token = uuid();
      const session = { access_token: token, user: { id: user.id, email: user.email } };
      sessions.set(token, session.user);
      sendJson(req, res, 200, { session, user: session.user });
      return;
    }

    if (req.url === '/api/auth/signin' && req.method === 'POST') {
      const body = await readBody(req);
      const [rows] = await pool.query('SELECT id, email, password_hash FROM users WHERE email = ?', [body.email || '']);
      const dbUser = rows[0];
      if (!dbUser || !verifyPassword(body.password || '', dbUser.password_hash)) {
        sendJson(req, res, 401, { error: 'Invalid credentials' });
        return;
      }

      const token = uuid();
      const session = { access_token: token, user: { id: dbUser.id, email: dbUser.email } };
      sessions.set(token, session.user);
      sendJson(req, res, 200, { session, user: session.user });
      return;
    }

    if (req.url === '/api/auth/me' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      sendJson(req, res, 200, { user });
      return;
    }

    if (req.url === '/api/auth/signout' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      sessions.delete(token);
      sendJson(req, res, 200, { ok: true });
      return;
    }

    const videoMatch = url.pathname.match(/^\/api\/videos\/([^/]+)$/);
    if (videoMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const video = await fetchOwnedVideoById(videoMatch[1], user.id);
      if (!video) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }
      sendJson(req, res, 200, { video });
      return;
    }

    if (videoMatch && req.method === 'PATCH') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const existing = await fetchOwnedVideoById(videoMatch[1], user.id);
      if (!existing) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }

      const body = await readBody(req);
      if ('hypothesis_id' in body || 'video_type' in body) {
        sendJson(req, res, 400, { error: 'hypothesis_id and video_type cannot be changed' });
        return;
      }

      const disallowed = new Set(['id', 'user_id', 'created_at']);
      const entries = Object.entries(body || {}).filter(([key]) => !disallowed.has(key));
      if (!entries.length) {
        sendJson(req, res, 400, { error: 'No editable fields provided' });
        return;
      }

      const setSql = entries.map(([field]) => `${normalizeIdentifier(field)} = ?`).join(', ');
      const values = entries.map(([, value]) => value);
      await pool.query(`UPDATE videos SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [...values, existing.id, user.id]);
      const updated = await fetchOwnedVideoById(existing.id, user.id);
      sendJson(req, res, 200, { video: updated });
      return;
    }

    if (url.pathname === '/api/ab-test' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      const videoAId = body.videoAId;
      const videoBId = body.videoBId;
      if (!videoAId || !videoBId) {
        sendJson(req, res, 400, { error: 'videoAId and videoBId are required' });
        return;
      }

      const videoA = await fetchOwnedVideoById(videoAId, user.id);
      const videoB = await fetchOwnedVideoById(videoBId, user.id);
      if (!videoA || !videoB) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }
      if (videoA.hypothesis_id !== videoB.hypothesis_id) {
        sendJson(req, res, 400, { error: 'Both videos must belong to same hypothesis' });
        return;
      }

      const config = {
        primaryMetric: body.primaryMetric || 'ctr',
        method: body.method || 'hybrid',
        alpha: Number(body.alpha || 0.05),
        mde: Number(body.mde || 0.1),
        exposureUnit: body.exposureUnit || 'views',
        minExposure: Number(body.minExposure || 1000),
      };

      const results = compareVideosAB(videoA, videoB, config);
      const datasetHash = crypto.createHash('sha256').update([videoA.id, videoB.id, videoA.updated_at || '', videoB.updated_at || ''].join('|')).digest('hex');
      const testId = uuid();
      await pool.query(
        'INSERT INTO video_ab_tests (id, hypothesis_id, video_a_id, video_b_id, config_json, results_json, dataset_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [testId, videoA.hypothesis_id, videoA.id, videoB.id, JSON.stringify(config), JSON.stringify(results), datasetHash],
      );

      sendJson(req, res, 200, { id: testId, hypothesis_id: videoA.hypothesis_id, config, results, dataset_hash: datasetHash });
      return;
    }

    const videoHistoryMatch = url.pathname.match(/^\/api\/videos\/([^/]+)\/ab-tests$/);
    if (videoHistoryMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const video = await fetchOwnedVideoById(videoHistoryMatch[1], user.id);
      if (!video) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }

      const [rows] = await pool.query(
        `SELECT * FROM video_ab_tests
         WHERE hypothesis_id = ? AND (video_a_id = ? OR video_b_id = ?)
         ORDER BY created_at DESC LIMIT 30`,
        [video.hypothesis_id, video.id, video.id],
      );
      sendJson(req, res, 200, { data: rows });
      return;
    }

    const analysisDataMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/analysis-data$/);
    if (analysisDataMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const hypothesisId = analysisDataMatch[1];
      const config = {
        video_type: url.searchParams.get('video_type') || '',
        date_from: url.searchParams.get('date_from') || '',
        date_to: url.searchParams.get('date_to') || '',
      };

      const { hypothesis, videos } = await loadHypothesisAnalysisContext(hypothesisId, user.id, config);
      const volume = buildVolumeSnapshot(hypothesis, videos);
      const [runs] = await pool.query(
        'SELECT id, hypothesis_id, created_at, config_json, results_json, dataset_hash FROM hypothesis_analysis_runs WHERE hypothesis_id = ? ORDER BY created_at DESC LIMIT 15',
        [hypothesisId],
      );
      sendJson(req, res, 200, { hypothesis, videos, runs, volume });
      return;
    }

    const volumeMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/volume$/);
    if (volumeMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const hypothesisId = volumeMatch[1];
      const config = {
        video_type: url.searchParams.get('video_type') || '',
        date_from: url.searchParams.get('date_from') || '',
        date_to: url.searchParams.get('date_to') || '',
      };
      const { hypothesis, videos } = await loadHypothesisAnalysisContext(hypothesisId, user.id, config);
      sendJson(req, res, 200, buildVolumeSnapshot(hypothesis, videos));
      return;
    }

    const analyzeMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/analyze$/);
    if (analyzeMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const hypothesisId = analyzeMatch[1];
      const body = await readBody(req);
      const config = {
        primary_metric: body.primary_metric || 'ctr',
        secondary_metrics: Array.isArray(body.secondary_metrics) ? body.secondary_metrics : [],
        analysis_unit: body.analysis_unit || 'video',
        comparison_mode: body.comparison_mode || 'threshold',
        method: body.method || 'hybrid',
        correction: body.correction || 'none',
        alpha: Number(body.alpha || 0.05),
        power: Number(body.power || 0.8),
        mde: Number(body.mde || 0.1),
        threshold_operator: body.threshold_operator || '>=',
        threshold_value: Number(body.threshold_value ?? 0),
        video_type: body.video_type || '',
        date_from: body.date_from || '',
        date_to: body.date_to || '',
      };

      const { hypothesis, videos } = await loadHypothesisAnalysisContext(hypothesisId, user.id, config);
      const results = await runHypothesisAnalysis(hypothesis, videos, config);
      const datasetHash = crypto.createHash('sha256').update(videos.map((video) => video.id).sort().join('|')).digest('hex');
      const runId = uuid();
      await pool.query(
        'INSERT INTO hypothesis_analysis_runs (id, hypothesis_id, config_json, results_json, dataset_hash) VALUES (?, ?, ?, ?, ?)',
        [runId, hypothesisId, JSON.stringify(config), JSON.stringify(results), datasetHash],
      );

      await pool.query('UPDATE hypotheses SET validation_status = ? WHERE id = ?', [results.verdict.status, hypothesisId]);

      sendJson(req, res, 200, {
        hypothesis,
        dataset_hash: datasetHash,
        run_id: runId,
        config,
        results,
        volume: results.volume,
      });
      return;
    }

    if (req.url === '/api/db/query' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      try {
        const rows = await executeCrudQuery(body, user.id);
        sendJson(req, res, 200, { data: rows, error: null });
      } catch (error) {
        const message = error?.message || String(error);
        const statusCode = message.includes('required') ? 400 : 500;
        sendJson(req, res, statusCode, { error: message });
      }
      return;
    }

    sendJson(req, res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(req, res, 500, { error: error?.message || String(error) });
  }
});

runMigrations()
  .then(() => {
    server.listen(port, () => {
      console.log(`SQLite backend running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize backend:', error);
    process.exit(1);
  });
