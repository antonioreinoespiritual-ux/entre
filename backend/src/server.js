import process from 'node:process';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
const storageRoot = path.resolve('backend/storage');

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
  `CREATE TABLE IF NOT EXISTS audience_ab_tests (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    audience_a_id TEXT NOT NULL,
    audience_b_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    config_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    dataset_hash TEXT NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_audience_ab_tests_campaign_id ON audience_ab_tests(campaign_id)',
  `CREATE TABLE IF NOT EXISTS cloud_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    storage_path TEXT,
    target_type TEXT,
    target_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cloud_nodes_user_parent ON cloud_nodes(user_id, parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_cloud_nodes_user_target ON cloud_nodes(user_id, target_type, target_id)',
  'CREATE INDEX IF NOT EXISTS idx_cloud_nodes_user_target_type ON cloud_nodes(user_id, target_type, target_id, type)',
];

const textEncoder = new TextEncoder();

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}
function autoExternalIdForVideo(videoType, videoId) {
  const normalizedVideoType = String(videoType || 'organic').trim().toLowerCase();
  const normalizedVideoId = String(videoId || '').trim();
  if (!normalizedVideoId) return null;
  if (normalizedVideoType === 'paid') return `ad-${normalizedVideoId}`;
  if (normalizedVideoType === 'live') return `live-${normalizedVideoId}`;
  return `session-${normalizedVideoId}`;
}


async function recordCloudEvent(userId, eventType, payload = {}) {
  await pool.query(
    'INSERT INTO cloud_events (id, user_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    [uuid(), userId, eventType, JSON.stringify(payload), nowIso()],
  );
}

async function getCloudNodeById(nodeId, userId) {
  const [rows] = await pool.query('SELECT * FROM cloud_nodes WHERE id = ? AND user_id = ?', [nodeId, userId]);
  return rows[0] || null;
}

