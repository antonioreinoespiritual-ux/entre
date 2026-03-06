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
const allowedTables = new Set(['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'hypothesis_videos', 'users']);
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
    audience_id TEXT,
    condition TEXT,
    validation_status TEXT DEFAULT 'No Validada',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_hypotheses_campaign_id ON hypotheses(campaign_id)',
  'CREATE INDEX IF NOT EXISTS idx_hypotheses_user_id ON hypotheses(user_id)',
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT,
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
  `CREATE TABLE IF NOT EXISTS hypothesis_videos (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(hypothesis_id, video_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_hypothesis_videos_hypothesis_id ON hypothesis_videos(hypothesis_id)',
  'CREATE INDEX IF NOT EXISTS idx_hypothesis_videos_video_id ON hypothesis_videos(video_id)',
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
  `CREATE TABLE IF NOT EXISTS interview_clients (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    audience_id TEXT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    contact TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interview_clients_campaign ON interview_clients(campaign_id, audience_id)',
  `CREATE TABLE IF NOT EXISTS interview_hypotheses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    audience_id TEXT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interview_hypotheses_campaign ON interview_hypotheses(campaign_id)',
  `CREATE TABLE IF NOT EXISTS interview_forms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    questions_json TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interview_forms_campaign ON interview_forms(campaign_id)',
  `CREATE TABLE IF NOT EXISTS interview_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    audience_id TEXT,
    form_id TEXT NOT NULL,
    interview_hypothesis_id TEXT,
    conducted_at TEXT,
    notes TEXT,
    status TEXT DEFAULT 'draft',
    completed_at TEXT,
    responses_json TEXT,
    form_snapshot_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES interview_clients(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (form_id) REFERENCES interview_forms(id) ON DELETE CASCADE,
    FOREIGN KEY (interview_hypothesis_id) REFERENCES interview_hypotheses(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interview_sessions_campaign ON interview_sessions(campaign_id, client_id)',
  `CREATE TABLE IF NOT EXISTS cloud_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('folder','file')),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    canonical_key TEXT,
    target_type TEXT,
    target_id TEXT,
    mime_type TEXT,
    size INTEGER,
    storage_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES cloud_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(project_id, canonical_key)
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    edge_kind TEXT NOT NULL DEFAULT 'link' CHECK(edge_kind IN ('link')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES cloud_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES cloud_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(project_id, parent_id, child_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cloud_nodes_project_parent ON cloud_nodes(project_id, parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_cloud_nodes_user_target ON cloud_nodes(user_id, target_type, target_id)',
  'CREATE INDEX IF NOT EXISTS idx_cloud_edges_project_parent ON cloud_edges(project_id, parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_cloud_edges_project_child ON cloud_edges(project_id, child_id)',
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


async function recordCloudEvent() {}

async function getCloudNodeById(nodeId, userId) {
  const [rows] = await pool.query('SELECT * FROM cloud_nodes WHERE id = ? AND user_id = ?', [nodeId, userId]);
  return rows[0] || null;
}

async function ensureCloudEdge(userId, parentId, childId) {
  if (!parentId || !childId || parentId === childId) return null;
  const [parentRows] = await pool.query('SELECT project_id FROM cloud_nodes WHERE id = ? AND user_id = ? LIMIT 1', [parentId, userId]);
  const [childRows] = await pool.query('SELECT project_id FROM cloud_nodes WHERE id = ? AND user_id = ? LIMIT 1', [childId, userId]);
  const projectId = parentRows[0]?.project_id || childRows[0]?.project_id || null;
  if (!projectId || (childRows[0]?.project_id && String(childRows[0].project_id) !== String(projectId))) return null;
  await pool.query(
    'INSERT OR IGNORE INTO cloud_edges (id, project_id, user_id, parent_id, child_id, edge_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuid(), projectId, userId, parentId, childId, 'link', nowIso()],
  );
  const [rows] = await pool.query(
    'SELECT * FROM cloud_edges WHERE user_id = ? AND project_id = ? AND parent_id = ? AND child_id = ? LIMIT 1',
    [userId, projectId, parentId, childId],
  );
  return rows[0] || null;
}

async function unlinkCloudEdge(userId, parentId, childId) {
  await pool.query('DELETE FROM cloud_edges WHERE user_id = ? AND parent_id = ? AND child_id = ?', [userId, parentId, childId]);
}

async function deleteCloudNodeTree(userId, nodeId, visited = new Set()) {
  const key = String(nodeId || '');
  if (!key || visited.has(key)) return;
  visited.add(key);

  const node = await getCloudNodeById(nodeId, userId);
  if (!node) return;

  const [directChildren] = await pool.query('SELECT id FROM cloud_nodes WHERE user_id = ? AND parent_id = ?', [userId, nodeId]);
  const [linkedChildren] = await pool.query(
    'SELECT child_id AS id FROM cloud_edges WHERE user_id = ? AND parent_id = ?',
    [userId, nodeId],
  );
  const childIds = [...new Set([...directChildren, ...linkedChildren].map((row) => String(row.id || '')).filter(Boolean))];
  for (const childId of childIds) {
    await deleteCloudNodeTree(userId, childId, visited);
  }

  if (node.type === 'file' && node.storage_path) {
    try { fs.unlinkSync(node.storage_path); } catch {}
  }

  await pool.query('DELETE FROM cloud_edges WHERE user_id = ? AND (parent_id = ? OR child_id = ?)', [userId, nodeId, nodeId]);
  await pool.query('DELETE FROM cloud_nodes WHERE id = ? AND user_id = ?', [nodeId, userId]);
}

async function purgeVideoCloudArtifacts(userId, videoId) {
  const [nodes] = await pool.query(
    `SELECT id FROM cloud_nodes WHERE user_id = ? AND target_type = 'video' AND target_id = ?`,
    [userId, String(videoId)],
  );
  const visited = new Set();
  for (const node of nodes) {
    await deleteCloudNodeTree(userId, node.id, visited);
  }
}

async function listCloudChildren(userId, parentId) {
  if (parentId == null) {
    const [rows] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND parent_id IS NULL ORDER BY name COLLATE NOCASE ASC', [userId]);
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT n.*, 0 AS is_linked_from_edge
     FROM cloud_nodes n
     WHERE n.user_id = ? AND n.parent_id = ?
     UNION
     SELECT n.*, 1 AS is_linked_from_edge
     FROM cloud_edges e
     JOIN cloud_nodes n ON n.id = e.child_id AND n.user_id = e.user_id
     WHERE e.user_id = ? AND e.parent_id = ?
     ORDER BY name COLLATE NOCASE ASC`,
    [userId, parentId, userId, parentId],
  );

  const byId = new Map();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    if (!existing.is_linked_from_edge && row.is_linked_from_edge) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
}

function sanitizeCloudName(rawName) {
  return String(rawName || '').replace(/[\\/]+/g, ' ').trim().slice(0, 120);
}

function parseMultipartFormData(bodyBuffer, contentType) {
  const match = String(contentType || '').match(/boundary=(.+)$/i);
  if (!match) throw new Error('Missing multipart boundary');
  const boundary = `--${match[1]}`;
  const parts = bodyBuffer.toString('binary').split(boundary).slice(1, -1);
  const parsed = {};
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const splitIndex = trimmed.indexOf('\r\n\r\n');
    if (splitIndex < 0) continue;
    const rawHeaders = trimmed.slice(0, splitIndex);
    const rawValue = trimmed.slice(splitIndex + 4);
    const disposition = rawHeaders.split('\r\n').find((line) => /^content-disposition:/i.test(line)) || '';
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const fileNameMatch = disposition.match(/filename="([^"]*)"/i);
    if (fileNameMatch) {
      const contentTypeHeader = rawHeaders.split('\r\n').find((line) => /^content-type:/i.test(line));
      parsed[fieldName] = {
        filename: sanitizeCloudName(fileNameMatch[1] || 'file.bin') || 'file.bin',
        mimeType: (contentTypeHeader || '').split(':')[1]?.trim() || 'application/octet-stream',
        buffer: Buffer.from(rawValue, 'binary'),
      };
    } else {
      parsed[fieldName] = Buffer.from(rawValue, 'binary').toString('utf8').trim();
    }
  }
  return parsed;
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

async function resolveProjectIdForCloudNode(userId, parentId, explicitProjectId = null) {
  const normalized = String(explicitProjectId || '').trim();
  if (normalized) return normalized;
  if (parentId) {
    const parent = await getCloudNodeById(parentId, userId);
    if (parent?.project_id) return parent.project_id;
  }
  throw new Error('project_id is required for cloud node');
}

async function createCloudNode({ userId, parentId = null, projectId = null, name, type = 'folder', canonicalKey = null, mimeType = null, size = null, storagePath = null, targetType = null, targetId = null }) {
  const resolvedProjectId = await resolveProjectIdForCloudNode(userId, parentId, projectId);
  const node = {
    id: uuid(),
    project_id: resolvedProjectId,
    user_id: userId,
    parent_id: parentId,
    kind: type === 'file' ? 'file' : 'folder',
    type,
    name,
    canonical_key: canonicalKey,
    mime_type: mimeType,
    size,
    storage_path: storagePath,
    target_type: targetType,
    target_id: targetId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO cloud_nodes (id, project_id, user_id, kind, type, name, parent_id, canonical_key, mime_type, size, storage_path, target_type, target_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [node.id, node.project_id, node.user_id, node.kind, node.type, node.name, node.parent_id, node.canonical_key, node.mime_type, node.size, node.storage_path, node.target_type, node.target_id, node.created_at, node.updated_at],
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

function videoFolderLabel(video) {
  const videoName = String(video?.title || video?.record_name || `Video ${video?.id || ''}`).trim().slice(0, 60);
  const videoIdentifier = String(video?.video_id ?? video?.id ?? '').trim();
  return `${videoIdentifier || 'video'} - ${videoName || 'sin-nombre'}`.slice(0, 80);
}

async function ensureProjectCloudRoots(userId, projectId) {
  const [projectRows] = await pool.query('SELECT id, name FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, userId]);
  const project = projectRows[0];
  if (!project) return null;

  const ensureCanonicalFolder = async (canonicalKey, name, parentId = null) => {
    const [rows] = await pool.query(
      'SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key = ? LIMIT 1',
      [userId, projectId, canonicalKey],
    );
    const existing = rows[0] || null;
    if (existing) {
      if (String(existing.name || '') !== String(name || '') || String(existing.parent_id || '') !== String(parentId || '')) {
        await pool.query('UPDATE cloud_nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, parentId, nowIso(), existing.id, userId]);
      }
      return existing;
    }
    return createCloudNode({ userId, projectId, parentId, name, type: 'folder', canonicalKey });
  };

  const projectRoot = await ensureCanonicalFolder('project_root', project.name || `Proyecto ${project.id}`, null);
  const campaignsRoot = await ensureCanonicalFolder('campaigns_root', 'Campañas', projectRoot.id);
  const videosRoot = await ensureCanonicalFolder('videos_root', 'Videos', projectRoot.id);
  return { projectRoot, campaignsRoot, videosRoot };
}

async function ensureProjectVideosRootFolder(userId, projectId) {
  const roots = await ensureProjectCloudRoots(userId, projectId);
  return roots?.videosRoot || null;
}

async function ensureCampaignVideosRootFolder(userId, campaignId) {
  const [campaignRows] = await pool.query(
    `SELECT c.id, p.id AS project_id
     FROM campaigns c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [campaignId, userId, userId],
  );
  const campaign = campaignRows[0];
  if (!campaign) return null;
  return ensureProjectVideosRootFolder(userId, campaign.project_id);
}

async function ensureCampaignCloudFolders(userId, campaignId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.project_id
     FROM campaigns c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [campaignId, userId, userId],
  );
  const campaign = rows[0];
  if (!campaign) return null;

  const roots = await ensureProjectCloudRoots(userId, campaign.project_id);
  if (!roots) return null;

  const ensureCanonicalFolder = async (canonicalKey, name, parentId, targetType = null, targetId = null) => {
    const [found] = await pool.query(
      'SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key = ? LIMIT 1',
      [userId, campaign.project_id, canonicalKey],
    );
    const existing = found[0] || null;
    if (existing) {
      if (String(existing.name || '') !== String(name || '') || String(existing.parent_id || '') !== String(parentId || '')) {
        await pool.query('UPDATE cloud_nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, parentId, nowIso(), existing.id, userId]);
      }
      return existing;
    }
    return createCloudNode({ userId, projectId: campaign.project_id, parentId, name, type: 'folder', canonicalKey, targetType, targetId });
  };

  const campaignRoot = await ensureCanonicalFolder(`campaign_root:${campaign.id}`, campaign.name || `Campaña ${campaign.id}`, roots.campaignsRoot.id, 'campaign', campaign.id);
  const videosFolder = await ensureCanonicalFolder(`campaign_videos_root:${campaign.id}`, 'Biblioteca de videos', campaignRoot.id);
  const hypothesesFolder = await ensureCanonicalFolder(`campaign_hypotheses_root:${campaign.id}`, 'Hipótesis', campaignRoot.id);
  const audiencesFolder = await ensureCanonicalFolder(`campaign_audiences_root:${campaign.id}`, 'Audiencias', campaignRoot.id);
  return { campaign, roots, campaignRoot, videosFolder, hypothesesFolder, audiencesFolder };
}

function interviewSessionFolderLabel(session = {}) {
  const interviewCode = String(session?.id || '').slice(0, 8).toUpperCase() || 'ENTREVISTA';
  const clientName = String(session?.client_name || 'Cliente sin nombre').trim();
  return `${interviewCode} · ${clientName}`.slice(0, 80);
}

async function ensureInterviewCloudFolders(userId, projectId, campaignId) {
  const [campaignRows] = await pool.query(
    `SELECT c.id, c.name, c.project_id
     FROM campaigns c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND c.project_id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [campaignId, projectId, userId, userId],
  );
  const campaign = campaignRows[0] || null;
  if (!campaign) return null;

  const roots = await ensureProjectCloudRoots(userId, projectId);
  if (!roots?.projectRoot?.id) return null;

  const ensureCanonicalFolder = async (canonicalKey, name, parentId, targetType = null, targetId = null) => {
    const [found] = await pool.query(
      'SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key = ? LIMIT 1',
      [userId, projectId, canonicalKey],
    );
    const existing = found[0] || null;
    if (existing) {
      if (String(existing.name || '') !== String(name || '') || String(existing.parent_id || '') !== String(parentId || '')) {
        await pool.query('UPDATE cloud_nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, parentId, nowIso(), existing.id, userId]);
      }
      return existing;
    }
    return createCloudNode({ userId, projectId, parentId, name, type: 'folder', canonicalKey, targetType, targetId });
  };

  const cloudRoot = await ensureCanonicalFolder(`interviews_cloud_root:${campaign.id}`, `Centro de Entrevistas · ${campaign.name || campaign.id}`, roots.projectRoot.id, 'interview_center', campaign.id);
  const audiencesRoot = await ensureCanonicalFolder(`interviews_cloud_audiences_root:${campaign.id}`, 'Audiencias', cloudRoot.id);
  const interviewsRoot = await ensureCanonicalFolder(`interviews_cloud_sessions_root:${campaign.id}`, 'Entrevistas', cloudRoot.id);
  const hypothesesRoot = await ensureCanonicalFolder(`interviews_cloud_hypotheses_root:${campaign.id}`, 'Hipótesis', cloudRoot.id);

  const [audiences] = await pool.query(
    `SELECT a.id, a.name
     FROM audiences a
     WHERE a.user_id = ? AND a.campaign_id = ?
     ORDER BY a.created_at ASC`,
    [userId, campaign.id],
  );

  const audienceFoldersById = new Map();
  for (const audience of audiences) {
    const folder = await ensureCanonicalFolder(
      `interviews_cloud_audience:${campaign.id}:${audience.id}`,
      String(audience.name || 'Audiencia sin nombre').slice(0, 80),
      audiencesRoot.id,
      'audience',
      audience.id,
    );
    audienceFoldersById.set(String(audience.id), folder);
  }

  const [sessions] = await pool.query(
    `SELECT s.id, s.audience_id, c.name AS client_name
     FROM interview_sessions s
     LEFT JOIN interview_clients c ON c.id = s.client_id
     WHERE s.user_id = ? AND s.project_id = ? AND s.campaign_id = ?
     ORDER BY s.created_at ASC`,
    [userId, projectId, campaign.id],
  );

  for (const session of sessions) {
    const sessionFolder = await ensureCanonicalFolder(
      `interviews_cloud_session:${campaign.id}:${session.id}`,
      interviewSessionFolderLabel(session),
      interviewsRoot.id,
      'interview_session',
      session.id,
    );
    await ensureFolder(userId, sessionFolder.id, 'Transcripción');
    await ensureFolder(userId, sessionFolder.id, 'Audio');
    await ensureFolder(userId, sessionFolder.id, 'Notas');
    await ensureFolder(userId, sessionFolder.id, 'Archivos');

    const audienceFolder = audienceFoldersById.get(String(session.audience_id || ''));
    if (audienceFolder) await ensureCloudEdge(userId, audienceFolder.id, sessionFolder.id);
  }

  const [hypotheses] = await pool.query(
    `SELECT id, title
     FROM interview_hypotheses
     WHERE user_id = ? AND project_id = ? AND campaign_id = ?
     ORDER BY created_at ASC`,
    [userId, projectId, campaign.id],
  );

  for (const hypothesis of hypotheses) {
    await ensureCanonicalFolder(
      `interviews_cloud_hypothesis:${campaign.id}:${hypothesis.id}`,
      String(hypothesis.title || `Hipótesis ${hypothesis.id}`).slice(0, 80),
      hypothesesRoot.id,
      'interview_hypothesis',
      hypothesis.id,
    );
  }

  return { cloudRoot, audiencesRoot, interviewsRoot, hypothesesRoot };
}

async function ensureHypothesisFolder(userId, campaignId, hypothesisId) {
  const [rows] = await pool.query(
    `SELECT h.id, h.hypothesis_statement, h.condition, h.type, c.project_id
     FROM hypotheses h
     JOIN campaigns c ON c.id = h.campaign_id
     WHERE h.id = ? AND h.campaign_id = ? AND h.user_id = ?
     LIMIT 1`,
    [hypothesisId, campaignId, userId],
  );
  const hypothesis = rows[0];
  if (!hypothesis) return null;

  const campaignFolders = await ensureCampaignCloudFolders(userId, campaignId);
  if (!campaignFolders) return null;

  const hypothesisName = String(hypothesis.hypothesis_statement || hypothesis.condition || hypothesis.type || `Hipótesis ${hypothesis.id}`).slice(0, 80);
  const hypothesisRootCanonicalKey = `hypothesis_root:${hypothesis.id}`;
  const [existingRoot] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key = ? LIMIT 1', [userId, hypothesis.project_id, hypothesisRootCanonicalKey]);
  let hypothesisRoot = existingRoot[0] || null;
  if (!hypothesisRoot) {
    hypothesisRoot = await createCloudNode({ userId, projectId: hypothesis.project_id, parentId: campaignFolders.hypothesesFolder.id, name: hypothesisName, type: 'folder', canonicalKey: hypothesisRootCanonicalKey, targetType: 'hypothesis', targetId: hypothesis.id });
  }
  const [videoFolderRows] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND parent_id = ? AND name = ? AND type = ? LIMIT 1', [userId, hypothesis.project_id, hypothesisRoot.id, 'Videos', 'folder']);
  if (videoFolderRows[0]) return videoFolderRows[0];
  return createCloudNode({ userId, projectId: hypothesis.project_id, parentId: hypothesisRoot.id, name: 'Videos', type: 'folder' });
}

async function ensureAudienceFolder(userId, campaignId, audienceId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.name, c.project_id
     FROM audiences a
     JOIN campaigns c ON c.id = a.campaign_id
     WHERE a.id = ? AND a.campaign_id = ? AND a.user_id = ?
     LIMIT 1`,
    [audienceId, campaignId, userId],
  );
  const audience = rows[0];
  if (!audience) return null;

  const campaignFolders = await ensureCampaignCloudFolders(userId, campaignId);
  if (!campaignFolders) return null;

  const audienceName = String(audience.name || `Audiencia ${audience.id}`).slice(0, 80);
  const audienceRootCanonicalKey = `audience_root:${audience.id}`;
  const [existingRoot] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key = ? LIMIT 1', [userId, audience.project_id, audienceRootCanonicalKey]);
  let audienceRoot = existingRoot[0] || null;
  if (!audienceRoot) {
    audienceRoot = await createCloudNode({ userId, projectId: audience.project_id, parentId: campaignFolders.audiencesFolder.id, name: audienceName, type: 'folder', canonicalKey: audienceRootCanonicalKey, targetType: 'audience', targetId: audience.id });
  }
  const [videoFolderRows] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND parent_id = ? AND name = ? AND type = ? LIMIT 1', [userId, audience.project_id, audienceRoot.id, 'Videos', 'folder']);
  if (videoFolderRows[0]) return videoFolderRows[0];
  return createCloudNode({ userId, projectId: audience.project_id, parentId: audienceRoot.id, name: 'Videos', type: 'folder' });
}

async function ensureVideoCanonicalFolder(userId, video, campaignId = null) {
  const projectId = String(video?.project_id || '').trim();
  const videosRoot = projectId
    ? await ensureProjectVideosRootFolder(userId, projectId)
    : await ensureCampaignVideosRootFolder(userId, campaignId || video?.campaign_id || null);
  if (!videosRoot) return null;

  const [allRows] = await pool.query(
    'SELECT * FROM cloud_nodes WHERE user_id = ? AND type = ? AND target_type = ? AND target_id = ? ORDER BY updated_at DESC',
    [userId, 'folder', 'video', video.id],
  );
  let folder = allRows[0] || null;
  const desiredName = videoFolderLabel(video);

  if (!folder) {
    folder = await createCloudNode({ userId, parentId: videosRoot.id, name: desiredName, type: 'folder', targetType: 'video', targetId: video.id });
  } else {
    await pool.query('UPDATE cloud_nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ? AND user_id = ?', [videosRoot.id, desiredName, nowIso(), folder.id, userId]);
    folder.parent_id = videosRoot.id;
    folder.name = desiredName;
  }

  if (allRows.length > 1) {
    const duplicates = allRows.slice(1);
    for (const duplicate of duplicates) {
      await pool.query('UPDATE cloud_nodes SET parent_id = ?, updated_at = ? WHERE user_id = ? AND parent_id = ?', [folder.id, nowIso(), userId, duplicate.id]);
      await pool.query(
        `INSERT OR IGNORE INTO cloud_edges (id, user_id, parent_id, child_id, created_at)
         SELECT lower(hex(randomblob(16))), user_id, parent_id, ?, ?
         FROM cloud_edges
         WHERE user_id = ? AND child_id = ?`,
        [folder.id, nowIso(), userId, duplicate.id],
      );
      await pool.query('DELETE FROM cloud_edges WHERE user_id = ? AND child_id = ?', [userId, duplicate.id]);
      await pool.query('DELETE FROM cloud_nodes WHERE id = ? AND user_id = ?', [duplicate.id, userId]);
    }
  }

  if (await hasColumn('videos', 'cloud_folder_id')) {
    await pool.query('UPDATE videos SET cloud_folder_id = ? WHERE id = ? AND user_id = ?', [folder.id, video.id, userId]);
  }
  return folder;
}

async function linkVideoFolderIntoHypothesis(userId, campaignId, hypothesisId, video) {
  const hypothesisVideosFolder = await ensureHypothesisFolder(userId, campaignId, hypothesisId);
  if (!hypothesisVideosFolder) return null;
  const canonicalFolder = await ensureVideoCanonicalFolder(userId, video, campaignId);
  if (!canonicalFolder) return null;
  await ensureCloudEdge(userId, hypothesisVideosFolder.id, canonicalFolder.id);
  return canonicalFolder;
}

async function linkVideoFolderIntoAudience(userId, campaignId, audienceId, video) {
  if (!audienceId) return null;
  const audienceVideosFolder = await ensureAudienceFolder(userId, campaignId, audienceId);
  if (!audienceVideosFolder) return null;
  const canonicalFolder = await ensureVideoCanonicalFolder(userId, video, campaignId);
  if (!canonicalFolder) return null;
  await ensureCloudEdge(userId, audienceVideosFolder.id, canonicalFolder.id);
  return canonicalFolder;
}

async function unlinkVideoFolderFromAudience(userId, campaignId, audienceId, video) {
  if (!audienceId) return;
  const audienceVideosFolder = await ensureAudienceFolder(userId, campaignId, audienceId);
  if (!audienceVideosFolder) return;
  const canonicalFolder = await ensureVideoCanonicalFolder(userId, video, campaignId);
  if (!canonicalFolder) return;
  await unlinkCloudEdge(userId, audienceVideosFolder.id, canonicalFolder.id);
}

async function unlinkVideoFolderFromHypothesis(userId, campaignId, hypothesisId, video) {
  const hypothesisVideosFolder = await ensureHypothesisFolder(userId, campaignId, hypothesisId);
  if (!hypothesisVideosFolder) return;
  const canonicalFolder = await ensureVideoCanonicalFolder(userId, video, campaignId);
  if (!canonicalFolder) return;
  await unlinkCloudEdge(userId, hypothesisVideosFolder.id, canonicalFolder.id);
}

async function cleanupHypothesisVideoLinks(projectId, userId) {
  const [hypRows] = await pool.query(
    `SELECT h.id, h.campaign_id
     FROM hypotheses h
     JOIN campaigns c ON c.id = h.campaign_id
     WHERE c.project_id = ? AND h.user_id = ? AND c.user_id = ?`,
    [projectId, userId, userId],
  );

  let removedEdges = 0;
  let removedShortcuts = 0;

  for (const hyp of hypRows) {
    const hypothesisVideosFolder = await ensureHypothesisFolder(userId, hyp.campaign_id, hyp.id);
    if (!hypothesisVideosFolder) continue;

    const [edgeRows] = await pool.query(
      `SELECT e.id
       FROM cloud_edges e
       JOIN cloud_nodes child ON child.id = e.child_id AND child.user_id = e.user_id
       WHERE e.user_id = ? AND e.parent_id = ? AND child.target_type = 'video'`,
      [userId, hypothesisVideosFolder.id],
    );
    if (edgeRows.length) {
      await pool.query('DELETE FROM cloud_edges WHERE user_id = ? AND parent_id = ? AND child_id IN (SELECT id FROM cloud_nodes WHERE user_id = ? AND target_type = ?)', [userId, hypothesisVideosFolder.id, userId, 'video']);
      removedEdges += edgeRows.length;
    }

    const [shortcutRows] = await pool.query(
      `SELECT id
       FROM cloud_nodes
       WHERE user_id = ? AND parent_id = ? AND type = 'shortcut' AND target_type = 'video'`,
      [userId, hypothesisVideosFolder.id],
    );
    if (shortcutRows.length) {
      await pool.query('DELETE FROM cloud_nodes WHERE user_id = ? AND parent_id = ? AND type = ? AND target_type = ?', [userId, hypothesisVideosFolder.id, 'shortcut', 'video']);
      removedShortcuts += shortcutRows.length;
    }
  }

  const hypothesisIds = hypRows.map((row) => row.id);
  let removedLinks = 0;
  if (hypothesisIds.length) {
    const placeholders = hypothesisIds.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT id FROM hypothesis_videos WHERE user_id = ? AND hypothesis_id IN (${placeholders})`,
      [userId, ...hypothesisIds],
    );
    removedLinks = rows.length;
    await pool.query(
      `DELETE FROM hypothesis_videos WHERE user_id = ? AND hypothesis_id IN (${placeholders})`,
      [userId, ...hypothesisIds],
    );
  }

  await pool.query(
    `UPDATE videos SET hypothesis_id = NULL
     WHERE user_id = ? AND project_id = ? AND hypothesis_id IS NOT NULL AND trim(CAST(hypothesis_id AS TEXT)) <> ''`,
    [userId, projectId],
  );

  await syncCloudForUser(userId);
  return { removed_links: removedLinks, removed_edges: removedEdges, removed_shortcuts: removedShortcuts };
}

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

async function syncCloudForUser(userId, projectId = null) {
  const projectWhere = projectId ? 'AND p.id = ?' : '';
  const projectParams = projectId ? [userId, projectId] : [userId];
  const [projects] = await pool.query(`SELECT p.id, p.name FROM projects p WHERE p.user_id = ? ${projectWhere} ORDER BY p.created_at ASC`, projectParams);

  for (const project of projects) {
    const roots = await ensureProjectCloudRoots(userId, project.id);
    if (!roots) continue;

    const [campaigns] = await pool.query(
      'SELECT id FROM campaigns WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC',
      [userId, project.id],
    );
    for (const campaign of campaigns) {
      const campaignFolders = await ensureCampaignCloudFolders(userId, campaign.id);
      if (!campaignFolders) continue;

      const [campaignVideos] = await pool.query(
        'SELECT * FROM videos WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC',
        [userId, project.id],
      );
      for (const video of campaignVideos) {
        const canonical = await ensureVideoCanonicalFolder(userId, video, campaign.id);
        if (canonical) await ensureCloudEdge(userId, campaignFolders.videosFolder.id, canonical.id);
      }

      const [campaignHypotheses] = await pool.query(
        'SELECT id FROM hypotheses WHERE user_id = ? AND campaign_id = ? ORDER BY created_at ASC',
        [userId, campaign.id],
      );
      for (const hypothesis of campaignHypotheses) {
        await ensureHypothesisFolder(userId, campaign.id, hypothesis.id);
      }

      const [campaignAudiences] = await pool.query(
        'SELECT id FROM audiences WHERE user_id = ? AND campaign_id = ? ORDER BY created_at ASC',
        [userId, campaign.id],
      );
      for (const audience of campaignAudiences) {
        await ensureAudienceFolder(userId, campaign.id, audience.id);
      }

      await ensureInterviewCloudFolders(userId, project.id, campaign.id);
    }

    const [videos] = await pool.query('SELECT * FROM videos WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC', [userId, project.id]);
    for (const video of videos) {
      await ensureVideoCanonicalFolder(userId, video, video.campaign_id || null);
    }

    const [links] = await pool.query(
      `SELECT hv.hypothesis_id, hv.video_id, h.campaign_id, COALESCE(hv.audience_id, h.audience_id) AS audience_id
       FROM hypothesis_videos hv
       JOIN hypotheses h ON h.id = hv.hypothesis_id
       JOIN campaigns c ON c.id = h.campaign_id
       WHERE hv.user_id = ? AND h.user_id = ? AND c.project_id = ?`,
      [userId, userId, project.id],
    );

    for (const link of links) {
      const [videoRows] = await pool.query('SELECT * FROM videos WHERE id = ? AND user_id = ? LIMIT 1', [link.video_id, userId]);
      const video = videoRows[0];
      if (!video) continue;
      await linkVideoFolderIntoHypothesis(userId, link.campaign_id, link.hypothesis_id, video);
      if (link.audience_id) {
        await linkVideoFolderIntoAudience(userId, link.campaign_id, link.audience_id, video);
      }
    }
  }
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

function safeParseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeInterviewQuestion(question, index = 0) {
  const allowed = new Set(['short_text', 'long_text', 'single_choice', 'multi_choice', 'scale_1_5']);
  const type = allowed.has(question?.type) ? question.type : 'short_text';
  const id = String(question?.id || `q_${index + 1}`);
  return {
    id,
    type,
    title: String(question?.title || question?.label || `Pregunta ${index + 1}`),
    description: String(question?.description || ''),
    required: Boolean(question?.required),
    options: Array.isArray(question?.options) ? question.options.map((v) => String(v)) : [],
    placeholder: String(question?.placeholder || ''),
    scale: {
      minLabel: String(question?.scale?.minLabel || ''),
      maxLabel: String(question?.scale?.maxLabel || ''),
    },
  };
}

function buildInterviewFormSnapshot(formRow) {
  const questions = safeParseJsonField(formRow?.questions_json, []).map((q, idx) => normalizeInterviewQuestion(q, idx));
  return {
    form_id: formRow?.id || null,
    title: String(formRow?.title || 'Formulario'),
    description: String(formRow?.description || ''),
    questions,
  };
}

function validateInterviewAnswers(snapshot, responses) {
  const errors = [];
  const map = responses && typeof responses === 'object' ? responses : {};
  for (const q of snapshot?.questions || []) {
    if (!q.required) continue;
    const value = map[q.id];
    if (q.type === 'multi_choice') {
      if (!Array.isArray(value) || value.length === 0) errors.push(q.title || q.id);
      continue;
    }
    if (value == null || String(value).trim() === '') errors.push(q.title || q.id);
  }
  return errors;
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

async function hasNotNullColumn(tableName, columnName) {
  const [rows] = await pool.query(`PRAGMA table_info(${tableName})`);
  const column = rows.find((row) => row.name === columnName);
  return Boolean(column && Number(column.notnull) === 1);
}

async function tableExists(tableName) {
  const [rows] = await pool.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [tableName]);
  return rows.length > 0;
}

async function rebuildVideosTableWithNullableContextColumns() {
  const staleLegacyTable = 'videos_legacy_before_nullable_context_fix';
  const hasVideosTable = await tableExists('videos');
  if (!hasVideosTable) return;

  if (await tableExists(staleLegacyTable)) {
    await pool.query(`DROP TABLE ${normalizeIdentifier(staleLegacyTable)}`);
  }

  const [oldInfo] = await pool.query('PRAGMA table_info(videos)');
  const oldColumns = new Set(oldInfo.map((row) => String(row.name)));
  if (!oldColumns.size) return;

  const legacyTableName = `videos_legacy_before_nullable_context_fix_${Date.now()}`;

  await pool.query('PRAGMA foreign_keys = OFF');
  try {
    await pool.query(`ALTER TABLE videos RENAME TO ${normalizeIdentifier(legacyTableName)}`);
    await pool.query(`CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT,
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
      campaign_id TEXT,
      project_id TEXT,
      ad_id TEXT,
      video_id INTEGER,
      cloud_folder_id TEXT,
      metrics_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
      FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    const targetColumns = [
      'id', 'hypothesis_id', 'audience_id', 'user_id', 'video_type', 'title', 'url', 'external_id', 'external_id_type',
      'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'creative_id', 'contexto_cualitativo', 'clicks', 'views_profile',
      'initiatest', 'initiate_checkouts', 'view_content', 'formulario_lead', 'purchase', 'pico_viewers', 'viewers_prom',
      'duracion_min', 'nuevos_seguidores', 'saves', 'organic_piece_type', 'views_finish_pct', 'retencion_pct',
      'tiempo_prom_seg', 'duracion_seg', 'campaign_id_ref', 'ad_set_id', 'cpc', 'ctr', 'duracion_del_video_seg', 'views',
      'engagement', 'likes', 'shares', 'comments', 'campaign_id', 'project_id', 'ad_id', 'video_id', 'cloud_folder_id',
      'metrics_json', 'created_at', 'updated_at',
    ];

    const fallbackByColumn = {
      hypothesis_id: 'NULL',
      audience_id: 'NULL',
      video_type: "'organic'",
      title: "''",
      clicks: '0',
      views_profile: '0',
      initiatest: '0',
      initiate_checkouts: '0',
      view_content: '0',
      formulario_lead: '0',
      purchase: '0',
      pico_viewers: '0',
      viewers_prom: '0',
      duracion_min: '0',
      nuevos_seguidores: '0',
      saves: '0',
      views_finish_pct: '0',
      retencion_pct: '0',
      tiempo_prom_seg: '0',
      duracion_seg: '0',
      cpc: '0',
      ctr: '0',
      duracion_del_video_seg: '0',
      views: '0',
      engagement: '0',
      likes: '0',
      shares: '0',
      comments: '0',
      created_at: 'CURRENT_TIMESTAMP',
      updated_at: 'CURRENT_TIMESTAMP',
    };

    const selectExpressions = targetColumns.map((column) => {
      if (oldColumns.has(column)) return normalizeIdentifier(column);
      return `${fallbackByColumn[column] || 'NULL'} AS ${normalizeIdentifier(column)}`;
    });

    await pool.query(
      `INSERT INTO videos (${targetColumns.map((column) => normalizeIdentifier(column)).join(', ')})
       SELECT ${selectExpressions.join(', ')}
       FROM ${normalizeIdentifier(legacyTableName)}`,
    );

    await pool.query(`DROP TABLE ${normalizeIdentifier(legacyTableName)}`);
  } catch (error) {
    if (!(await tableExists('videos')) && (await tableExists(legacyTableName))) {
      await pool.query(`ALTER TABLE ${normalizeIdentifier(legacyTableName)} RENAME TO videos`);
    }
    throw error;
  } finally {
    await pool.query('PRAGMA foreign_keys = ON');
  }
}

async function ensureHypothesisVideosVideoForeignKeyTarget() {
  if (!(await tableExists('hypothesis_videos'))) return;

  const [fkRows] = await pool.query('PRAGMA foreign_key_list(hypothesis_videos)');
  const videoFk = fkRows.find((row) => String(row.from) === 'video_id');
  if (!videoFk || String(videoFk.table) === 'videos') return;

  const legacyTableName = `hypothesis_videos_legacy_fk_fix_${Date.now()}`;
  await pool.query('PRAGMA foreign_keys = OFF');
  try {
    await pool.query(`ALTER TABLE hypothesis_videos RENAME TO ${normalizeIdentifier(legacyTableName)}`);
    await pool.query(`CREATE TABLE hypothesis_videos (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      audience_id TEXT,
      hook_texto TEXT,
      hook_tipo TEXT,
      cta_texto TEXT,
      cta_tipo TEXT,
      video_type TEXT DEFAULT 'organic',
      contexto_cualitativo TEXT,
      FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(hypothesis_id, video_id)
    )`);

    const [oldInfo] = await pool.query(`PRAGMA table_info(${normalizeIdentifier(legacyTableName)})`);
    const oldColumns = new Set(oldInfo.map((row) => String(row.name)));
    const targetColumns = [
      'id', 'hypothesis_id', 'video_id', 'user_id', 'created_at',
      'audience_id', 'hook_texto', 'hook_tipo', 'cta_texto', 'cta_tipo', 'video_type', 'contexto_cualitativo',
    ];
    const selectExpr = targetColumns.map((col) => {
      if (oldColumns.has(col)) return normalizeIdentifier(col);
      if (col === 'created_at') return `CURRENT_TIMESTAMP AS ${normalizeIdentifier(col)}`;
      if (col === 'video_type') return `'organic' AS ${normalizeIdentifier(col)}`;
      return `NULL AS ${normalizeIdentifier(col)}`;
    });

    await pool.query(
      `INSERT INTO hypothesis_videos (${targetColumns.map((column) => normalizeIdentifier(column)).join(', ')})
       SELECT ${selectExpr.join(', ')} FROM ${normalizeIdentifier(legacyTableName)}`,
    );

    await pool.query(`DROP TABLE ${normalizeIdentifier(legacyTableName)}`);
  } catch (error) {
    if (!(await tableExists('hypothesis_videos')) && (await tableExists(legacyTableName))) {
      await pool.query(`ALTER TABLE ${normalizeIdentifier(legacyTableName)} RENAME TO hypothesis_videos`);
    }
    throw error;
  } finally {
    await pool.query('PRAGMA foreign_keys = ON');
  }
}


async function ensureVideoHierarchyMigration() {
  if (!(await hasColumn('videos', 'hypothesis_id'))) {
    await pool.query('ALTER TABLE videos ADD COLUMN hypothesis_id TEXT');
  }

  const videosHypothesisNotNull = await hasNotNullColumn('videos', 'hypothesis_id');
  const videosAudienceNotNull = await hasNotNullColumn('videos', 'audience_id');
  if (videosHypothesisNotNull || videosAudienceNotNull) {
    await rebuildVideosTableWithNullableContextColumns();
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
    ['campaign_id', 'TEXT'],
    ['project_id', 'TEXT'],
    ['campaign_id_ref', 'TEXT'],
    ['ad_set_id', 'TEXT'],
    ['ad_id', 'TEXT'],
    ['video_id', 'INTEGER'],
    ['cloud_folder_id', 'TEXT'],
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_campaign_id ON videos(campaign_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_project_id ON videos(project_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(video_type)');
  await pool.query(`CREATE TABLE IF NOT EXISTS hypothesis_videos (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(hypothesis_id, video_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_hypothesis_videos_hypothesis_id ON hypothesis_videos(hypothesis_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_hypothesis_videos_video_id ON hypothesis_videos(video_id)');
  const hypothesisVideoContextColumns = [
    ['audience_id', 'TEXT'],
    ['hook_texto', 'TEXT'],
    ['hook_tipo', 'TEXT'],
    ['cta_texto', 'TEXT'],
    ['cta_tipo', 'TEXT'],
    ['video_type', "TEXT DEFAULT 'organic'"],
    ['contexto_cualitativo', 'TEXT'],
  ];
  for (const [columnName, columnType] of hypothesisVideoContextColumns) {
    if (!(await hasColumn('hypothesis_videos', columnName))) {
      await pool.query(`ALTER TABLE hypothesis_videos ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  if (!(await hasColumn('hypotheses', 'audience_id'))) {
    await pool.query('ALTER TABLE hypotheses ADD COLUMN audience_id TEXT');
  }

  if (!(await hasColumn('interview_sessions', 'status'))) {
    await pool.query("ALTER TABLE interview_sessions ADD COLUMN status TEXT DEFAULT 'draft'");
  }
  if (!(await hasColumn('interview_sessions', 'completed_at'))) {
    await pool.query('ALTER TABLE interview_sessions ADD COLUMN completed_at TEXT');
  }
  if (!(await hasColumn('interview_sessions', 'form_snapshot_json'))) {
    await pool.query('ALTER TABLE interview_sessions ADD COLUMN form_snapshot_json TEXT');
  }

  await ensureHypothesisVideosVideoForeignKeyTarget();
  await pool.query('DROP TABLE IF EXISTS cloud_events');
  await pool.query('DROP TABLE IF EXISTS cloud_edges');
  await pool.query('DROP TABLE IF EXISTS cloud_nodes');

  await pool.query(`CREATE TABLE IF NOT EXISTS cloud_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('folder','file')),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    canonical_key TEXT,
    target_type TEXT,
    target_id TEXT,
    mime_type TEXT,
    size INTEGER,
    storage_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, canonical_key)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cloud_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    edge_kind TEXT NOT NULL DEFAULT 'link' CHECK(edge_kind IN ('link')),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, parent_id, child_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cloud_nodes_project_parent ON cloud_nodes(project_id, parent_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cloud_nodes_user_target ON cloud_nodes(user_id, target_type, target_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cloud_edges_project_parent ON cloud_edges(project_id, parent_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cloud_edges_project_child ON cloud_edges(project_id, child_id)');

  await pool.query(
    `UPDATE videos
     SET campaign_id = (
       SELECT h.campaign_id FROM hypotheses h WHERE h.id = videos.hypothesis_id
     )
     WHERE (campaign_id IS NULL OR trim(CAST(campaign_id AS TEXT)) = '') AND hypothesis_id IS NOT NULL`,
  );
  await pool.query(
    `UPDATE videos
     SET project_id = (
       SELECT c.project_id
       FROM campaigns c
       WHERE c.id = videos.campaign_id
     )
     WHERE (project_id IS NULL OR trim(CAST(project_id AS TEXT)) = '')
       AND campaign_id IS NOT NULL
       AND trim(CAST(campaign_id AS TEXT)) <> ''`,
  );

  await pool.query(
    `UPDATE videos
     SET project_id = (
       SELECT c.project_id
       FROM hypotheses h
       JOIN campaigns c ON c.id = h.campaign_id
       WHERE h.id = videos.hypothesis_id
     )
     WHERE (project_id IS NULL OR trim(CAST(project_id AS TEXT)) = '')
       AND hypothesis_id IS NOT NULL
       AND trim(CAST(hypothesis_id AS TEXT)) <> ''`,
  );

  await pool.query(
    `UPDATE hypothesis_videos
     SET audience_id = COALESCE(audience_id, (
           SELECT h.audience_id FROM hypotheses h WHERE h.id = hypothesis_videos.hypothesis_id
         ), (
           SELECT v.audience_id FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         hook_texto = COALESCE(hook_texto, (
           SELECT v.hook_texto FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         hook_tipo = COALESCE(hook_tipo, (
           SELECT v.hook_tipo FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         cta_texto = COALESCE(cta_texto, (
           SELECT v.cta_texto FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         cta_tipo = COALESCE(cta_tipo, (
           SELECT v.cta_tipo FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         video_type = COALESCE(video_type, (
           SELECT v.video_type FROM videos v WHERE v.id = hypothesis_videos.video_id
         )),
         contexto_cualitativo = COALESCE(contexto_cualitativo, (
           SELECT v.contexto_cualitativo FROM videos v WHERE v.id = hypothesis_videos.video_id
         ))
     WHERE user_id IS NOT NULL`,
  );

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
  // Rebuild Cloud schema from scratch to avoid legacy column/index mismatches.
  await pool.query('DROP TABLE IF EXISTS cloud_events');
  await pool.query('DROP TABLE IF EXISTS cloud_edges');
  await pool.query('DROP TABLE IF EXISTS cloud_nodes');

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

function resolveHypothesisMetricConfig(hypothesis = {}) {
  const primaryMetric = String(hypothesis.metrica_objetivo_y || 'views').trim();
  const threshold = Number(hypothesis.umbral_valor ?? 0);
  const directOperator = String(hypothesis.umbral_operador || '').trim();

  if (directOperator) {
    return { metric: primaryMetric, operator: directOperator, threshold: Number.isFinite(threshold) ? threshold : 0 };
  }

  const condition = String(hypothesis.condition || '');
  const parsed = condition.match(/(>=|<=|>|<)\s*(-?[0-9]+(?:\.[0-9]+)?)/);
  if (parsed) {
    return {
      metric: primaryMetric,
      operator: parsed[1],
      threshold: Number(parsed[2]),
    };
  }

  return { metric: primaryMetric, operator: '>=', threshold: Number.isFinite(threshold) ? threshold : 0 };
}

function compareAgainstThreshold(value, operator, threshold) {
  if (operator === '>=') return value >= threshold;
  if (operator === '<=') return value <= threshold;
  if (operator === '>') return value > threshold;
  if (operator === '<') return value < threshold;
  return value >= threshold;
}

function computeAudienceMetricValueFromAggregate(metric, aggregateRow = {}) {
  const normalizedMetric = String(metric || '').trim().toLowerCase();
  const countMetrics = new Set([
    'clicks',
    'views',
    'views_profile',
    'initiatest',
    'initiate_checkouts',
    'view_content',
    'formulario_lead',
    'purchase',
    'likes',
    'comments',
    'shares',
    'saves',
    'nuevos_seguidores',
    'pico_viewers',
  ]);

  const aliasMap = {
    'views finish %': 'views_finish_pct',
    'retention %': 'retencion_pct',
    'avg watch time': 'tiempo_prom_seg',
    'live peak viewers': 'pico_viewers',
    'live avg viewers': 'viewers_prom',
    'live new followers': 'nuevos_seguidores',
  };
  const resolvedMetric = aliasMap[normalizedMetric] || normalizedMetric;

  if (countMetrics.has(resolvedMetric)) {
    return toNumber(aggregateRow[`sum_${resolvedMetric}`], 0);
  }

  if (resolvedMetric === 'ctr') {
    const clicks = toNumber(aggregateRow.sum_clicks, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? clicks / views : toNumber(aggregateRow.avg_ctr, 0);
  }

  if (resolvedMetric === 'cpc') {
    return toNumber(aggregateRow.avg_cpc, 0);
  }

  if (resolvedMetric === 'initiate_checkout_rate') {
    const initiateCheckouts = toNumber(aggregateRow.sum_initiate_checkouts, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? initiateCheckouts / views : 0;
  }

  if (resolvedMetric === 'view_content_rate') {
    const viewContent = toNumber(aggregateRow.sum_view_content, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? viewContent / views : 0;
  }

  if (resolvedMetric === 'lead_rate') {
    const leads = toNumber(aggregateRow.sum_formulario_lead, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? leads / views : 0;
  }

  if (resolvedMetric === 'purchase_rate') {
    const purchases = toNumber(aggregateRow.sum_purchase, 0);
    const viewContent = toNumber(aggregateRow.sum_view_content, 0);
    return viewContent > 0 ? purchases / viewContent : 0;
  }

  if (resolvedMetric === 'retencion_pct') {
    const weightedSum = toNumber(aggregateRow.weighted_retencion, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? weightedSum / views : toNumber(aggregateRow.avg_retencion_pct, 0);
  }

  if (resolvedMetric === 'views_finish_pct') {
    const weightedSum = toNumber(aggregateRow.weighted_views_finish, 0);
    const views = toNumber(aggregateRow.sum_views, 0);
    return views > 0 ? weightedSum / views : toNumber(aggregateRow.avg_views_finish_pct, 0);
  }

  if (resolvedMetric === 'tiempo_prom_seg') {
    return toNumber(aggregateRow.avg_tiempo_prom_seg, 0);
  }

  if (resolvedMetric === 'viewers_prom') {
    return toNumber(aggregateRow.avg_viewers_prom, 0);
  }

  return toNumber(aggregateRow[`sum_${resolvedMetric}`] ?? aggregateRow[`avg_${resolvedMetric}`], 0);
}



async function buildHypothesisAudienceBreakdown({ videos = [], userId, metric, operator, threshold }) {
  if (!Array.isArray(videos) || videos.length === 0) return [];

  const groups = new Map();
  for (const video of videos) {
    const key = video.audience_id ? String(video.audience_id) : '__null__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  }

  const audienceIds = [...groups.keys()].filter((key) => key !== '__null__');
  const audienceNameById = new Map();
  if (audienceIds.length) {
    const placeholders = audienceIds.map(() => '?').join(', ');
    const [audiences] = await pool.query(
      `SELECT id, name FROM audiences WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...audienceIds],
    );
    audiences.forEach((audience) => audienceNameById.set(String(audience.id), audience.name || 'Sin nombre'));
  }

  const normalizedMetric = String(metric || '').trim().toLowerCase();

  return [...groups.entries()].map(([groupKey, groupVideos]) => {
    const videosCount = groupVideos.length;
    if (!videosCount) {
      return {
        audience_id: groupKey === '__null__' ? null : groupKey,
        audience_name: groupKey === '__null__' ? 'Sin público' : (audienceNameById.get(groupKey) || 'Sin nombre'),
        videos_count: 0,
        metric_value: null,
        status: 'no_data',
      };
    }

    let metricValue = null;

    if (normalizedMetric === 'ctr') {
      const clicks = groupVideos.reduce((sum, video) => sum + toNumber(video.clicks), 0);
      const views = groupVideos.reduce((sum, video) => sum + toNumber(video.views), 0);
      metricValue = views > 0 ? clicks / views : null;
    } else if (normalizedMetric === 'retencion_pct' || normalizedMetric === 'retention_pct') {
      const weighted = groupVideos.reduce((sum, video) => sum + (toNumber(video.retencion_pct) * Math.max(toNumber(video.views), 0)), 0);
      const views = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.views), 0), 0);
      metricValue = views > 0 ? weighted / views : null;
    } else if (normalizedMetric === 'views_finish_pct') {
      const weighted = groupVideos.reduce((sum, video) => sum + (toNumber(video.views_finish_pct) * Math.max(toNumber(video.views), 0)), 0);
      const views = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.views), 0), 0);
      metricValue = views > 0 ? weighted / views : null;
    } else if (normalizedMetric === 'initiate_checkout_rate') {
      const numerator = groupVideos.reduce((sum, video) => sum + toNumber(video.initiate_checkouts), 0);
      const denominator = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.views), 0), 0);
      metricValue = denominator > 0 ? numerator / denominator : null;
    } else if (normalizedMetric === 'view_content_rate') {
      const numerator = groupVideos.reduce((sum, video) => sum + toNumber(video.view_content), 0);
      const denominator = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.views), 0), 0);
      metricValue = denominator > 0 ? numerator / denominator : null;
    } else if (normalizedMetric === 'lead_rate') {
      const numerator = groupVideos.reduce((sum, video) => sum + toNumber(video.formulario_lead), 0);
      const denominator = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.views), 0), 0);
      metricValue = denominator > 0 ? numerator / denominator : null;
    } else if (normalizedMetric === 'purchase_rate') {
      const numerator = groupVideos.reduce((sum, video) => sum + toNumber(video.purchase), 0);
      const denominator = groupVideos.reduce((sum, video) => sum + Math.max(toNumber(video.view_content), 0), 0);
      metricValue = denominator > 0 ? numerator / denominator : null;
    } else if (normalizedMetric === 'cpc') {
      const values = groupVideos.map((video) => toNumber(video.cpc)).filter((value) => Number.isFinite(value));
      metricValue = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    } else {
      const metricFieldMap = {
        lead_form: 'formulario_lead',
        new_followers: 'nuevos_seguidores',
      };
      const field = metricFieldMap[normalizedMetric] || normalizedMetric;
      metricValue = groupVideos.reduce((sum, video) => sum + toNumber(video[field]), 0);
    }

    const status = metricValue == null
      ? 'no_data'
      : compareAgainstThreshold(metricValue, operator, threshold)
        ? 'pass'
        : 'fail';

    return {
      audience_id: groupKey === '__null__' ? null : groupKey,
      audience_name: groupKey === '__null__' ? 'Sin público' : (audienceNameById.get(groupKey) || 'Sin nombre'),
      videos_count: videosCount,
      metric_value: metricValue,
      status,
    };
  });
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


async function fetchOwnedHypothesisById(hypothesisId, userId) {
  const [rows] = await pool.query(
    `SELECT h.*, c.project_id
     FROM hypotheses h
     JOIN campaigns c ON c.id = h.campaign_id
     JOIN projects p ON p.id = c.project_id
     WHERE h.id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [hypothesisId, userId, userId, userId],
  );
  return rows[0] || null;
}

async function listVideosLinkedToHypothesis(hypothesisId, userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT v.*
     FROM videos v
     JOIN hypothesis_videos hv ON hv.video_id = v.id AND hv.user_id = v.user_id
     WHERE v.user_id = ?
       AND hv.hypothesis_id = ?`,
    [userId, hypothesisId],
  );
  return rows;
}

async function countOtherUsageInCampaign(videoId, sourceCampaignId, hypothesisId, userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(DISTINCT h.id) AS total
     FROM hypotheses h
     WHERE h.user_id = ?
       AND h.campaign_id = ?
       AND h.id <> ?
       AND (
         EXISTS (
           SELECT 1 FROM hypothesis_videos hv
           WHERE hv.user_id = ? AND hv.hypothesis_id = h.id AND hv.video_id = ?
         )
       )`,
    [userId, sourceCampaignId, hypothesisId, userId, videoId],
  );
  return Number(rows[0]?.total || 0);
}

async function listVideosForHypothesis(hypothesisId, userId, options = {}) {
  const where = [
    'v.user_id = ?',
    'hv.hypothesis_id = ?',
  ];
  const params = [userId, hypothesisId];

  if (options.video_type) {
    where.push('v.video_type = ?');
    params.push(options.video_type);
  }
  if (options.date_from) {
    where.push('v.created_at >= ?');
    params.push(options.date_from);
  }
  if (options.date_to) {
    where.push('v.created_at <= ?');
    params.push(options.date_to);
  }

  const [rows] = await pool.query(
    `SELECT v.*,
      hv.audience_id AS audience_id,
      hv.hypothesis_id AS context_hypothesis_id,
      0 AS is_reused_for_hypothesis,
      NULL AS source_hypothesis_id,
      NULL AS source_hypothesis_name
     FROM videos v
     JOIN hypothesis_videos hv ON hv.video_id = v.id AND hv.user_id = v.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY v.created_at DESC`,
    params,
  );
  return rows;
}

async function listVideosForProject(projectId, userId, options = {}) {
  const where = ['v.user_id = ?', 'v.project_id = ?'];
  const params = [userId, projectId];
  if (options.video_type) {
    where.push('EXISTS (SELECT 1 FROM hypothesis_videos hv WHERE hv.video_id = v.id AND hv.user_id = v.user_id AND hv.video_type = ?)');
    params.push(options.video_type);
  }
  if (options.session_id) {
    where.push('(v.external_id = ? OR CAST(v.video_id AS TEXT) = ?)');
    params.push(options.session_id, options.session_id);
  }
  if (options.search) {
    where.push("(lower(coalesce(v.title,'')) LIKE ? OR lower(coalesce(v.external_id,'')) LIKE ?)");
    const q = `%${String(options.search).toLowerCase()}%`;
    params.push(q, q);
  }
  if (options.usage === 'used') {
    where.push('EXISTS (SELECT 1 FROM hypothesis_videos hv WHERE hv.video_id = v.id AND hv.user_id = ?)');
    params.push(userId);
  } else if (options.usage === 'unused') {
    where.push('NOT EXISTS (SELECT 1 FROM hypothesis_videos hv WHERE hv.video_id = v.id AND hv.user_id = ?)');
    params.push(userId);
  }

  const [rows] = await pool.query(
    `SELECT v.*,
      COUNT(DISTINCT hv.hypothesis_id) AS used_in_hypotheses,
      GROUP_CONCAT(DISTINCT COALESCE(h.hypothesis_statement, h.condition, h.type, h.id)) AS linked_hypotheses
     FROM videos v
     LEFT JOIN hypothesis_videos hv ON hv.video_id = v.id AND hv.user_id = v.user_id
     LEFT JOIN hypotheses h ON h.id = hv.hypothesis_id
     WHERE ${where.join(' AND ')}
     GROUP BY v.id
     ORDER BY v.created_at DESC`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    used_in_hypotheses: Number(row.used_in_hypotheses || 0),
    linked_hypotheses: row.linked_hypotheses ? String(row.linked_hypotheses).split(',') : [],
  }));
}


async function listVideosForCampaign(campaignId, userId, options = {}) {
  const where = ['v.user_id = ?', 'v.campaign_id = ?'];
  const params = [userId, campaignId];
  if (options.video_type) {
    where.push('v.video_type = ?');
    params.push(options.video_type);
  }
  if (options.session_id) {
    where.push('(v.external_id = ? OR CAST(v.video_id AS TEXT) = ?)');
    params.push(options.session_id, options.session_id);
  }
  if (options.search) {
    where.push("(lower(coalesce(v.title,'')) LIKE ? OR lower(coalesce(v.hook_texto,'')) LIKE ? OR lower(coalesce(v.cta_texto,'')) LIKE ?)");
    const q = `%${String(options.search).toLowerCase()}%`;
    params.push(q, q, q);
  }
  if (options.usage === 'used') {
    where.push('EXISTS (SELECT 1 FROM hypothesis_videos hv WHERE hv.video_id = v.id AND hv.user_id = ?)');
    params.push(userId);
  } else if (options.usage === 'unused') {
    where.push('NOT EXISTS (SELECT 1 FROM hypothesis_videos hv WHERE hv.video_id = v.id AND hv.user_id = ?)');
    params.push(userId);
  }

  const [rows] = await pool.query(
    `SELECT v.*, 
      COUNT(DISTINCT hv.hypothesis_id) AS used_in_hypotheses,
      GROUP_CONCAT(DISTINCT COALESCE(h.hypothesis_statement, h.condition, h.type, h.id)) AS linked_hypotheses
     FROM videos v
     LEFT JOIN hypothesis_videos hv ON hv.video_id = v.id AND hv.user_id = v.user_id
     LEFT JOIN hypotheses h ON h.id = hv.hypothesis_id
     WHERE ${where.join(' AND ')}
     GROUP BY v.id
     ORDER BY v.created_at DESC`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    used_in_hypotheses: Number(row.used_in_hypotheses || 0),
    linked_hypotheses: row.linked_hypotheses ? String(row.linked_hypotheses).split(',') : [],
  }));
}


const hypothesisContextOnlyFields = new Set(['audience_id']);

const videoGlobalForbiddenFields = new Set(['audience_id', 'audience', 'hypothesis_id', 'campaign_id']);

async function loadHypothesisAnalysisContext(hypothesisId, userId, config = {}) {
  const hypothesis = await fetchOwnedHypothesisById(hypothesisId, userId);
  if (!hypothesis) throw new Error('Hypothesis not found');

  const videos = await listVideosForHypothesis(hypothesisId, userId, config);
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
     WHERE v.id = ? AND v.user_id = ?
     LIMIT 1`,
    [videoId, userId],
  );
  return rows[0] || null;
}

async function fetchOwnedCampaignById(campaignId, userId) {
  const [rows] = await pool.query(
    `SELECT c.*, p.id AS project_id
     FROM campaigns c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND c.user_id = ? AND p.user_id = ?
     LIMIT 1`,
    [campaignId, userId, userId],
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
      if (!writeRow.video_type || !['paid', 'organic', 'live'].includes(String(writeRow.video_type))) {
        throw new Error("videos.video_type must be one of: paid, organic, live");
      }

      if (writeRow.hypothesis_id) {
        const [ownershipRows] = await pool.query(
          `SELECT h.id, h.campaign_id
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
        if (!writeRow.campaign_id) {
          writeRow.campaign_id = ownershipRows[0].campaign_id;
        }
      }

      if (!writeRow.campaign_id && !writeRow.project_id) {
        throw new Error('videos.campaign_id or videos.project_id is required when hypothesis_id is missing');
      }

      if (writeRow.campaign_id) {
        const [campaignRows] = await pool.query(
          `SELECT id, project_id
           FROM campaigns
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
          [writeRow.campaign_id, currentUserId],
        );
        if (!campaignRows.length) {
          throw new Error('Invalid campaign_id for current user');
        }
        if (!writeRow.project_id) {
          writeRow.project_id = campaignRows[0].project_id;
        }
      }

      if (writeRow.project_id) {
        const [projectRows] = await pool.query(
          `SELECT id
           FROM projects
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
          [writeRow.project_id, currentUserId],
        );
        if (!projectRows.length) {
          throw new Error('Invalid project_id for current user');
        }
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

    const assignAutoIdentifiersForVideo = async () => {
      if (table !== 'videos') return;

      if (writeRow.video_id == null || String(writeRow.video_id).trim() === '') {
        const hasProjectScope = String(writeRow.project_id || '').trim() !== '';
        const [maxRows] = await pool.query(
          `SELECT COALESCE(MAX(CASE
            WHEN trim(CAST(video_id AS TEXT)) <> '' AND trim(CAST(video_id AS TEXT)) GLOB '[0-9]*'
            THEN CAST(video_id AS INTEGER)
            ELSE NULL
          END), 0) AS max_video_id
          FROM videos
          WHERE user_id = ? ${hasProjectScope ? 'AND project_id = ?' : ''}`,
          hasProjectScope ? [currentUserId, writeRow.project_id] : [currentUserId],
        );
        writeRow.video_id = Number(maxRows[0]?.max_video_id || 0) + 1;
      }

      if (!String(writeRow.external_id || '').trim()) {
        const generatedExternalId = autoExternalIdForVideo(writeRow.video_type, writeRow.video_id);
        if (generatedExternalId) {
          if (String(writeRow.project_id || '').trim()) {
            const [existsRows] = await pool.query(
              'SELECT id FROM videos WHERE user_id = ? AND project_id = ? AND external_id = ? LIMIT 1',
              [currentUserId, writeRow.project_id, generatedExternalId],
            );
            if (existsRows.length) {
              const prefix = generatedExternalId.split('-')[0] || 'session';
              const [maxRows] = await pool.query(
                `SELECT COALESCE(MAX(CASE
                  WHEN external_id LIKE ? AND trim(substr(external_id, instr(external_id, '-') + 1)) GLOB '[0-9]*'
                  THEN CAST(substr(external_id, instr(external_id, '-') + 1) AS INTEGER)
                  ELSE NULL
                END), 0) AS max_external_seq
                FROM videos
                WHERE user_id = ? AND project_id = ?`,
                [`${prefix}-%`, currentUserId, writeRow.project_id],
              );
              const nextSequence = Number(maxRows[0]?.max_external_seq || 0) + 1;
              writeRow.external_id = `${prefix}-${nextSequence}`;
            } else {
              writeRow.external_id = generatedExternalId;
            }
          } else {
            writeRow.external_id = generatedExternalId;
          }
        }
      }
    };

    if (table === 'videos') {
      await pool.query('BEGIN IMMEDIATE');
      try {
        await assignAutoIdentifiersForVideo();
        await insertRow();
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } else {
      await insertRow();
    }
    let [inserted] = await pool.query(`SELECT * FROM ${quotedTable} WHERE id = ?`, [writeRow.id]);

    if (table === 'videos') {
      const created = inserted[0] || null;
      if (created) {
        const canonicalFolder = await ensureVideoCanonicalFolder(currentUserId, created);
        if (!canonicalFolder) {
          await pool.query('DELETE FROM hypothesis_videos WHERE video_id = ? AND user_id = ?', [created.id, currentUserId]);
          await pool.query('DELETE FROM videos WHERE id = ? AND user_id = ?', [created.id, currentUserId]);
          throw new Error('No se pudo crear carpeta canonical en Cloud para el video.');
        }
        [inserted] = await pool.query(`SELECT * FROM ${quotedTable} WHERE id = ?`, [writeRow.id]);
      }
    }

    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'hypothesis_videos'].includes(table)) {
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
    if (table === 'hypotheses' && Object.prototype.hasOwnProperty.call(payload || {}, 'audience_id')) {
      for (const hypothesis of updated) {
        await pool.query(
          'UPDATE hypothesis_videos SET audience_id = ? WHERE hypothesis_id = ? AND user_id = ?',
          [hypothesis?.audience_id || null, hypothesis.id, currentUserId],
        );
      }
    }
    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'hypothesis_videos'].includes(table)) {
      await syncCloudForUser(currentUserId);
    }
    return updated;
  }

  if (operation === 'delete') {
    await pool.query(`DELETE FROM ${quotedTable}${where}`, whereValues);
    if (['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'hypothesis_videos'].includes(table)) {
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

    if ((url.pathname === '/api/cloud/tree' || url.pathname === '/api/cloud/list') && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      if (!projectId) {
        sendJson(req, res, 400, { error: 'projectId is required' });
        return;
      }
      const [projectRows] = await pool.query('SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
      if (!projectRows.length) {
        sendJson(req, res, 404, { error: 'Project not found' });
        return;
      }
      await syncCloudForUser(user.id, projectId);
      const parentId = url.searchParams.get('parentId');
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') || 'name';
      const limit = Math.max(Number(url.searchParams.get('limit') || 200), 1);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

      let rows = await listCloudChildren(user.id, parentId);
      rows = rows.filter((row) => String(row.project_id || '') === projectId);
      if (search) rows = rows.filter((row) => String(row.name || '').toLowerCase().includes(search));
      if (sort === 'updated_at') rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      if (sort === 'created_at') rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      const paged = rows.slice(offset, offset + limit);
      const breadcrumbs = parentId ? await getCloudBreadcrumbs(user.id, parentId) : [];
      sendJson(req, res, 200, {
        data: paged.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.is_linked_from_edge ? 'shortcut' : row.kind,
          type: row.type,
          targetId: row.is_linked_from_edge ? row.id : null,
          size: row.size,
          updatedAt: row.updated_at,
          mimeType: row.mime_type,
          isShortcut: Boolean(row.is_linked_from_edge),
        })),
        total: rows.length,
        breadcrumbs,
      });
      return;
    }

    if (url.pathname === '/api/cloud/folder' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      const projectId = String(body?.projectId || '').trim();
      const parentId = String(body?.parentId || '').trim() || null;
      const name = sanitizeCloudName(body?.name);
      if (!projectId || !name) {
        sendJson(req, res, 400, { error: 'projectId and name are required' });
        return;
      }
      const node = await createCloudNode({ userId: user.id, projectId, parentId, name, type: 'folder' });
      sendJson(req, res, 201, { node });
      return;
    }

    const cloudNodeMatch = url.pathname.match(/^\/api\/cloud\/node\/([^/]+)$/);
    if (cloudNodeMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const nodeId = cloudNodeMatch[1];
      const node = await getCloudNodeById(nodeId, user.id);
      if (!node) {
        sendJson(req, res, 404, { error: 'Node not found' });
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const name = sanitizeCloudName(body?.name);
        if (!name) {
          sendJson(req, res, 400, { error: 'name is required' });
          return;
        }
        await pool.query('UPDATE cloud_nodes SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, nowIso(), nodeId, user.id]);
        sendJson(req, res, 200, { ok: true });
        return;
      }

      const parentId = String(url.searchParams.get('parentId') || '').trim() || null;
      if (parentId) {
        const [edgeRows] = await pool.query('SELECT id FROM cloud_edges WHERE user_id = ? AND parent_id = ? AND child_id = ? LIMIT 1', [user.id, parentId, nodeId]);
        if (edgeRows.length) {
          await unlinkCloudEdge(user.id, parentId, nodeId);
          sendJson(req, res, 200, { ok: true, unlinked: true });
          return;
        }
      }
      await deleteCloudNodeTree(user.id, nodeId);
      sendJson(req, res, 200, { ok: true, deleted: true });
      return;
    }

    if (url.pathname === '/api/cloud/upload' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyBuffer = Buffer.concat(chunks);
      const form = parseMultipartFormData(bodyBuffer, req.headers['content-type']);
      const projectId = String(form.projectId || '').trim();
      const parentId = String(form.parentId || '').trim() || null;
      const file = form.file;
      if (!projectId || !parentId || !file?.buffer) {
        sendJson(req, res, 400, { error: 'projectId, parentId and file are required' });
        return;
      }
      const parentNode = await getCloudNodeById(parentId, user.id);
      if (!parentNode || String(parentNode.project_id) !== projectId) {
        sendJson(req, res, 404, { error: 'Parent folder not found' });
        return;
      }
      const fileId = uuid();
      const ext = path.extname(file.filename || '') || '.bin';
      const storagePath = path.join(storageRoot, 'cloud', projectId, `${fileId}${ext}`);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, file.buffer);
      const node = await createCloudNode({
        userId: user.id,
        projectId,
        parentId,
        name: file.filename,
        type: 'file',
        mimeType: file.mimeType,
        size: file.buffer.length,
        storagePath,
      });
      sendJson(req, res, 201, { node });
      return;
    }

    const cloudDownloadMatch = url.pathname.match(/^\/api\/cloud\/download(?:\/([^/]+))?$/);
    if (cloudDownloadMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const nodeId = cloudDownloadMatch[1] || url.searchParams.get('nodeId');
      const node = await getCloudNodeById(nodeId, user.id);
      if (!node || node.type !== 'file' || !node.storage_path || !fs.existsSync(node.storage_path)) {
        sendJson(req, res, 404, { error: 'File not found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': node.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(node.name || 'file')}"`,
      });
      fs.createReadStream(node.storage_path).pipe(res);
      return;
    }


    if (url.pathname === '/api/cloud/search' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (!projectId) {
        sendJson(req, res, 400, { error: 'projectId is required' });
        return;
      }
      const [rows] = await pool.query(
        `SELECT id, name, kind, type, parent_id, updated_at
         FROM cloud_nodes
         WHERE user_id = ? AND project_id = ? AND lower(name) LIKE ?
         ORDER BY updated_at DESC
         LIMIT 100`,
        [user.id, projectId, `%${q}%`],
      );
      sendJson(req, res, 200, { data: rows });
      return;
    }

    if (url.pathname === '/api/cloud/resolve-shortcut' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const nodeId = String(url.searchParams.get('nodeId') || '').trim();
      const parentId = String(url.searchParams.get('parentId') || '').trim() || null;
      if (!nodeId || !parentId) {
        sendJson(req, res, 400, { error: 'nodeId and parentId are required' });
        return;
      }
      const [edgeRows] = await pool.query('SELECT id FROM cloud_edges WHERE user_id = ? AND parent_id = ? AND child_id = ? LIMIT 1', [user.id, parentId, nodeId]);
      if (!edgeRows.length) {
        sendJson(req, res, 404, { error: 'Shortcut not found' });
        return;
      }
      sendJson(req, res, 200, { targetId: nodeId });
      return;
    }

    if (url.pathname === '/api/cloud/sync' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = String(url.searchParams.get('projectId') || '').trim() || null;
      if (projectId) {
        const [projectRows] = await pool.query('SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
        if (!projectRows.length) {
          sendJson(req, res, 404, { error: 'Project not found' });
          return;
        }
      }
      await syncCloudForUser(user.id, projectId);
      sendJson(req, res, 200, { ok: true, project_id: projectId });
      return;
    }

    const cloudOverviewMatch = url.pathname.match(/^\/api\/cloud\/projects\/([^/]+)\/overview$/);
    if (cloudOverviewMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = cloudOverviewMatch[1];
      const [projectRows] = await pool.query('SELECT id, name FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
      if (!projectRows.length) {
        sendJson(req, res, 404, { error: 'Project not found' });
        return;
      }
      await syncCloudForUser(user.id, projectId);
      const roots = await ensureProjectCloudRoots(user.id, projectId);
      const [canonicalVideos] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND parent_id = ? ORDER BY name COLLATE NOCASE ASC', [user.id, projectId, roots.videosRoot.id]);
      const [hypothesisRoots] = await pool.query("SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND canonical_key LIKE 'hypothesis_root:%' ORDER BY name COLLATE NOCASE ASC", [user.id, projectId]);
      const hypothesisItems = [];
      for (const hypothesisRoot of hypothesisRoots) {
        const [videosFolderRows] = await pool.query('SELECT * FROM cloud_nodes WHERE user_id = ? AND project_id = ? AND parent_id = ? AND name = ? LIMIT 1', [user.id, projectId, hypothesisRoot.id, 'Videos']);
        const videosFolder = videosFolderRows[0] || null;
        let links = [];
        if (videosFolder) {
          const [edgeRows] = await pool.query('SELECT e.*, n.name AS child_name FROM cloud_edges e JOIN cloud_nodes n ON n.id = e.child_id WHERE e.user_id = ? AND e.project_id = ? AND e.parent_id = ? ORDER BY n.name COLLATE NOCASE ASC', [user.id, projectId, videosFolder.id]);
          links = edgeRows;
        }
        hypothesisItems.push({ hypothesis_root: hypothesisRoot, videos_folder: videosFolder, links });
      }
      sendJson(req, res, 200, {
        project: projectRows[0],
        roots,
        videos: canonicalVideos,
        hypotheses: hypothesisItems,
      });
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

    if (videoMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
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
      const forbidden = Object.keys(body || {}).filter((field) => videoGlobalForbiddenFields.has(field));
      if (forbidden.length) {
        sendJson(req, res, 400, { error: 'Global video payload contains forbidden fields', code: 'VIDEO_GLOBAL_FORBIDDEN_FIELDS', fields: forbidden });
        return;
      }

      const disallowed = new Set(['id', 'user_id', 'created_at', 'video_id', 'campaign_id', 'project_id']);
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

    if (videoMatch && req.method === 'DELETE') {
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

      try {
        await purgeVideoCloudArtifacts(user.id, existing.id);

        await pool.query('BEGIN');
        try {
          await pool.query('DELETE FROM hypothesis_videos WHERE video_id = ? AND user_id = ?', [existing.id, user.id]);
          await pool.query('DELETE FROM videos WHERE id = ? AND user_id = ?', [existing.id, user.id]);
          await pool.query('COMMIT');
        } catch (dbError) {
          await pool.query('ROLLBACK');
          throw dbError;
        }

        await syncCloudForUser(user.id);
        sendJson(req, res, 200, { ok: true, deleted_video_id: existing.id });
      } catch (error) {
        sendJson(req, res, 500, { error: error?.message || String(error) });
      }
      return;
    }

    if (url.pathname === '/api/videos' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      const forbidden = Object.keys(body || {}).filter((field) => videoGlobalForbiddenFields.has(field));
      if (forbidden.length) {
        sendJson(req, res, 400, { error: 'Global video payload contains forbidden fields', code: 'VIDEO_GLOBAL_FORBIDDEN_FIELDS', fields: forbidden });
        return;
      }
      if (!body?.project_id) {
        sendJson(req, res, 400, { error: 'project_id is required' });
        return;
      }
      const payload = {
        ...body,
      };
      const rows = await executeCrudQuery({ table: 'videos', operation: 'insert', payload }, user.id);
      sendJson(req, res, 200, { data: rows });
      return;
    }


    const campaignVideosMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/videos$/);
    if (campaignVideosMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const campaignId = campaignVideosMatch[1];
      const [campaignRows] = await pool.query(
        `SELECT id, project_id, name FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1`,
        [campaignId, user.id],
      );
      const campaign = campaignRows[0];
      if (!campaign) {
        sendJson(req, res, 404, { error: 'Campaign not found' });
        return;
      }
      const videos = await listVideosForProject(campaign.project_id, user.id, {
        video_type: url.searchParams.get('video_type') || '',
        search: url.searchParams.get('search') || '',
        session_id: url.searchParams.get('session_id') || '',
        usage: url.searchParams.get('usage') || '',
      });
      sendJson(req, res, 200, { data: videos, campaign });
      return;
    }

    const campaignAudiencesMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/audiences$/);
    if (campaignAudiencesMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const campaignId = campaignAudiencesMatch[1];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign) {
        sendJson(req, res, 404, { error: 'Campaign not found' });
        return;
      }
      const [rows] = await pool.query(
        'SELECT * FROM audiences WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC',
        [user.id, campaignId],
      );
      sendJson(req, res, 200, { data: rows, campaign });
      return;
    }

    const projectVideosMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/videos$/);
    if (projectVideosMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = projectVideosMatch[1];
      const [projectRows] = await pool.query('SELECT id, name FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
      const project = projectRows[0];
      if (!project) {
        sendJson(req, res, 404, { error: 'Project not found' });
        return;
      }
      const videos = await listVideosForProject(projectId, user.id, {
        video_type: url.searchParams.get('video_type') || '',
        search: url.searchParams.get('search') || '',
        session_id: url.searchParams.get('session_id') || '',
        usage: url.searchParams.get('usage') || '',
      });
      sendJson(req, res, 200, { data: videos, project });
      return;
    }

    if (projectVideosMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = projectVideosMatch[1];
      const [projectRows] = await pool.query('SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
      if (!projectRows.length) {
        sendJson(req, res, 404, { error: 'Project not found' });
        return;
      }

      const body = await readBody(req);
      const forbidden = Object.keys(body || {}).filter((field) => videoGlobalForbiddenFields.has(field));
      if (forbidden.length) {
        sendJson(req, res, 400, { error: 'Global video payload contains forbidden fields', code: 'VIDEO_GLOBAL_FORBIDDEN_FIELDS', fields: forbidden });
        return;
      }
      const payload = {
        ...body,
        project_id: projectId,
      };

      const rows = await executeCrudQuery({ table: 'videos', operation: 'insert', payload }, user.id);
      sendJson(req, res, 200, { data: rows });
      return;
    }

    const videoLinkHypothesesMatch = url.pathname.match(/^\/api\/videos\/([^/]+)\/link-hypotheses$/);
    if (videoLinkHypothesesMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const videoId = videoLinkHypothesesMatch[1];
      const body = await readBody(req);
      const targetIds = Array.isArray(body?.hypothesis_ids) ? body.hypothesis_ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
      if (!targetIds.length) {
        sendJson(req, res, 400, { error: 'hypothesis_ids is required' });
        return;
      }
      const [videoRows] = await pool.query('SELECT id, campaign_id, project_id, title, video_id FROM videos WHERE id = ? AND user_id = ? LIMIT 1', [videoId, user.id]);
      const video = videoRows[0];
      if (!video) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }

      const placeholders = targetIds.map(() => '?').join(', ');
      const [hypothesisRows] = await pool.query(
        `SELECT h.id, h.campaign_id, h.audience_id, c.project_id
         FROM hypotheses h
         JOIN campaigns c ON c.id = h.campaign_id
         WHERE h.user_id = ? AND h.id IN (${placeholders})`,
        [user.id, ...targetIds],
      );
      const byId = new Map(hypothesisRows.map((row) => [String(row.id), row]));
      const linked = [];
      const already_linked = [];
      const skipped = [];

      for (const hypId of targetIds) {
        const hyp = byId.get(String(hypId));
        if (!hyp) {
          skipped.push({ hypothesis_id: hypId, reason: 'not_found' });
          continue;
        }
        if (video.project_id && String(hyp.project_id) !== String(video.project_id)) {
          skipped.push({ hypothesis_id: hypId, reason: 'different_project' });
          continue;
        }
        const [exists] = await pool.query('SELECT id FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1', [hyp.id, video.id, user.id]);
        if (exists.length) {
          already_linked.push(hyp.id);
          continue;
        }
        const contextAudienceId = hyp.audience_id || null;
        await pool.query('INSERT INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)', [uuid(), hyp.id, video.id, contextAudienceId, user.id]);
        await linkVideoFolderIntoHypothesis(user.id, hyp.campaign_id, hyp.id, video);
        await linkVideoFolderIntoAudience(user.id, hyp.campaign_id, contextAudienceId, video);
        linked.push(hyp.id);
      }
      await syncCloudForUser(user.id);
      sendJson(req, res, 200, { ok: true, linked, already_linked, skipped });
      return;
    }


    const resetHypothesisVideoLinksMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/hypothesis-video-links\/reset$/);
    if (resetHypothesisVideoLinksMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = resetHypothesisVideoLinksMatch[1];
      const [projectRows] = await pool.query('SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, user.id]);
      if (!projectRows.length) {
        sendJson(req, res, 404, { error: 'Project not found' });
        return;
      }

      try {
        const summary = await cleanupHypothesisVideoLinks(projectId, user.id);
        sendJson(req, res, 200, { ok: true, project_id: projectId, ...summary });
      } catch (error) {
        sendJson(req, res, 500, { error: error?.message || String(error) });
      }
      return;
    }

    const projectHypothesesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/hypotheses$/);
    if (projectHypothesesMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const projectId = projectHypothesesMatch[1];
      const [rows] = await pool.query(
        `SELECT h.*
         FROM hypotheses h
         JOIN campaigns c ON c.id = h.campaign_id
         JOIN projects p ON p.id = c.project_id
         WHERE p.id = ? AND h.user_id = ? AND c.user_id = ? AND p.user_id = ?
         ORDER BY h.created_at DESC`,
        [projectId, user.id, user.id, user.id],
      );
      sendJson(req, res, 200, { data: rows });
      return;
    }

    const campaignInterviewsClientsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/interviews\/clients$/);
    if (campaignInterviewsClientsMatch && (req.method === 'GET' || req.method === 'POST')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const [projectId, campaignId] = [campaignInterviewsClientsMatch[1], campaignInterviewsClientsMatch[2]];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign || String(campaign.project_id) !== String(projectId)) return sendJson(req, res, 404, { error: 'Campaign not found' });

      if (req.method === 'GET') {
        const audienceId = String(url.searchParams.get('audience_id') || '').trim();
        const params = [user.id, projectId, campaignId];
        const whereAudience = audienceId ? 'AND c.audience_id = ?' : '';
        if (audienceId) params.push(audienceId);
        const [rows] = await pool.query(
          `SELECT c.*, a.name AS audience_name,
             (SELECT COUNT(*) FROM interview_sessions s WHERE s.client_id = c.id AND s.user_id = c.user_id) AS interviews_count
           FROM interview_clients c
           LEFT JOIN audiences a ON a.id = c.audience_id
           WHERE c.user_id = ? AND c.project_id = ? AND c.campaign_id = ? ${whereAudience}
           ORDER BY c.created_at DESC`,
          params,
        );
        return sendJson(req, res, 200, { data: rows });
      }

      const body = await readBody(req);
      const now = nowIso();
      await pool.query(
        `INSERT INTO interview_clients (id, project_id, campaign_id, audience_id, user_id, name, contact, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), projectId, campaignId, body.audience_id || null, user.id, body.name || 'Cliente', body.contact || null, body.notes || null, now, now],
      );
      const [rows] = await pool.query('SELECT * FROM interview_clients WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [user.id, campaignId]);
      return sendJson(req, res, 200, { data: rows[0] || null });
    }

    const interviewClientMatch = url.pathname.match(/^\/api\/interview-clients\/([^/]+)$/);
    if (interviewClientMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const id = interviewClientMatch[1];
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM interview_clients WHERE id = ? AND user_id = ?', [id, user.id]);
        return sendJson(req, res, 200, { ok: true });
      }
      const body = await readBody(req);
      await pool.query(
        'UPDATE interview_clients SET name = ?, contact = ?, notes = ?, audience_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [body.name || 'Cliente', body.contact || null, body.notes || null, body.audience_id || null, nowIso(), id, user.id],
      );
      const [rows] = await pool.query('SELECT * FROM interview_clients WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      return sendJson(req, res, 200, { data: rows[0] || null });
    }

    const campaignInterviewsHypothesesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/interviews\/hypotheses$/);
    if (campaignInterviewsHypothesesMatch && (req.method === 'GET' || req.method === 'POST')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const [projectId, campaignId] = [campaignInterviewsHypothesesMatch[1], campaignInterviewsHypothesesMatch[2]];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign || String(campaign.project_id) !== String(projectId)) return sendJson(req, res, 404, { error: 'Campaign not found' });
      if (req.method === 'GET') {
        const [rows] = await pool.query('SELECT ih.*, a.name AS audience_name FROM interview_hypotheses ih LEFT JOIN audiences a ON a.id = ih.audience_id WHERE ih.user_id = ? AND ih.project_id = ? AND ih.campaign_id = ? ORDER BY ih.created_at DESC', [user.id, projectId, campaignId]);
        return sendJson(req, res, 200, { data: rows });
      }
      const body = await readBody(req);
      const now = nowIso();
      await pool.query(
        `INSERT INTO interview_hypotheses (id, project_id, campaign_id, audience_id, user_id, type, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), projectId, campaignId, body.audience_id || null, user.id, body.type || 'exploratoria', body.title || 'Hipótesis entrevistas', body.description || null, body.status || 'active', now, now],
      );
      const [rows] = await pool.query('SELECT * FROM interview_hypotheses WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [user.id, campaignId]);
      return sendJson(req, res, 200, { data: rows[0] || null });
    }

    const interviewHypothesisMatch = url.pathname.match(/^\/api\/interview-hypotheses\/([^/]+)$/);
    if (interviewHypothesisMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const id = interviewHypothesisMatch[1];
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM interview_hypotheses WHERE id = ? AND user_id = ?', [id, user.id]);
        return sendJson(req, res, 200, { ok: true });
      }
      const body = await readBody(req);
      await pool.query(
        'UPDATE interview_hypotheses SET type = ?, title = ?, description = ?, status = ?, audience_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [body.type || 'exploratoria', body.title || 'Hipótesis entrevistas', body.description || null, body.status || 'active', body.audience_id || null, nowIso(), id, user.id],
      );
      const [rows] = await pool.query('SELECT * FROM interview_hypotheses WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      return sendJson(req, res, 200, { data: rows[0] || null });
    }

    const campaignInterviewsFormsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/interviews\/forms$/);
    if (campaignInterviewsFormsMatch && (req.method === 'GET' || req.method === 'POST')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const [projectId, campaignId] = [campaignInterviewsFormsMatch[1], campaignInterviewsFormsMatch[2]];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign || String(campaign.project_id) !== String(projectId)) return sendJson(req, res, 404, { error: 'Campaign not found' });
      if (req.method === 'GET') {
        const [rows] = await pool.query('SELECT * FROM interview_forms WHERE user_id = ? AND project_id = ? AND campaign_id = ? ORDER BY created_at DESC', [user.id, projectId, campaignId]);
        return sendJson(req, res, 200, { data: rows.map((r) => ({ ...r, questions_json: safeParseJsonField(r.questions_json, []) })) });
      }
      const body = await readBody(req);
      const questions = Array.isArray(body.questions) ? body.questions : [];
      const now = nowIso();
      await pool.query(
        `INSERT INTO interview_forms (id, project_id, campaign_id, user_id, title, description, questions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), projectId, campaignId, user.id, body.title || 'Formulario', body.description || null, JSON.stringify(questions), now, now],
      );
      const [rows] = await pool.query('SELECT * FROM interview_forms WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [user.id, campaignId]);
      return sendJson(req, res, 200, { data: { ...rows[0], questions_json: safeParseJsonField(rows[0]?.questions_json, []) } });
    }

    const interviewFormMatch = url.pathname.match(/^\/api\/interview-forms\/([^/]+)$/);
    if (interviewFormMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const id = interviewFormMatch[1];
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM interview_forms WHERE id = ? AND user_id = ?', [id, user.id]);
        return sendJson(req, res, 200, { ok: true });
      }
      const body = await readBody(req);
      await pool.query(
        'UPDATE interview_forms SET title = ?, description = ?, questions_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [body.title || 'Formulario', body.description || null, JSON.stringify(Array.isArray(body.questions) ? body.questions : []), nowIso(), id, user.id],
      );
      const [rows] = await pool.query('SELECT * FROM interview_forms WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      return sendJson(req, res, 200, { data: { ...rows[0], questions_json: safeParseJsonField(rows[0]?.questions_json, []) } });
    }

    const campaignInterviewsSessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/interviews\/sessions$/);
    if (campaignInterviewsSessionsMatch && (req.method === 'GET' || req.method === 'POST')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const [projectId, campaignId] = [campaignInterviewsSessionsMatch[1], campaignInterviewsSessionsMatch[2]];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign || String(campaign.project_id) !== String(projectId)) return sendJson(req, res, 404, { error: 'Campaign not found' });
      if (req.method === 'GET') {
        const [rows] = await pool.query(
          `SELECT s.*, c.name AS client_name, a.name AS audience_name, f.title AS form_title, h.title AS hypothesis_title
           FROM interview_sessions s
           LEFT JOIN interview_clients c ON c.id = s.client_id
           LEFT JOIN audiences a ON a.id = s.audience_id
           LEFT JOIN interview_forms f ON f.id = s.form_id
           LEFT JOIN interview_hypotheses h ON h.id = s.interview_hypothesis_id
           WHERE s.user_id = ? AND s.project_id = ? AND s.campaign_id = ?
           ORDER BY COALESCE(s.completed_at, s.conducted_at, s.created_at) DESC`,
          [user.id, projectId, campaignId],
        );
        return sendJson(req, res, 200, {
          data: rows.map((r) => ({
            ...r,
            responses_json: safeParseJsonField(r.responses_json, {}),
            form_snapshot_json: safeParseJsonField(r.form_snapshot_json, null),
          })),
        });
      }
      const body = await readBody(req);
      const [clientRows] = await pool.query('SELECT id, audience_id FROM interview_clients WHERE id = ? AND user_id = ? LIMIT 1', [body.client_id, user.id]);
      const client = clientRows[0];
      if (!client) return sendJson(req, res, 400, { error: 'Client not found' });
      const [formRows] = await pool.query('SELECT * FROM interview_forms WHERE id = ? AND user_id = ? LIMIT 1', [body.form_id, user.id]);
      const form = formRows[0];
      if (!form) return sendJson(req, res, 400, { error: 'Form not found' });
      const snapshot = buildInterviewFormSnapshot(form);
      const responses = body.responses && typeof body.responses === 'object' ? body.responses : {};
      const status = body.status === 'completed' ? 'completed' : 'draft';
      const missingRequired = validateInterviewAnswers(snapshot, responses);
      if (status === 'completed' && missingRequired.length) {
        return sendJson(req, res, 400, { error: `Missing required responses: ${missingRequired.join(', ')}` });
      }
      const now = nowIso();
      await pool.query(
        `INSERT INTO interview_sessions (id, project_id, campaign_id, user_id, client_id, audience_id, form_id, interview_hypothesis_id, conducted_at, notes, status, completed_at, responses_json, form_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), projectId, campaignId, user.id, body.client_id, body.audience_id || client.audience_id || null, body.form_id, body.interview_hypothesis_id || null, body.conducted_at || now, body.notes || null, status, status === 'completed' ? now : null, JSON.stringify(responses), JSON.stringify(snapshot), now, now],
      );
      const [rows] = await pool.query('SELECT * FROM interview_sessions WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [user.id, campaignId]);
      return sendJson(req, res, 200, { data: { ...rows[0], responses_json: safeParseJsonField(rows[0]?.responses_json, {}), form_snapshot_json: safeParseJsonField(rows[0]?.form_snapshot_json, null) } });
    }


    const campaignInterviewsCloudMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/interviews\/cloud$/);
    if (campaignInterviewsCloudMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const [projectId, campaignId] = [campaignInterviewsCloudMatch[1], campaignInterviewsCloudMatch[2]];
      const campaign = await fetchOwnedCampaignById(campaignId, user.id);
      if (!campaign || String(campaign.project_id) !== String(projectId)) return sendJson(req, res, 404, { error: 'Campaign not found' });

      const folders = await ensureInterviewCloudFolders(user.id, projectId, campaignId);
      if (!folders) return sendJson(req, res, 404, { error: 'Interview cloud unavailable' });

      const [audiences] = await pool.query(
        `SELECT a.id, a.name,
                COUNT(DISTINCT s.id) AS interviews_count
         FROM audiences a
         LEFT JOIN interview_sessions s ON s.audience_id = a.id AND s.user_id = ? AND s.project_id = ? AND s.campaign_id = ?
         WHERE a.user_id = ? AND a.campaign_id = ?
         GROUP BY a.id, a.name
         ORDER BY a.name COLLATE NOCASE ASC`,
        [user.id, projectId, campaignId, user.id, campaignId],
      );

      const [interviews] = await pool.query(
        `SELECT s.id, s.status, s.created_at, s.updated_at, s.completed_at,
                c.name AS client_name, c.contact AS client_contact,
                a.id AS audience_id, a.name AS audience_name,
                n.id AS cloud_node_id
         FROM interview_sessions s
         LEFT JOIN interview_clients c ON c.id = s.client_id
         LEFT JOIN audiences a ON a.id = s.audience_id
         LEFT JOIN cloud_nodes n ON n.user_id = s.user_id AND n.project_id = s.project_id AND n.canonical_key = ('interviews_cloud_session:' || s.campaign_id || ':' || s.id)
         WHERE s.user_id = ? AND s.project_id = ? AND s.campaign_id = ?
         ORDER BY COALESCE(s.completed_at, s.updated_at, s.created_at) DESC`,
        [user.id, projectId, campaignId],
      );

      const [hypotheses] = await pool.query(
        `SELECT h.id, h.title, h.type, h.status, h.audience_id, a.name AS audience_name,
                n.id AS cloud_node_id
         FROM interview_hypotheses h
         LEFT JOIN audiences a ON a.id = h.audience_id
         LEFT JOIN cloud_nodes n ON n.user_id = h.user_id AND n.project_id = h.project_id AND n.canonical_key = ('interviews_cloud_hypothesis:' || h.campaign_id || ':' || h.id)
         WHERE h.user_id = ? AND h.project_id = ? AND h.campaign_id = ?
         ORDER BY h.created_at DESC`,
        [user.id, projectId, campaignId],
      );

      sendJson(req, res, 200, {
        data: {
          roots: folders,
          audiences,
          interviews,
          hypotheses,
        },
      });
      return;
    }

    const interviewSessionMatch = url.pathname.match(/^\/api\/interview-sessions\/([^/]+)$/);
    if (interviewSessionMatch && (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE')) {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const id = interviewSessionMatch[1];
      if (req.method === 'GET') {
        const [rows] = await pool.query(
          `SELECT s.*, c.name AS client_name, a.name AS audience_name, f.title AS form_title, h.title AS hypothesis_title
           FROM interview_sessions s
           LEFT JOIN interview_clients c ON c.id = s.client_id
           LEFT JOIN audiences a ON a.id = s.audience_id
           LEFT JOIN interview_forms f ON f.id = s.form_id
           LEFT JOIN interview_hypotheses h ON h.id = s.interview_hypothesis_id
           WHERE s.id = ? AND s.user_id = ? LIMIT 1`,
          [id, user.id],
        );
        if (!rows.length) return sendJson(req, res, 404, { error: 'Session not found' });
        return sendJson(req, res, 200, { data: { ...rows[0], responses_json: safeParseJsonField(rows[0]?.responses_json, {}), form_snapshot_json: safeParseJsonField(rows[0]?.form_snapshot_json, null) } });
      }
      if (req.method === 'DELETE') {
        await pool.query('DELETE FROM interview_sessions WHERE id = ? AND user_id = ?', [id, user.id]);
        return sendJson(req, res, 200, { ok: true });
      }
      const body = await readBody(req);
      const [existingRows] = await pool.query('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      const existing = existingRows[0];
      if (!existing) return sendJson(req, res, 404, { error: 'Session not found' });

      const responses = body.responses && typeof body.responses === 'object' ? body.responses : safeParseJsonField(existing.responses_json, {});
      let snapshot = safeParseJsonField(existing.form_snapshot_json, null);
      if (!snapshot) {
        const [formRows] = await pool.query('SELECT * FROM interview_forms WHERE id = ? AND user_id = ? LIMIT 1', [existing.form_id, user.id]);
        snapshot = buildInterviewFormSnapshot(formRows[0] || {});
      }
      const status = body.status === 'completed' ? 'completed' : (body.status === 'draft' ? 'draft' : (existing.status || 'draft'));
      const missingRequired = validateInterviewAnswers(snapshot, responses);
      if (status === 'completed' && missingRequired.length) {
        return sendJson(req, res, 400, { error: `Missing required responses: ${missingRequired.join(', ')}` });
      }
      const completedAt = status === 'completed' ? (existing.completed_at || nowIso()) : null;
      await pool.query(
        'UPDATE interview_sessions SET conducted_at = ?, notes = ?, responses_json = ?, interview_hypothesis_id = ?, audience_id = ?, status = ?, completed_at = ?, form_snapshot_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [body.conducted_at || existing.conducted_at || nowIso(), body.notes ?? existing.notes ?? null, JSON.stringify(responses), body.interview_hypothesis_id ?? existing.interview_hypothesis_id ?? null, body.audience_id ?? existing.audience_id ?? null, status, completedAt, JSON.stringify(snapshot), nowIso(), id, user.id],
      );
      const [rows] = await pool.query('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      return sendJson(req, res, 200, { data: { ...rows[0], responses_json: safeParseJsonField(rows[0]?.responses_json, {}), form_snapshot_json: safeParseJsonField(rows[0]?.form_snapshot_json, null) } });
    }


    if (url.pathname === '/api/hypothesis_videos' && (req.method === 'POST' || req.method === 'PUT')) {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      const hypothesisId = String(body?.hypothesis_id || '').trim();
      const videoId = String(body?.video_id || '').trim();
      if (!hypothesisId || !videoId) {
        sendJson(req, res, 400, { error: 'hypothesis_id and video_id are required' });
        return;
      }

      const invalid = Object.keys(body || {}).filter((key) => !new Set(['hypothesis_id', 'video_id', 'audience_id']).has(key));
      if (invalid.length) {
        sendJson(req, res, 400, {
          error: 'No se permite actualizar métricas ni campos globales desde hipótesis',
          code: 'HYPOTHESIS_CONTEXT_FORBIDDEN_FIELDS',
          fields: invalid,
        });
        return;
      }

      const hypothesis = await fetchOwnedHypothesisById(hypothesisId, user.id);
      if (!hypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }
      const video = await fetchOwnedVideoById(videoId, user.id);
      if (!video) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }

      const contextAudienceId = hypothesis?.audience_id || body?.audience_id || null;
      const [prevRows] = await pool.query(
        'SELECT audience_id FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1',
        [hypothesisId, videoId, user.id],
      );
      const previousAudienceId = prevRows[0]?.audience_id || null;
      await pool.query(
        'INSERT OR IGNORE INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)',
        [uuid(), hypothesisId, videoId, contextAudienceId, user.id],
      );
      await pool.query(
        'UPDATE hypothesis_videos SET audience_id = ? WHERE hypothesis_id = ? AND video_id = ? AND user_id = ?',
        [contextAudienceId, hypothesisId, videoId, user.id],
      );
      await linkVideoFolderIntoHypothesis(user.id, hypothesis.campaign_id, hypothesisId, video);
      await linkVideoFolderIntoAudience(user.id, hypothesis.campaign_id, contextAudienceId, video);
      if (previousAudienceId && String(previousAudienceId) !== String(contextAudienceId || '')) {
        await unlinkVideoFolderFromAudience(user.id, hypothesis.campaign_id, previousAudienceId, video);
      }

      const [rows] = await pool.query(
        'SELECT * FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1',
        [hypothesisId, videoId, user.id],
      );
      sendJson(req, res, 200, { data: rows[0] || null });
      return;
    }

    const hypothesisVideosMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/videos$/);
    if (hypothesisVideosMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const hypothesisId = hypothesisVideosMatch[1];
      const hypothesis = await fetchOwnedHypothesisById(hypothesisId, user.id);
      if (!hypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }
      const videoType = url.searchParams.get('video_type') || '';
      const videos = await listVideosForHypothesis(hypothesisId, user.id, { video_type: videoType });
      sendJson(req, res, 200, { data: videos });
      return;
    }

    const hypothesisVideoContextMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/videos\/([^/]+)$/);
    if (hypothesisVideoContextMatch && req.method === 'PATCH') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const [targetHypothesisId, targetVideoId] = [hypothesisVideoContextMatch[1], hypothesisVideoContextMatch[2]];
      const hypothesis = await fetchOwnedHypothesisById(targetHypothesisId, user.id);
      if (!hypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }
      const video = await fetchOwnedVideoById(targetVideoId, user.id);
      if (!video) {
        sendJson(req, res, 404, { error: 'Video not found' });
        return;
      }

      const body = await readBody(req);
      const contextAudienceId = hypothesis?.audience_id || body?.audience_id || null;
      const [prevRows] = await pool.query('SELECT audience_id FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1', [targetHypothesisId, targetVideoId, user.id]);
      const previousAudienceId = prevRows[0]?.audience_id || null;
      await pool.query('INSERT OR IGNORE INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)', [uuid(), targetHypothesisId, targetVideoId, contextAudienceId, user.id]);
      await linkVideoFolderIntoHypothesis(user.id, hypothesis.campaign_id, targetHypothesisId, video);
      await linkVideoFolderIntoAudience(user.id, hypothesis.campaign_id, contextAudienceId, video);

      const keys = Object.keys(body || {});
      const invalid = keys.filter((key) => !hypothesisContextOnlyFields.has(key));
      if (invalid.length) {
        sendJson(req, res, 400, {
          error: 'No se permite actualizar métricas ni campos globales desde hipótesis',
          code: 'HYPOTHESIS_CONTEXT_FORBIDDEN_FIELDS',
          fields: invalid,
        });
        return;
      }
      await pool.query(
        'UPDATE hypothesis_videos SET audience_id = ? WHERE hypothesis_id = ? AND video_id = ? AND user_id = ?',
        [contextAudienceId, targetHypothesisId, targetVideoId, user.id],
      );
      if (previousAudienceId && String(previousAudienceId) !== String(contextAudienceId || '')) {
        await unlinkVideoFolderFromAudience(user.id, hypothesis.campaign_id, previousAudienceId, video);
      }

      const videos = await listVideosForHypothesis(targetHypothesisId, user.id, {});
      const updated = videos.find((row) => String(row.id) === String(targetVideoId)) || null;
      sendJson(req, res, 200, { video: updated });
      return;
    }

    const linkVideosMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/videos\/link$/);
    if (linkVideosMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const targetHypothesisId = linkVideosMatch[1];
      const targetHypothesis = await fetchOwnedHypothesisById(targetHypothesisId, user.id);
      if (!targetHypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }

      const body = await readBody(req);
      const requestedVideoIds = Array.isArray(body?.video_ids) ? body.video_ids.map((v) => String(v || '').trim()).filter(Boolean) : [];
      if (!requestedVideoIds.length) {
        sendJson(req, res, 400, { error: 'video_ids is required' });
        return;
      }
      if (requestedVideoIds.length > 2) {
        sendJson(req, res, 400, { error: 'Up to 2 videos can be linked per request' });
        return;
      }

      const placeholders = requestedVideoIds.map(() => '?').join(', ');
      const [candidateVideos] = await pool.query(
        `SELECT v.id, v.title, v.video_id, COALESCE(v.project_id, c.project_id) AS project_id
         FROM videos v
         LEFT JOIN campaigns c ON c.id = v.campaign_id
         WHERE v.user_id = ? AND v.id IN (${placeholders})`,
        [user.id, ...requestedVideoIds],
      );

      const byId = new Map(candidateVideos.map((row) => [String(row.id), row]));
      const linked = [];
      const alreadyLinked = [];
      const skipped = [];

      for (const videoId of requestedVideoIds) {
        const video = byId.get(String(videoId));
        if (!video) {
          skipped.push({ video_id: videoId, reason: 'not_found' });
          continue;
        }
        if (String(video.project_id) !== String(targetHypothesis.project_id)) {
          skipped.push({ video_id: videoId, reason: 'different_project' });
          continue;
        }

        const [existingLinks] = await pool.query(
          'SELECT id FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1',
          [targetHypothesisId, video.id, user.id],
        );
        if (existingLinks.length) {
          alreadyLinked.push(video.id);
          continue;
        }

        const contextAudienceId = targetHypothesis.audience_id || null;
        await pool.query(
          'INSERT INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)',
          [uuid(), targetHypothesisId, video.id, contextAudienceId, user.id],
        );
        await linkVideoFolderIntoHypothesis(user.id, targetHypothesis.campaign_id, targetHypothesisId, video);
        await linkVideoFolderIntoAudience(user.id, targetHypothesis.campaign_id, contextAudienceId, video);
        linked.push(video.id);
      }

      await syncCloudForUser(user.id);
      sendJson(req, res, 200, {
        ok: true,
        linked,
        already_linked: alreadyLinked,
        skipped,
      });
      return;
    }

    const unlinkVideosMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/videos\/unlink$/);
    if (unlinkVideosMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const targetHypothesisId = unlinkVideosMatch[1];
      const targetHypothesis = await fetchOwnedHypothesisById(targetHypothesisId, user.id);
      if (!targetHypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }

      const body = await readBody(req);
      const requestedVideoIds = Array.isArray(body?.video_ids) ? body.video_ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
      if (!requestedVideoIds.length) {
        sendJson(req, res, 400, { error: 'video_ids is required' });
        return;
      }

      const placeholders = requestedVideoIds.map(() => '?').join(', ');
      const [videosRows] = await pool.query(
        `SELECT id, campaign_id, title, video_id
         FROM videos
         WHERE user_id = ? AND id IN (${placeholders})`,
        [user.id, ...requestedVideoIds],
      );
      const byId = new Map(videosRows.map((row) => [String(row.id), row]));
      const unlinked = [];
      const skipped = [];

      for (const requestedId of requestedVideoIds) {
        const video = byId.get(String(requestedId));
        if (!video) {
          skipped.push({ video_id: requestedId, reason: 'not_found' });
          continue;
        }
        const [hvRows] = await pool.query('SELECT audience_id FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ? LIMIT 1', [targetHypothesisId, video.id, user.id]);
        const linkedAudienceId = hvRows[0]?.audience_id || null;
        await pool.query('DELETE FROM hypothesis_videos WHERE hypothesis_id = ? AND video_id = ? AND user_id = ?', [targetHypothesisId, video.id, user.id]);
        await unlinkVideoFolderFromHypothesis(user.id, targetHypothesis.campaign_id, targetHypothesisId, video);
        await unlinkVideoFolderFromAudience(user.id, targetHypothesis.campaign_id, linkedAudienceId, video);
        unlinked.push(video.id);
      }

      sendJson(req, res, 200, { ok: true, unlinked, skipped });
      return;
    }

    const moveHypothesisMatch = url.pathname.match(/^\/api\/hypotheses\/([^/]+)\/move$/);
    if (moveHypothesisMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }

      const hypothesisId = moveHypothesisMatch[1];
      const hypothesis = await fetchOwnedHypothesisById(hypothesisId, user.id);
      if (!hypothesis) {
        sendJson(req, res, 404, { error: 'Hypothesis not found' });
        return;
      }

      const body = await readBody(req);
      const targetProjectId = String(body?.target_project_id || '').trim();
      const targetCampaignId = String(body?.target_campaign_id || '').trim();
      const options = {
        move_videos: body?.options?.move_videos !== false,
        no_move_shared_videos: body?.options?.no_move_shared_videos !== false,
      };
      const dryRun = Boolean(body?.dry_run);

      if (!targetProjectId || !targetCampaignId) {
        sendJson(req, res, 400, { error: 'target_project_id and target_campaign_id are required' });
        return;
      }

      const [targetCampaignRows] = await pool.query(
        `SELECT c.id, c.project_id
         FROM campaigns c
         JOIN projects p ON p.id = c.project_id
         WHERE c.id = ? AND c.project_id = ? AND c.user_id = ? AND p.user_id = ?
         LIMIT 1`,
        [targetCampaignId, targetProjectId, user.id, user.id],
      );
      const targetCampaign = targetCampaignRows[0];
      if (!targetCampaign) {
        sendJson(req, res, 404, { error: 'Target campaign/project not found' });
        return;
      }

      const sourceCampaignId = String(hypothesis.campaign_id);
      const sourceProjectId = String(hypothesis.project_id);
      const linkedVideos = await listVideosLinkedToHypothesis(hypothesisId, user.id);

      const videosToMove = [];
      const sharedVideos = [];
      for (const video of linkedVideos) {
        if (!options.move_videos) continue;
        if (String(video.campaign_id || '') !== sourceCampaignId) continue;
        const otherUsage = await countOtherUsageInCampaign(video.id, sourceCampaignId, hypothesisId, user.id);
        if (otherUsage > 0 && options.no_move_shared_videos) {
          sharedVideos.push({ video_id: video.id, title: video.title || null, shared_usage_count: otherUsage });
          continue;
        }
        videosToMove.push(video);
      }

      const summary = {
        source_project_id: sourceProjectId,
        source_campaign_id: sourceCampaignId,
        target_project_id: targetProjectId,
        target_campaign_id: targetCampaignId,
        linked_videos_count: linkedVideos.length,
        move_videos: options.move_videos,
        no_move_shared_videos: options.no_move_shared_videos,
        will_move_videos_count: videosToMove.length,
        skipped_shared_videos_count: sharedVideos.length,
        shared_videos: sharedVideos,
      };

      if (dryRun) {
        sendJson(req, res, 200, { ok: true, dry_run: true, moved_hypothesis_id: hypothesisId, ...summary });
        return;
      }

      await pool.query('BEGIN IMMEDIATE');
      try {
        await pool.query(
          'UPDATE hypotheses SET campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [targetCampaignId, hypothesisId, user.id],
        );

        for (const video of videosToMove) {
          await pool.query(
            'UPDATE videos SET campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
            [targetCampaignId, video.id, user.id],
          );
        }

        if (body?.options?.force_fail_for_test) {
          throw new Error('forced_failure_for_test');
        }

        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }

      for (const video of videosToMove) {
        await ensureVideoCanonicalFolder(user.id, { ...video, campaign_id: targetCampaignId }, targetCampaignId);
      }
      await syncCloudForUser(user.id);

      sendJson(req, res, 200, {
        ok: true,
        moved_hypothesis_id: hypothesisId,
        moved_videos_count: videosToMove.length,
        skipped_shared_videos_count: sharedVideos.length,
        ...summary,
      });
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
      const breakdownConfig = {
        primary_metric: url.searchParams.get('primary_metric') || (url.searchParams.get('metric') || 'ctr'),
        threshold_operator: url.searchParams.get('threshold_operator') || '>=',
        threshold_value: Number(url.searchParams.get('threshold_value') || 0),
      };

      const { hypothesis, videos } = await loadHypothesisAnalysisContext(hypothesisId, user.id, config);
      const volume = buildVolumeSnapshot(hypothesis, videos);
      const audienceBreakdown = await buildHypothesisAudienceBreakdown({
        videos,
        userId: user.id,
        metric: breakdownConfig.primary_metric,
        operator: breakdownConfig.threshold_operator,
        threshold: Number.isFinite(breakdownConfig.threshold_value) ? breakdownConfig.threshold_value : 0,
      });
      const [runs] = await pool.query(
        'SELECT id, hypothesis_id, created_at, config_json, results_json, dataset_hash FROM hypothesis_analysis_runs WHERE hypothesis_id = ? ORDER BY created_at DESC LIMIT 15',
        [hypothesisId],
      );
      sendJson(req, res, 200, { hypothesis, videos, runs, volume, audience_breakdown: audienceBreakdown, breakdown_config: breakdownConfig });
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

      const where = ['hv.user_id = ?', 'hv.audience_id = ?', 'h.campaign_id = ?'];
      const values = [user.id, audienceId, audience.campaign_id];
      if (selectedType !== 'all') {
        where.push('v.video_type = ?');
        values.push(selectedType);
      }
      const [videos] = await pool.query(
        `SELECT v.*, hv.audience_id, hv.hypothesis_id, MAX(hv.created_at) AS linked_at
         FROM hypothesis_videos hv
         JOIN videos v ON v.id = hv.video_id AND v.user_id = hv.user_id
         JOIN hypotheses h ON h.id = hv.hypothesis_id AND h.user_id = hv.user_id
         WHERE ${where.join(' AND ')}
         GROUP BY v.id, hv.audience_id, hv.hypothesis_id
         ORDER BY linked_at DESC, v.created_at DESC`,
        values,
      );
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