async function findNodeByName(userId, parentId, name, type = 'folder') {
  const sql = parentId == null
    ? 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id IS NULL AND name = ? AND type = ? LIMIT 1'
    : 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id = ? AND name = ? AND type = ? LIMIT 1';
  const params = parentId == null
    ? [userId, name, type]
    : [userId, parentId, name, type];
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function createCloudNode({ userId, parentId = null, name, type = 'folder', mimeType = null, size = null, storagePath = null, targetType = null, targetId = null }) {
  const node = {
    id: uuid(),
    user_id: userId,
    parent_id: parentId,
    name,
    type,
    mime_type: mimeType,
    size,
    storage_path: storagePath,
    target_type: targetType,
    target_id: targetId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO cloud_nodes (id, user_id, parent_id, name, type, mime_type, size, storage_path, target_type, target_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [node.id, node.user_id, node.parent_id, node.name, node.type, node.mime_type, node.size, node.storage_path, node.target_type, node.target_id, node.created_at, node.updated_at],
  );
  return node;
}

async function ensureFolder(userId, parentId, name) {
  const existing = await findNodeByName(userId, parentId, name, 'folder');
  if (existing) return existing;
  return createCloudNode({ userId, parentId, name, type: 'folder' });
}

async function ensureTargetFolder(userId, parentId, name, targetType, targetId) {
  const sql = parentId == null
    ? 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id IS NULL AND type = ? AND target_type = ? AND target_id = ? LIMIT 1'
    : 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id = ? AND type = ? AND target_type = ? AND target_id = ? LIMIT 1';
  const params = parentId == null
    ? [userId, 'folder', targetType, targetId]
    : [userId, parentId, 'folder', targetType, targetId];
  const [rows] = await pool.query(sql, params);
  const existing = rows[0];
  if (existing) {
    if (existing.name !== name) {
      await pool.query('UPDATE cloud_nodes SET name = ?, updated_at = ? WHERE id = ?', [name, nowIso(), existing.id]);
      existing.name = name;
    }
    return existing;
  }
  return createCloudNode({ userId, parentId, name, type: 'folder', targetType, targetId });
}

const VIDEO_FOLDER_TEMPLATES = ['Raw', 'Audio', 'Guion', 'Thumbnails', 'Capturas', 'Export'];

async function ensureVideoCloudFolderStructure(userId, parentId, video) {
  const videoName = (video.title || video.record_name || `Video ${video.id}`).slice(0, 80);
  const videoFolder = await ensureTargetFolder(userId, parentId, videoName, 'video', video.id);
  for (const subfolderName of VIDEO_FOLDER_TEMPLATES) {
    await ensureFolder(userId, videoFolder.id, subfolderName);
  }
  await ensureShortcut(userId, videoFolder.id, 'Abrir dashboard', 'video', video.id);
  return videoFolder;
}

async function migrateVideoShortcutsToFolders(userId) {
  const [legacyShortcuts] = await pool.query(
    `SELECT s.*
     FROM cloud_nodes s
     LEFT JOIN cloud_nodes p ON p.id = s.parent_id AND p.user_id = s.user_id
     WHERE s.user_id = ?
       AND s.type = 'shortcut'
       AND s.target_type = 'video'
       AND (p.id IS NULL OR p.target_type != 'video' OR p.type != 'folder')`,
    [userId],
  );

  for (const shortcut of legacyShortcuts) {
    const folder = await ensureTargetFolder(
      userId,
      shortcut.parent_id,
      (shortcut.name || `Video ${shortcut.target_id}`).slice(0, 80),
      'video',
      shortcut.target_id,
    );

    await pool.query('UPDATE cloud_nodes SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND user_id = ?', [folder.id, nowIso(), shortcut.id, userId]);
    for (const subfolderName of VIDEO_FOLDER_TEMPLATES) {
      await ensureFolder(userId, folder.id, subfolderName);
    }
    await ensureShortcut(userId, folder.id, 'Abrir dashboard', 'video', shortcut.target_id);
    await pool.query('DELETE FROM cloud_nodes WHERE id = ? AND user_id = ?', [shortcut.id, userId]);
  }
}

async function findCloudShortcut(userId, parentId, targetType, targetId) {
  const sql = parentId == null
    ? 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id IS NULL AND type = ? AND target_type = ? AND target_id = ? LIMIT 1'
    : 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id = ? AND type = ? AND target_type = ? AND target_id = ? LIMIT 1';
  const params = parentId == null
    ? [userId, 'shortcut', targetType, targetId]
    : [userId, parentId, 'shortcut', targetType, targetId];
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function ensureShortcut(userId, parentId, name, targetType, targetId) {
  const existing = await findCloudShortcut(userId, parentId, targetType, targetId);
  if (existing) {
    if (existing.name !== name) {
      await pool.query('UPDATE cloud_nodes SET name = ?, updated_at = ? WHERE id = ?', [name, nowIso(), existing.id]);
      existing.name = name;
    }
    return existing;
  }
  return createCloudNode({ userId, parentId, name, type: 'shortcut', targetType, targetId });
}

async function syncCloudForUser(userId) {
  await migrateVideoShortcutsToFolders(userId);

  const root = await ensureFolder(userId, null, 'Cloud');
  const projectsFolder = await ensureFolder(userId, root.id, 'Proyectos');

  const [projects] = await pool.query('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  const [campaigns] = await pool.query('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  const [audiences] = await pool.query('SELECT * FROM audiences WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  const [hypotheses] = await pool.query('SELECT * FROM hypotheses WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  const [videos] = await pool.query('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at ASC', [userId]);

  for (const project of projects) {
    const projectFolder = await ensureFolder(userId, projectsFolder.id, project.name || `Proyecto ${project.id}`);
    await ensureShortcut(userId, projectFolder.id, 'Abrir proyecto', 'project', project.id);
    const campaignsFolder = await ensureFolder(userId, projectFolder.id, 'Campañas');

    const projectCampaigns = campaigns.filter((campaign) => campaign.project_id === project.id);
    for (const campaign of projectCampaigns) {
      const campaignFolder = await ensureFolder(userId, campaignsFolder.id, campaign.name || `Campaña ${campaign.id}`);
      await ensureShortcut(userId, campaignFolder.id, 'Abrir campaña', 'campaign', campaign.id);

      const audiencesFolder = await ensureFolder(userId, campaignFolder.id, 'Audiencias');
      const hypothesesFolder = await ensureFolder(userId, campaignFolder.id, 'Hipótesis');
      const audienceVideosMap = new Map();

      const campaignAudiences = audiences.filter((audience) => audience.campaign_id === campaign.id);
      for (const audience of campaignAudiences) {
        const audienceFolder = await ensureFolder(userId, audiencesFolder.id, audience.name || `Audiencia ${audience.id}`);
        await ensureShortcut(userId, audienceFolder.id, 'Abrir audiencia', 'audience', audience.id);
        audienceVideosMap.set(audience.id, await ensureFolder(userId, audienceFolder.id, 'Videos'));
      }

      const campaignHypotheses = hypotheses.filter((hypothesis) => hypothesis.campaign_id === campaign.id);
      for (const hypothesis of campaignHypotheses) {
        const hypothesisName = hypothesis.hypothesis_statement || hypothesis.condition || hypothesis.type || `Hipótesis ${hypothesis.id}`;
        const hypothesisFolder = await ensureFolder(userId, hypothesesFolder.id, hypothesisName.slice(0, 80));
        await ensureShortcut(userId, hypothesisFolder.id, 'Abrir hipótesis', 'hypothesis', hypothesis.id);
        const videosFolder = await ensureFolder(userId, hypothesisFolder.id, 'Videos');

        const hypothesisVideos = videos.filter((video) => video.hypothesis_id === hypothesis.id);
        for (const video of hypothesisVideos) {
          const videoFolder = await ensureVideoCloudFolderStructure(userId, videosFolder.id, video);
          if (video.audience_id && audienceVideosMap.has(video.audience_id)) {
            await ensureShortcut(userId, audienceVideosMap.get(video.audience_id).id, videoFolder.name, 'video', video.id);
          }
        }
      }
    }
  }

  await recordCloudEvent(userId, 'sync', { scope: 'full' });
}

async function locateCloudNodeForTarget(userId, targetType, targetId) {
  const [rows] = await pool.query(
    `SELECT * FROM cloud_nodes
     WHERE user_id = ? AND target_type = ? AND target_id = ?
     ORDER BY CASE WHEN ? = 'video' AND type = 'folder' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [userId, targetType, targetId, targetType],
  );
  return rows[0] || null;
}

async function resolveShortcutAppLink(userId, targetType, targetId) {
  if (targetType === 'project') {
    return `/projects/${targetId}`;
  }

  if (targetType === 'campaign') {
    const [rows] = await pool.query(
      `SELECT c.id AS campaign_id, p.id AS project_id
       FROM campaigns c
       JOIN projects p ON p.id = c.project_id
       WHERE c.id = ? AND c.user_id = ? AND p.user_id = ?
       LIMIT 1`,
      [targetId, userId, userId],
    );
    const row = rows[0];
    return row ? `/projects/${row.project_id}/campaigns/${row.campaign_id}` : '/projects';
  }

  if (targetType === 'audience') {
    const [rows] = await pool.query(
      `SELECT a.id AS audience_id, c.id AS campaign_id, p.id AS project_id
       FROM audiences a
       JOIN campaigns c ON c.id = a.campaign_id
       JOIN projects p ON p.id = c.project_id
       WHERE a.id = ? AND a.user_id = ? AND c.user_id = ? AND p.user_id = ?
       LIMIT 1`,
      [targetId, userId, userId, userId],
    );
    const row = rows[0];
    return row ? `/projects/${row.project_id}/campaigns/${row.campaign_id}/audiences/${row.audience_id}` : '/projects';
  }

  if (targetType === 'hypothesis') {
    const [rows] = await pool.query(
      `SELECT h.id AS hypothesis_id, c.id AS campaign_id, p.id AS project_id
       FROM hypotheses h
       JOIN campaigns c ON c.id = h.campaign_id
       JOIN projects p ON p.id = c.project_id
       WHERE h.id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
       LIMIT 1`,
      [targetId, userId, userId, userId],
    );
    const row = rows[0];
    return row ? `/projects/${row.project_id}/campaigns/${row.campaign_id}/hypotheses/${row.hypothesis_id}` : '/projects';
  }

  if (targetType === 'video') {
    const [rows] = await pool.query(
      `SELECT v.id AS video_id, h.id AS hypothesis_id, c.id AS campaign_id, p.id AS project_id
       FROM videos v
       JOIN hypotheses h ON h.id = v.hypothesis_id
       JOIN campaigns c ON c.id = h.campaign_id
       JOIN projects p ON p.id = c.project_id
       WHERE v.id = ? AND v.user_id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
       LIMIT 1`,
      [targetId, userId, userId, userId, userId],
    );
    const row = rows[0];
    return row ? `/projects/${row.project_id}/campaigns/${row.campaign_id}/hypotheses/${row.hypothesis_id}/videos/${row.video_id}` : '/projects';
  }

  return '/projects';
}

async function getCloudBreadcrumbs(userId, nodeId) {
  const breadcrumbs = [];
  let currentId = nodeId;
  while (currentId) {
    const node = await getCloudNodeById(currentId, userId);
    if (!node) break;
    breadcrumbs.unshift({ id: node.id, name: node.name, type: node.type });
    currentId = node.parent_id;
  }
  return breadcrumbs;
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

  // DX fallback: allow common local network dev origins (e.g. http://192.168.x.x:3000)
  // when CORS_ORIGIN was not explicitly configured for the LAN IP.
  try {
    const parsed = new URL(requestOrigin);
    const hostname = parsed.hostname || '';
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const isPrivateLan = /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    const isDevPort = ['3000', '5173'].includes(port);

    if ((isLocalhost || isPrivateLan) && isDevPort) {
      return requestOrigin;
    }
  } catch {
    // Ignore malformed origin and fall back to configured default.
  }

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
    ['ad_id', 'TEXT'],
    ['video_id', 'INTEGER'],
    ['ctr', 'REAL DEFAULT 0'],
    ['duracion_del_video_seg', 'REAL DEFAULT 0'],
    ['metrics_json', 'TEXT'],
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_video_id ON videos(video_id)');


  const [maxVideoIdRows] = await pool.query(
    `SELECT COALESCE(MAX(CASE
      WHEN trim(CAST(video_id AS TEXT)) <> '' AND trim(CAST(video_id AS TEXT)) GLOB '[0-9]*'
      THEN CAST(video_id AS INTEGER)
      ELSE NULL
    END), 0) AS max_video_id FROM videos`,
  );
  let nextVideoId = Number(maxVideoIdRows[0]?.max_video_id || 0) + 1;
  const [videosWithoutVideoId] = await pool.query('SELECT id FROM videos WHERE video_id IS NULL ORDER BY created_at ASC, id ASC');
  for (const video of videosWithoutVideoId) {
    await pool.query('UPDATE videos SET video_id = ? WHERE id = ?', [nextVideoId, video.id]);
    nextVideoId += 1;
  }

  const [videosWithoutExternalId] = await pool.query(
    `SELECT id, video_id, video_type
     FROM videos
     WHERE (external_id IS NULL OR trim(external_id) = '')
       AND video_id IS NOT NULL
     ORDER BY created_at ASC, id ASC`,
  );
  for (const video of videosWithoutExternalId) {
    const generatedExternalId = autoExternalIdForVideo(video.video_type, video.video_id);
    if (!generatedExternalId) continue;
    await pool.query('UPDATE videos SET external_id = ? WHERE id = ?', [generatedExternalId, video.id]);
  }

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

const bulkVideoAllowedFields = new Map([
  ['views', { column: 'views', type: 'int' }],
  ['clicks', { column: 'clicks', type: 'int' }],
  ['ctr', { column: 'ctr', type: 'float' }],
  ['cpc', { column: 'cpc', type: 'float' }],
  ['initiate_checkouts', { column: 'initiate_checkouts', type: 'int' }],
  ['view_content', { column: 'view_content', type: 'int' }],
  ['lead_form', { column: 'formulario_lead', type: 'int' }],
  ['purchase', { column: 'purchase', type: 'int' }],
  ['likes', { column: 'likes', type: 'int' }],
  ['comments', { column: 'comments', type: 'int' }],
  ['shares', { column: 'shares', type: 'int' }],
  ['saves', { column: 'saves', type: 'int' }],
  ['new_followers', { column: 'nuevos_seguidores', type: 'int' }],
  ['avg_watch_time_sec', { column: 'tiempo_prom_seg', type: 'float' }],
  ['retention_pct', { column: 'retencion_pct', type: 'float' }],
  ['views_finish_pct', { column: 'views_finish_pct', type: 'float' }],
  ['campaign_id', { column: 'campaign_id_ref', type: 'text' }],
  ['ad_set_id', { column: 'ad_set_id', type: 'text' }],
  ['ad_id', { column: 'ad_id', type: 'text' }],
  ['url', { column: 'url', type: 'text' }],
  ['video_type', { column: 'video_type', type: 'enum', enumValues: ['paid', 'organic', 'live'] }],
]);

function parseTypedValue(value, type) {
  if (value == null || value === '') return null;
  if (type === 'text') return String(value);
  if (type === 'enum') return String(value).trim().toLowerCase();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (type === 'int') return Math.trunc(parsed);
  return parsed;
}

function normalizeBulkUpdateFields(fields) {
  const normalizedFields = {};
  const invalidKeys = [];

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return { normalizedFields, invalidKeys: ['fields_must_be_object'] };
  }

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) continue;
    const config = bulkVideoAllowedFields.get(key);
    if (!config) {
      invalidKeys.push(rawKey);
      continue;
    }
    const typed = parseTypedValue(rawValue, config.type);
    if (typed == null && rawValue !== null && rawValue !== '') {
      invalidKeys.push(rawKey);
      continue;
    }
    if (config.type === 'enum' && !config.enumValues.includes(typed)) {
      invalidKeys.push(rawKey);
      continue;
    }
    normalizedFields[config.column] = typed;
  }

  return { normalizedFields, invalidKeys };
}

function normalizeIdentifierPayload(updateItem = {}) {
  return {
    ...updateItem,
    video_id: updateItem.video_id ?? updateItem.record_id ?? null,
    video_name: updateItem.video_name ?? updateItem.record_name ?? updateItem.name ?? null,
  };
}

function stringifyIdentifierValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

async function resolveVideoIdentifier(updateItem, authUserId) {
  const normalized = normalizeIdentifierPayload(updateItem);
  const notFoundReasons = [];

  const videoIdRaw = stringifyIdentifierValue(normalized.video_id);
  if (videoIdRaw) {
    const [rows] = await pool.query(
      `SELECT id
       FROM videos
       WHERE user_id = ?
         AND (
           id = ?
           OR CAST(id AS TEXT) = ?
           OR CAST(video_id AS TEXT) = ?
           OR (
             ? GLOB '[0-9]*'
             AND CAST(video_id AS INTEGER) = CAST(? AS INTEGER)
           )
         )
       LIMIT 1`,
      [authUserId, videoIdRaw, videoIdRaw, videoIdRaw, videoIdRaw, videoIdRaw],
    );
    if (rows[0]) {
      return { matched: true, matchedVideoId: String(rows[0].id), identifierUsed: 'video_id', reasonIfNotFound: null };
    }

    // Compatibilidad: en algunos flujos antiguos "record_id" llegaba en external_id/session_id.
    const [legacyRows] = await pool.query(
      'SELECT id FROM videos WHERE user_id = ? AND lower(external_id) = lower(?) LIMIT 1',
      [authUserId, videoIdRaw],
    );
    if (legacyRows[0]) {
      return { matched: true, matchedVideoId: String(legacyRows[0].id), identifierUsed: 'video_id(external_id)', reasonIfNotFound: null };
    }

    notFoundReasons.push(`video_id_not_found:${videoIdRaw}`);
  }

  const sessionIdRaw = stringifyIdentifierValue(normalized.session_id);
  if (sessionIdRaw) {
    const [rows] = await pool.query('SELECT id FROM videos WHERE user_id = ? AND lower(external_id) = lower(?) LIMIT 1', [authUserId, sessionIdRaw]);
    if (rows[0]) {
      return { matched: true, matchedVideoId: String(rows[0].id), identifierUsed: 'session_id', reasonIfNotFound: null };
    }
    notFoundReasons.push(`session_id_not_found:${sessionIdRaw}`);
  }

  const videoNameRaw = stringifyIdentifierValue(normalized.video_name);
  if (videoNameRaw) {
    const [rows] = await pool.query('SELECT id FROM videos WHERE user_id = ? AND lower(title) = lower(?) LIMIT 1', [authUserId, videoNameRaw]);
    if (rows[0]) {
      return { matched: true, matchedVideoId: String(rows[0].id), identifierUsed: 'video_name', reasonIfNotFound: null };
    }
    notFoundReasons.push(`video_name_not_found:${videoNameRaw}`);
  }

  if (!videoIdRaw && !sessionIdRaw && !videoNameRaw) {
    return { matched: false, matchedVideoId: null, identifierUsed: null, reasonIfNotFound: 'missing_identifier' };
  }

  const attempted = [videoIdRaw ? 'video_id' : null, sessionIdRaw ? 'session_id' : null, videoNameRaw ? 'video_name' : null].filter(Boolean);
  return {
    matched: false,
    matchedVideoId: null,
    identifierUsed: attempted.join('->') || null,
    reasonIfNotFound: notFoundReasons.join('|') || 'not_found',
  };
}

function normalizeVolumeUnit(unit) {
  return String(unit || '').trim().toLowerCase() || 'videos';
}

function resolveVolumeField(unit) {
  const normalized = normalizeVolumeUnit(unit);
  const map = {
    views: 'views',
    clicks: 'clicks',
    ctr: 'ctr',
    cpc: 'cpc',
    initiate_checkout_rate: 'initiate_checkout_rate',
    view_content_rate: 'view_content_rate',
    lead_rate: 'lead_rate',
    purchase_rate: 'purchase_rate',
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
  if (field === 'initiate_checkout_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.initiateCheckouts += toNumber(video.initiate_checkouts);
      return acc;
    }, { views: 0, initiateCheckouts: 0 });
    return totals.views > 0 ? totals.initiateCheckouts / totals.views : 0;
  }
  if (field === 'view_content_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.viewContent += toNumber(video.view_content);
      return acc;
    }, { views: 0, viewContent: 0 });
    return totals.views > 0 ? totals.viewContent / totals.views : 0;
  }
  if (field === 'lead_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.leads += toNumber(video.formulario_lead);
      return acc;
    }, { views: 0, leads: 0 });
    return totals.views > 0 ? totals.leads / totals.views : 0;
  }
  if (field === 'purchase_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.viewContent += toNumber(video.view_content);
      acc.purchase += toNumber(video.purchase);
      return acc;
    }, { viewContent: 0, purchase: 0 });
    return totals.viewContent > 0 ? totals.purchase / totals.viewContent : 0;
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
  const normalizedMetric = String(metric || '').trim().toLowerCase();
  if (normalizedMetric === 'ctr') {
    if (toNumber(video.views) > 0) return toNumber(video.clicks) / toNumber(video.views);
    return toNumber(video.ctr, 0);
  }

  if (normalizedMetric === 'purchase_rate') {
    if (toNumber(video.view_content) > 0) return toNumber(video.purchase) / toNumber(video.view_content);
    return 0;
  }

  if (normalizedMetric === 'initiate_checkout_rate') {
    if (toNumber(video.views) > 0) return toNumber(video.initiate_checkouts) / toNumber(video.views);
    return 0;
  }

  if (normalizedMetric === 'view_content_rate') {
    if (toNumber(video.views) > 0) return toNumber(video.view_content) / toNumber(video.views);
    return 0;
  }

  if (normalizedMetric === 'lead_rate') {
    if (toNumber(video.views) > 0) return toNumber(video.formulario_lead) / toNumber(video.views);
    return 0;
  }

  const metricAliasToField = {
    'views finish %': 'views_finish_pct',
    'retention %': 'retencion_pct',
    'avg watch time': 'tiempo_prom_seg',
    'live peak viewers': 'pico_viewers',
    'live avg viewers': 'viewers_prom',
    'live new followers': 'nuevos_seguidores',
  };

  const resolvedField = metricAliasToField[normalizedMetric] || metric;
  return toNumber(video[resolvedField], 0);
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

function buildAudienceAggregates(videos = []) {
  const sums = {
    views: 0,
    clicks: 0,
    initiatest: 0,
    initiate_checkouts: 0,
    view_content: 0,
    formulario_lead: 0,
    purchase: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
  };
  for (const video of videos) {
    Object.keys(sums).forEach((key) => {
      sums[key] += toNumber(video[key]);
    });
  }
  const denomViews = Math.max(sums.views, 0);
  const rates = {
    ctr: denomViews > 0 ? sums.clicks / denomViews : 0,
    purchase_rate: denomViews > 0 ? sums.purchase / denomViews : 0,
    lead_rate: denomViews > 0 ? sums.formulario_lead / denomViews : 0,
    initiate_rate: denomViews > 0 ? sums.initiatest / denomViews : 0,
  };
  return {
    counts: { videos: videos.length },
    sums,
    rates,
  };
}

function buildAudienceWarnings(videos = [], selectedType = 'all', minViews = 1000) {
  const missingViews = videos.filter((video) => toNumber(video.views) <= 0).length;
  const inconsistentCtr = videos.filter((video) => toNumber(video.views) > 0 && Math.abs((toNumber(video.clicks) / toNumber(video.views)) - toNumber(video.ctr || 0)) > 0.2).length;
  const types = new Set(videos.map((video) => video.video_type).filter(Boolean));
  const totalViews = videos.reduce((sum, video) => sum + toNumber(video.views), 0);
  const warnings = [];
  if (missingViews) warnings.push(`Hay ${missingViews} videos sin views válidas`);
  if (inconsistentCtr) warnings.push(`Hay ${inconsistentCtr} videos con ctr inconsistente`);
  if (selectedType === 'all' && types.size > 1) warnings.push('Mezcla de tipos de video en la selección');
  if (totalViews < minViews) warnings.push(`Muestra insuficiente: ${totalViews} views < ${minViews}`);
  return warnings;
}

function audienceInsights(aggregates) {
  const { sums, rates } = aggregates;
  const notes = [];
  if (sums.views > 0 && rates.ctr < 0.01) notes.push('Muchos views y bajo CTR: revisar hook y CTA.');
  if (rates.ctr >= 0.02 && rates.purchase_rate < 0.001) notes.push('Buen CTR pero baja conversión: revisar post-click / oferta.');
  if (sums.view_content > 0 && sums.formulario_lead === 0) notes.push('Hay interés inicial pero cero leads: revisar fricción del formulario.');
  if (!notes.length) notes.push('Señales equilibradas; continuar iteración y monitoreo.');
  return notes;
}

function compareAudiencesAB(audienceA, audienceB, config = {}) {
  const metric = config.primaryMetric || 'ctr';
  const alpha = Number(config.alpha || 0.05);
  const mde = Number(config.mde || 0.1);
  const minExposure = Number(config.minExposure || 1000);

  const aggA = buildAudienceAggregates(audienceA.videos || []);
  const aggB = buildAudienceAggregates(audienceB.videos || []);
  const viewsA = aggA.sums.views;
  const viewsB = aggB.sums.views;
  const exposureOk = viewsA >= minExposure && viewsB >= minExposure;

  let valA = metric === 'ctr' ? aggA.rates.ctr : metric === 'purchase_rate' ? aggA.rates.purchase_rate : (viewsA > 0 ? (1000 * aggA.sums.clicks) / viewsA : 0);
  let valB = metric === 'ctr' ? aggB.rates.ctr : metric === 'purchase_rate' ? aggB.rates.purchase_rate : (viewsB > 0 ? (1000 * aggB.sums.clicks) / viewsB : 0);

  const pooled = (aggA.sums.clicks + aggB.sums.clicks) / Math.max(viewsA + viewsB, 1);
  const se = Math.sqrt(Math.max(pooled * (1 - pooled) * ((1 / Math.max(viewsA, 1)) + (1 / Math.max(viewsB, 1))), 1e-12));
  const delta = valB - valA;
  const z = delta / (se || 1);
  const pValue = 2 * (1 - normCdf(Math.abs(z)));

  const frequentist = {
    p_value: pValue,
    uplift_absolute: delta,
    uplift_relative: valA ? delta / valA : null,
    ci95_delta: [delta - 1.96 * (se || 1), delta + 1.96 * (se || 1)],
    winner: pValue < alpha ? (delta > 0 ? 'B' : 'A') : 'Inconcluso',
  };

  const bayesianProb = normCdf(delta / (se || 1));
  const bayesian = {
    p_b_gt_a: bayesianProb,
    p_uplift_gt_mde: normCdf((delta - mde) / (se || 1)),
  };

  const sequential = {
    exposure_ok: exposureOk,
    min_exposure: minExposure,
    decision: !exposureOk ? 'Inconcluso' : bayesianProb > 0.95 ? 'Ganador B' : bayesianProb < 0.05 ? 'Ganador A' : 'Inconcluso',
  };

  const decision = !exposureOk ? 'Inconcluso' : frequentist.winner === 'Inconcluso' ? sequential.decision : `Ganador ${frequentist.winner}`;
  return {
    primary_metric: metric,
    A: { label: audienceA.audience?.name || 'A', value: valA, views: viewsA, ...aggA },
    B: { label: audienceB.audience?.name || 'B', value: valB, views: viewsB, ...aggB },
    frequentist,
    bayesian,
    sequential,
    decision,
    recommendations: decision === 'Ganador B'
      ? ['Escalar audiencia B', 'Mantener monitoreo por tipo de video', 'Documentar aprendizaje de segmentación']
      : decision === 'Ganador A'
        ? ['Mantener audiencia A', 'Refinar criterios de B', 'Recolectar evidencia adicional']
        : ['Recolectar más exposición (views)', 'No concluir aún', 'Revisar coherencia de creativos por audiencia'],
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
    if (table !== 'users') {
      delete writeRow.user_id;
      writeRow.user_id = currentUserId;
    }
    if (table === 'videos') {
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
    const insertRow = async () => {
      const fields = Object.keys(writeRow);
      const placeholders = fields.map(() => '?').join(', ');
      await pool.query(
        `INSERT INTO ${quotedTable} (${fields.map(normalizeIdentifier).join(', ')}) VALUES (${placeholders})`,
        fields.map((field) => writeRow[field]),
      );
    };

    const ensureAutoExternalId = () => {
      if (table !== 'videos') return;
      if (String(writeRow.external_id || '').trim()) return;
      const generatedExternalId = autoExternalIdForVideo(writeRow.video_type, writeRow.video_id);
      if (generatedExternalId) writeRow.external_id = generatedExternalId;
    };

    if (table === 'videos' && (writeRow.video_id == null || String(writeRow.video_id).trim() === '')) {
      await pool.query('BEGIN IMMEDIATE');
      try {
        const [maxRows] = await pool.query(
          `SELECT COALESCE(MAX(CASE
            WHEN trim(CAST(video_id AS TEXT)) <> '' AND trim(CAST(video_id AS TEXT)) GLOB '[0-9]*'
            THEN CAST(video_id AS INTEGER)
            ELSE NULL
          END), 0) AS max_video_id
          FROM videos
          WHERE user_id = ?`,
          [currentUserId],
        );
        writeRow.video_id = Number(maxRows[0]?.max_video_id || 0) + 1;
        ensureAutoExternalId();
        await insertRow();
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } else {
      ensureAutoExternalId();
      await insertRow();
    }
    const [inserted] = await pool.query(`SELECT * FROM ${quotedTable} WHERE id = ?`, [writeRow.id]);
    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos'].includes(table)) {
      await syncCloudForUser(currentUserId);
    }
    return inserted;
  }

  if (operation === 'update') {
    const fields = Object.keys(payload || {});
    if (!fields.length) throw new Error('Empty update payload');
    const setSql = fields.map((field) => `${normalizeIdentifier(field)} = ?`).join(', ');
    await pool.query(`UPDATE ${quotedTable} SET ${setSql}${where}`, [...fields.map((field) => payload[field]), ...whereValues]);
    const [updated] = await pool.query(`SELECT * FROM ${quotedTable}${where}`, whereValues);
    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos'].includes(table)) {
      await syncCloudForUser(currentUserId);
    }
    return updated;
  }

  if (operation === 'delete') {
    await pool.query(`DELETE FROM ${quotedTable}${where}`, whereValues);
    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos'].includes(table)) {
      await syncCloudForUser(currentUserId);
    }
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
      await syncCloudForUser(user.id);
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

    if (url.pathname === '/api/cloud/tree' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      await syncCloudForUser(user.id);
      const parentId = url.searchParams.get('parentId');
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') || 'name';
      const limit = Math.max(Number(url.searchParams.get('limit') || 200), 1);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

      const treeSql = parentId == null
        ? 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id IS NULL ORDER BY name COLLATE NOCASE ASC'
        : 'SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id = ? ORDER BY name COLLATE NOCASE ASC';
      const treeParams = parentId == null ? [user.id] : [user.id, parentId];
      let [rows] = await pool.query(treeSql, treeParams);
      if (search) rows = rows.filter((row) => String(row.name || '').toLowerCase().includes(search));
      if (sort === 'updated_at') rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      if (sort === 'created_at') rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      const paged = rows.slice(offset, offset + limit);
      const breadcrumbs = parentId ? await getCloudBreadcrumbs(user.id, parentId) : [];
      sendJson(req, res, 200, { data: paged, total: rows.length, breadcrumbs });
      return;
    }

    if (url.pathname === '/api/cloud/folder' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      if (!body.name) {
        sendJson(req, res, 400, { error: 'name is required' });
        return;
      }
      const parentId = body.parentId || null;
      if (parentId && !(await getCloudNodeById(parentId, user.id))) {
        sendJson(req, res, 404, { error: 'Parent not found' });
        return;
      }
      const node = await createCloudNode({ userId: user.id, parentId, name: body.name, type: 'folder' });
      await recordCloudEvent(user.id, 'create', { type: 'folder', nodeId: node.id });
      sendJson(req, res, 200, { node });
      return;
    }

    const cloudNodeMatch = url.pathname.match(/^\/api\/cloud\/node\/([^/]+)$/);
    if (cloudNodeMatch && req.method === 'PATCH') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const node = await getCloudNodeById(cloudNodeMatch[1], user.id);
      if (!node) {
        sendJson(req, res, 404, { error: 'Node not found' });
        return;
      }
      const body = await readBody(req);
      const name = body.name ?? node.name;
      const parentId = body.parentId ?? node.parent_id;
      if (parentId && !(await getCloudNodeById(parentId, user.id))) {
        sendJson(req, res, 404, { error: 'Destination parent not found' });
        return;
      }
      await pool.query('UPDATE cloud_nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, parentId, nowIso(), node.id, user.id]);
      await recordCloudEvent(user.id, 'move', { nodeId: node.id, parentId, name });
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (cloudNodeMatch && req.method === 'DELETE') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const node = await getCloudNodeById(cloudNodeMatch[1], user.id);
      if (!node) {
        sendJson(req, res, 404, { error: 'Node not found' });
        return;
      }
      const [children] = await pool.query('SELECT id FROM cloud_nodes WHERE user_id = ? AND parent_id = ? LIMIT 1', [user.id, node.id]);
      if (children.length) {
        sendJson(req, res, 400, { error: 'Folder is not empty' });
        return;
      }
      if (node.type === 'file' && node.storage_path) {
        try { fs.unlinkSync(node.storage_path); } catch {}
      }
      await pool.query('DELETE FROM cloud_nodes WHERE id = ? AND user_id = ?', [node.id, user.id]);
      await recordCloudEvent(user.id, 'delete', { nodeId: node.id });
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/cloud/upload' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      if (!body.parentId || !body.name || !body.contentBase64) {
        sendJson(req, res, 400, { error: 'parentId, name and contentBase64 are required' });
        return;
      }
      const parent = await getCloudNodeById(body.parentId, user.id);
      if (!parent) {
        sendJson(req, res, 404, { error: 'Parent not found' });
        return;
      }
      const nodeId = uuid();
      const userFolder = path.join(storageRoot, user.id);
      fs.mkdirSync(userFolder, { recursive: true });
      const ext = path.extname(body.name || '') || '';
      const filePath = path.join(userFolder, `${nodeId}${ext}`);
      const fileBuffer = Buffer.from(String(body.contentBase64), 'base64');
      fs.writeFileSync(filePath, fileBuffer);
      const node = await createCloudNode({
        userId: user.id,
        parentId: parent.id,
        name: body.name,
        type: 'file',
        mimeType: body.mimeType || 'application/octet-stream',
        size: fileBuffer.byteLength,
        storagePath: filePath,
      });
      await recordCloudEvent(user.id, 'upload', { nodeId: node.id, size: node.size });
      sendJson(req, res, 200, { node });
      return;
    }

    const cloudDownloadMatch = url.pathname.match(/^\/api\/cloud\/download\/([^/]+)$/);
    if (cloudDownloadMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const node = await getCloudNodeById(cloudDownloadMatch[1], user.id);
      if (!node) {
        sendJson(req, res, 404, { error: 'Node not found' });
        return;
      }
      if (node.type === 'shortcut') {
        const link = await resolveShortcutAppLink(user.id, node.target_type, node.target_id);
        sendJson(req, res, 200, {
          shortcut: true,
          target_type: node.target_type,
          target_id: node.target_id,
          link,
        });
        return;
      }
      if (node.type !== 'file' || !node.storage_path || !fs.existsSync(node.storage_path)) {
        sendJson(req, res, 400, { error: 'File not available' });
        return;
      }
      await recordCloudEvent(user.id, 'download', { nodeId: node.id });
      res.writeHead(200, {
        'Content-Type': node.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(node.name)}"`,
      });
      fs.createReadStream(node.storage_path).pipe(res);
      return;
    }

    if (url.pathname === '/api/cloud/sync' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      await syncCloudForUser(user.id);
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/cloud/locate' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const targetType = url.searchParams.get('targetType');
      const targetId = url.searchParams.get('targetId');
      if (!targetType || !targetId) {
        sendJson(req, res, 400, { error: 'targetType and targetId are required' });
        return;
      }
      await syncCloudForUser(user.id);
      const node = await locateCloudNodeForTarget(user.id, targetType, targetId);
      if (!node) {
        sendJson(req, res, 404, { error: 'Cloud location not found' });
        return;
      }
      sendJson(req, res, 200, { nodeId: node.id, parentId: node.parent_id, type: node.type });
      return;
    }

    if (url.pathname === '/api/videos/bulk-update' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      const updates = Array.isArray(body?.updates) ? body.updates : null;
      if (!updates) {
        sendJson(req, res, 400, { error: 'Body must include updates array' });
        return;
      }

      const dryRun = Boolean(body?.dryRun || body?.previewOnly || false);
      const mergedByVideoId = new Map();
      const results = [];

      for (let index = 0; index < updates.length; index += 1) {
        const rawUpdate = updates[index] || {};
        const normalizedUpdate = normalizeIdentifierPayload(rawUpdate);
        const identifierProvided = normalizedUpdate.video_id || normalizedUpdate.session_id || normalizedUpdate.video_name || null;
        const { normalizedFields, invalidKeys } = normalizeBulkUpdateFields(normalizedUpdate.fields);
        const updatedFields = Object.keys(normalizedFields);

        if (!updatedFields.length || invalidKeys.length) {
          results.push({
            inputIndex: index,
            status: 'invalid',
            identifierProvided,
            identifierUsed: null,
            matchedVideoId: null,
            updatedFields,
            error: invalidKeys.length ? `invalid_fields:${invalidKeys.join(',')}` : 'empty_fields',
          });
          continue;
        }

        const resolution = await resolveVideoIdentifier(normalizedUpdate, user.id);
        if (!resolution.matched) {
          results.push({
            inputIndex: index,
            status: 'not_found',
            identifierProvided,
            identifierUsed: resolution.identifierUsed,
            matchedVideoId: null,
            updatedFields,
            error: resolution.reasonIfNotFound,
          });
          continue;
        }

        const previous = mergedByVideoId.get(resolution.matchedVideoId);
        mergedByVideoId.set(resolution.matchedVideoId, {
          inputIndex: index,
          matchedVideoId: resolution.matchedVideoId,
          identifierProvided,
          identifierUsed: resolution.identifierUsed,
          normalizedFields: { ...(previous?.normalizedFields || {}), ...normalizedFields },
        });

        results.push({
          inputIndex: index,
          status: 'applicable',
          identifierProvided,
          identifierUsed: resolution.identifierUsed,
          matchedVideoId: resolution.matchedVideoId,
          updatedFields,
          error: null,
        });
      }

      if (!dryRun) {
        try {
          await pool.query('BEGIN');
          for (const entry of mergedByVideoId.values()) {
            const setEntries = Object.entries(entry.normalizedFields);
            if (!setEntries.length) continue;
            const setSql = setEntries.map(([field]) => `${normalizeIdentifier(field)} = ?`).join(', ');
            const values = setEntries.map(([, value]) => value);
            await pool.query(`UPDATE videos SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [...values, entry.matchedVideoId, user.id]);
          }
          await pool.query('COMMIT');
        } catch (error) {
          await pool.query('ROLLBACK');
          sendJson(req, res, 500, { error: error?.message || String(error) });
          return;
        }
      }

      const finalResults = results.map((result) => {
        if (dryRun) return result;
        if (result.status !== 'applicable') return result;
        const merged = mergedByVideoId.get(result.matchedVideoId);
        const isLatest = merged && merged.inputIndex === result.inputIndex;
        return {
          ...result,
          status: isLatest ? 'updated' : 'merged',
          updatedFields: isLatest ? Object.keys(merged.normalizedFields) : result.updatedFields,
          error: isLatest ? null : 'merged_with_later_input',
        };
      });

      const response = {
        received: updates.length,
        applicable: finalResults.filter((result) => result.status === 'applicable' || result.status === 'updated' || result.status === 'merged').length,
        not_found: finalResults.filter((result) => result.status === 'not_found').length,
        invalid: finalResults.filter((result) => result.status === 'invalid').length,
        results: finalResults,
      };

      sendJson(req, res, 200, response);
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

    const audienceDashboardMatch = url.pathname.match(/^\/api\/audiences\/([^/]+)\/dashboard$/);
    if (audienceDashboardMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const audienceId = audienceDashboardMatch[1];
      const selectedType = url.searchParams.get('video_type') || 'all';
      const minViews = Number(url.searchParams.get('min_views') || 1000);

      const [audienceRows] = await pool.query(
        `SELECT a.*
         FROM audiences a
         JOIN campaigns c ON c.id = a.campaign_id
         JOIN projects p ON p.id = c.project_id
         WHERE a.id = ? AND a.user_id = ? AND c.user_id = ? AND p.user_id = ?
         LIMIT 1`,
        [audienceId, user.id, user.id, user.id],
      );
      const audience = audienceRows[0];
      if (!audience) {
        sendJson(req, res, 404, { error: 'Audience not found' });
        return;
      }

      const where = ['audience_id = ?', 'user_id = ?'];
      const values = [audienceId, user.id];
      if (selectedType !== 'all') {
        where.push('video_type = ?');
        values.push(selectedType);
      }
      const [videos] = await pool.query(`SELECT * FROM videos WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, values);
      const aggregates = buildAudienceAggregates(videos);
      const warnings = buildAudienceWarnings(videos, selectedType, minViews);
      const byType = {
        paid: buildAudienceAggregates(videos.filter((video) => video.video_type === 'paid')),
        organic: buildAudienceAggregates(videos.filter((video) => video.video_type === 'organic')),
        live: buildAudienceAggregates(videos.filter((video) => video.video_type === 'live')),
      };

      sendJson(req, res, 200, {
        audience,
        videos,
        counts: aggregates.counts,
        sums: aggregates.sums,
        rates: aggregates.rates,
        by_type: byType,
        warnings,
        insights: audienceInsights(aggregates),
      });
      return;
    }

    if (url.pathname === '/api/audiences/ab-test' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      const audienceAId = body.audienceAId;
      const audienceBId = body.audienceBId;
      if (!audienceAId || !audienceBId) {
        sendJson(req, res, 400, { error: 'audienceAId and audienceBId are required' });
        return;
      }

      const [audRows] = await pool.query(
        `SELECT a.*
         FROM audiences a
         JOIN campaigns c ON c.id = a.campaign_id
         JOIN projects p ON p.id = c.project_id
         WHERE a.id IN (?, ?) AND a.user_id = ? AND c.user_id = ? AND p.user_id = ?`,
        [audienceAId, audienceBId, user.id, user.id, user.id],
      );
      const audienceA = audRows.find((audience) => audience.id === audienceAId);
      const audienceB = audRows.find((audience) => audience.id === audienceBId);
      if (!audienceA || !audienceB) {
        sendJson(req, res, 404, { error: 'Audience not found' });
        return;
      }
      if (audienceA.campaign_id !== audienceB.campaign_id) {
        sendJson(req, res, 400, { error: 'Both audiences must belong to same campaign' });
        return;
      }

      const videoType = body.videoType || 'all';
      const whereA = ['audience_id = ?', 'user_id = ?'];
      const valsA = [audienceA.id, user.id];
      const whereB = ['audience_id = ?', 'user_id = ?'];
      const valsB = [audienceB.id, user.id];
      if (videoType !== 'all') {
        whereA.push('video_type = ?');
        valsA.push(videoType);
        whereB.push('video_type = ?');
        valsB.push(videoType);
      }
      const [videosA] = await pool.query(`SELECT * FROM videos WHERE ${whereA.join(' AND ')}`, valsA);
      const [videosB] = await pool.query(`SELECT * FROM videos WHERE ${whereB.join(' AND ')}`, valsB);

      const config = {
        primaryMetric: body.primaryMetric || 'ctr',
        alpha: Number(body.alpha || 0.05),
        mde: Number(body.mde || 0.1),
        method: body.method || 'hybrid',
        minExposure: Number(body.minExposure || 1000),
        videoType: videoType,
      };

      const results = compareAudiencesAB({ audience: audienceA, videos: videosA }, { audience: audienceB, videos: videosB }, config);
      const datasetHash = crypto.createHash('sha256').update([...videosA.map((video) => video.id), ...videosB.map((video) => video.id)].sort().join('|')).digest('hex');
      const runId = uuid();
      await pool.query(
        'INSERT INTO audience_ab_tests (id, campaign_id, audience_a_id, audience_b_id, config_json, results_json, dataset_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [runId, audienceA.campaign_id, audienceA.id, audienceB.id, JSON.stringify(config), JSON.stringify(results), datasetHash],
      );

      sendJson(req, res, 200, {
        id: runId,
        campaign_id: audienceA.campaign_id,
        audience_a_id: audienceA.id,
        audience_b_id: audienceB.id,
        config,
        results,
        dataset_hash: datasetHash,
      });
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
