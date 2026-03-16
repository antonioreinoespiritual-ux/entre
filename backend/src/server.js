import process from 'node:process';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createPool, validateDbEnv } from './config/db.js';
import { loadBackendEnv } from './config/env.js';
import { getYouTubeConfig, isYouTubeApiKeyConfigured, isYouTubeOAuthConfigured } from './youtube/config.js';
import { buildYouTubeConsentUrl, exchangeYouTubeCodeForTokens, refreshYouTubeAccessToken, revokeYouTubeToken } from './youtube/auth.js';
import { listYouTubeChannels, listYouTubeVideos, listYouTubePlaylists, listYouTubeCommentThreads, listYouTubeComments, searchYouTubeVideos } from './youtube/services.js';


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
  `CREATE TABLE IF NOT EXISTS youtube_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    youtube_channel_id TEXT,
    youtube_channel_title TEXT,
    access_token TEXT,
    refresh_token TEXT,
    scope TEXT,
    token_type TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_youtube_connections_user ON youtube_connections(user_id)',
  `CREATE TABLE IF NOT EXISTS youtube_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    api_key TEXT,
    client_id TEXT,
    client_secret TEXT,
    redirect_uri TEXT,
    scopes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_youtube_integrations_user ON youtube_integrations(user_id)',
  `CREATE TABLE IF NOT EXISTS ai_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    provider TEXT,
    model TEXT,
    api_key TEXT,
    base_url TEXT,
    organization TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_integrations_user ON ai_integrations(user_id)',
  `CREATE TABLE IF NOT EXISTS ai_project_chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_project_chat_messages_scope ON ai_project_chat_messages(user_id, project_id, created_at)',
  `CREATE TABLE IF NOT EXISTS openclaw_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    endpoint_url TEXT,
    workspace_id TEXT,
    api_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_openclaw_integrations_user ON openclaw_integrations(user_id)',
  `CREATE TABLE IF NOT EXISTS youtube_oauth_states (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    state_token TEXT NOT NULL UNIQUE,
    redirect_path TEXT,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_youtube_oauth_states_user ON youtube_oauth_states(user_id)',
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
    campaign_id TEXT,
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
    segment TEXT,
    related_client_id TEXT,
    interview_form_id TEXT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    last_evaluated_at TEXT,
    min_interviews INTEGER,
    validation_metric_config TEXT,
    evaluated_interviews_count INTEGER,
    problem_score_avg REAL,
    solution_score_avg REAL,
    problem_intensity_avg REAL,
    problem_frequency_avg REAL,
    problem_urgency_avg REAL,
    problem_attempts_avg REAL,
    problem_spend_avg REAL,
    problem_clarity_avg REAL,
    segment_fit_avg REAL,
    emotional_language_avg REAL,
    solution_interest_avg REAL,
    solution_clarity_avg REAL,
    solution_value_avg REAL,
    solution_recurrence_avg REAL,
    solution_payment_avg REAL,
    criteria_passed_count INTEGER,
    criteria_failed_count INTEGER,
    validation_summary TEXT,
    validation_result TEXT,
    experiment_notes TEXT,
    observations TEXT,
    next_actions TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (related_client_id) REFERENCES interview_clients(id) ON DELETE SET NULL,
    FOREIGN KEY (interview_form_id) REFERENCES interview_forms(id) ON DELETE SET NULL,
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
  `CREATE TABLE IF NOT EXISTS interview_semantic_fragments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    campaign_id TEXT,
    interview_session_id TEXT,
    document_node_id TEXT,
    source_type TEXT NOT NULL CHECK(source_type IN ('selection','manual')),
    selected_text TEXT NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (interview_session_id) REFERENCES interview_sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (document_node_id) REFERENCES cloud_nodes(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_interview_semantic_fragments_document ON interview_semantic_fragments(document_node_id, created_at)',
  `CREATE TABLE IF NOT EXISTS comment_ingestion_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_job TEXT NOT NULL,
    input_id TEXT,
    source_query_json TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    comments_count INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (input_id) REFERENCES comment_ingestion_inputs(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comment_ingestion_runs_campaign ON comment_ingestion_runs(user_id, project_id, campaign_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS comment_ingestion_inputs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    source TEXT NOT NULL,
    name TEXT,
    config_json TEXT NOT NULL,
    linked_run_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_run_id) REFERENCES comment_ingestion_runs(id) ON DELETE SET NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comment_ingestion_inputs_campaign ON comment_ingestion_inputs(user_id, project_id, campaign_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS comment_dataset_comments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    audience_id TEXT,
    hypothesis_id TEXT,
    source TEXT NOT NULL,
    source_comment_id TEXT NOT NULL,
    parent_comment_id TEXT,
    video_id TEXT,
    channel_id TEXT,
    author_name TEXT,
    author_channel_id TEXT,
    text TEXT NOT NULL,
    published_at TEXT,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    source_job TEXT,
    source_run_id TEXT,
    source_input_id TEXT,
    source_query_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL,
    FOREIGN KEY (hypothesis_id) REFERENCES interview_hypotheses(id) ON DELETE SET NULL,
    FOREIGN KEY (source_run_id) REFERENCES comment_ingestion_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (source_input_id) REFERENCES comment_ingestion_inputs(id) ON DELETE SET NULL,
    UNIQUE(user_id, project_id, campaign_id, source, source_comment_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comment_dataset_comments_campaign ON comment_dataset_comments(user_id, project_id, campaign_id, published_at DESC, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_comment_dataset_comments_run ON comment_dataset_comments(source_run_id)',
  `CREATE TABLE IF NOT EXISTS comment_code_proposal_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    fragment_id TEXT,
    action TEXT NOT NULL,
    decision_status TEXT,
    decision_type TEXT,
    confidence REAL,
    justification TEXT,
    suggested_code_slug TEXT,
    suggested_code_name TEXT,
    final_code_slug TEXT,
    final_code_name TEXT,
    metadata_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comment_code_reviews_campaign ON comment_code_proposal_reviews(user_id, project_id, campaign_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_comment_code_reviews_slug ON comment_code_proposal_reviews(user_id, project_id, campaign_id, suggested_code_slug, final_code_slug)',
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

const ENTITY_ID_PREFIX = {
  cloud_node_file: 'doc_',
  cloud_node_folder: 'cfold_',
  cloud_node_shortcut: 'cshort_',
  cloud_edge: 'cedge_',
  fragment: 'frag_',
  interview_client: 'client_',
  interview_hypothesis: 'hyp_',
  interview_form: 'form_',
  interview_session: 'int_',
  hypothesis_video_link: 'hvid_',
  comment_ingestion_run: 'crun_',
  comment_ingestion_input: 'cinp_',
  comment_record: 'com_',
  comment_code_review: 'ccrev_',
  ai_chat_message: 'aicm_',
};

function buildEntityId(entityType, fallbackPrefix = 'id_') {
  const prefix = ENTITY_ID_PREFIX[entityType] || fallbackPrefix;
  return `${prefix}${uuid()}`;
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
    [buildEntityId('cloud_edge'), projectId, userId, parentId, childId, 'link', nowIso()],
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
    id: buildEntityId(type === 'file' ? 'cloud_node_file' : (type === 'shortcut' ? 'cloud_node_shortcut' : 'cloud_node_folder')),
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

function decodeWordDocumentBinary(buffer) {
  const candidates = [
    buffer.toString('utf8'),
    buffer.toString('latin1'),
    buffer.toString('utf16le'),
  ];
  const cleaned = candidates
    .map((value) => String(value || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' '))
    .map((value) => value.replace(/[^\S\r\n]+/g, ' '))
    .map((value) => value.replace(/\s+\n/g, '\n').trim())
    .sort((a, b) => b.length - a.length);
  return cleaned[0] || '';
}

function extractDocxTextWithSystemUnzip(storagePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-docx-'));
  try {
    const xml = execFileSync('unzip', ['-p', storagePath, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    const paragraphs = String(xml || '')
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<w:tab\/?\s*>/g, '\t')
      .replace(/<w:br\/?\s*>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
    return paragraphs;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

function readInterviewDocumentForNode(node) {
  const name = String(node?.name || '').toLowerCase();
  const ext = path.extname(name);
  if (!node?.storage_path || !fs.existsSync(node.storage_path)) {
    return { text: '', format: 'unknown', warning: 'Archivo no encontrado en storage.' };
  }

  const buffer = fs.readFileSync(node.storage_path);

  if (ext === '.txt' || ext === '.md' || ext === '.log' || (node.mime_type || '').startsWith('text/')) {
    return { text: buffer.toString('utf8'), format: 'text' };
  }

  if (ext === '.docx') {
    try {
      const text = extractDocxTextWithSystemUnzip(node.storage_path);
      return { text, format: 'docx' };
    } catch (error) {
      return { text: '', format: 'docx', warning: `No se pudo parsear .docx: ${error?.message || String(error)}` };
    }
  }

  if (ext === '.doc') {
    const text = decodeWordDocumentBinary(buffer);
    return { text, format: 'doc', warning: 'Lectura .doc en modo compatibilidad (texto aproximado).' };
  }

  return { text: '', format: ext.replace('.', '') || 'unknown', warning: 'Formato no soportado aún para lectura enriquecida.' };
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


async function rebuildInterviewSemanticFragmentsWithNullableDocumentNode() {
  const hasTable = await tableExists('interview_semantic_fragments');
  if (!hasTable) return;

  await pool.query('PRAGMA foreign_keys = OFF');
  try {
    const legacyTable = `interview_semantic_fragments_legacy_${Date.now()}`;
    await pool.query(`ALTER TABLE interview_semantic_fragments RENAME TO ${normalizeIdentifier(legacyTable)}`);
    await pool.query(`CREATE TABLE interview_semantic_fragments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      campaign_id TEXT,
      interview_session_id TEXT,
      document_node_id TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('selection','manual')),
      selected_text TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (interview_session_id) REFERENCES interview_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (document_node_id) REFERENCES cloud_nodes(id) ON DELETE CASCADE
    )`);
    await pool.query(
      `INSERT INTO interview_semantic_fragments
      (id, user_id, project_id, campaign_id, interview_session_id, document_node_id, source_type, selected_text, start_offset, end_offset, created_at, updated_at)
      SELECT id, user_id, project_id, campaign_id, interview_session_id, document_node_id, source_type, selected_text, start_offset, end_offset, created_at, updated_at
      FROM ${normalizeIdentifier(legacyTable)}`,
    );
    await pool.query(`DROP TABLE ${normalizeIdentifier(legacyTable)}`);
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

  const optionalInterviewHypothesisColumns = [
    ['segment', 'TEXT'],
    ['related_client_id', 'TEXT'],
    ['interview_form_id', 'TEXT'],
    ['last_evaluated_at', 'TEXT'],
    ['min_interviews', 'INTEGER'],
    ['validation_metric_config', 'TEXT'],
    ['evaluated_interviews_count', 'INTEGER'],
    ['problem_score_avg', 'REAL'],
    ['solution_score_avg', 'REAL'],
    ['problem_intensity_avg', 'REAL'],
    ['problem_frequency_avg', 'REAL'],
    ['problem_urgency_avg', 'REAL'],
    ['problem_attempts_avg', 'REAL'],
    ['problem_spend_avg', 'REAL'],
    ['problem_clarity_avg', 'REAL'],
    ['segment_fit_avg', 'REAL'],
    ['emotional_language_avg', 'REAL'],
    ['solution_interest_avg', 'REAL'],
    ['solution_clarity_avg', 'REAL'],
    ['solution_value_avg', 'REAL'],
    ['solution_recurrence_avg', 'REAL'],
    ['solution_payment_avg', 'REAL'],
    ['criteria_passed_count', 'INTEGER'],
    ['criteria_failed_count', 'INTEGER'],
    ['validation_summary', 'TEXT'],
    ['validation_result', 'TEXT'],
    ['experiment_notes', 'TEXT'],
    ['observations', 'TEXT'],
    ['next_actions', 'TEXT'],
  ];

  for (const [columnName, columnType] of optionalInterviewHypothesisColumns) {
    if (!(await hasColumn('interview_hypotheses', columnName))) {
      await pool.query(`ALTER TABLE interview_hypotheses ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const optionalCommentIngestionRunColumns = [
    ['input_id', 'TEXT'],
  ];
  for (const [columnName, columnType] of optionalCommentIngestionRunColumns) {
    if (await tableExists('comment_ingestion_runs') && !(await hasColumn('comment_ingestion_runs', columnName))) {
      await pool.query(`ALTER TABLE comment_ingestion_runs ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  const optionalCommentDatasetColumns = [
    ['source_input_id', 'TEXT'],
  ];
  for (const [columnName, columnType] of optionalCommentDatasetColumns) {
    if (await tableExists('comment_dataset_comments') && !(await hasColumn('comment_dataset_comments', columnName))) {
      await pool.query(`ALTER TABLE comment_dataset_comments ADD COLUMN ${columnName} ${columnType}`);
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

  if (await tableExists('interview_semantic_fragments')) {
    const docNotNull = await hasNotNullColumn('interview_semantic_fragments', 'document_node_id');
    if (docNotNull) await rebuildInterviewSemanticFragmentsWithNullableDocumentNode();
  }

  await ensureHypothesisVideosVideoForeignKeyTarget();
  const forceCloudReset = String(process.env.RESET_CLOUD_SCHEMA || '').trim() === '1';
  if (forceCloudReset) {
    await pool.query('DROP TABLE IF EXISTS cloud_events');
    await pool.query('DROP TABLE IF EXISTS cloud_edges');
    await pool.query('DROP TABLE IF EXISTS cloud_nodes');
  }

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
      hypothesisId = buildEntityId('interview_hypothesis');
      await pool.query(
        'INSERT INTO hypotheses (id, campaign_id, user_id, type, condition, validation_status) VALUES (?, ?, ?, ?, ?, ?)',
        [hypothesisId, audience.campaign_id, video.user_id, 'Auto-migrated', migrationCondition, 'No Validada'],
      );
    }

    await pool.query('UPDATE videos SET hypothesis_id = ? WHERE id = ?', [hypothesisId, video.id]);
  }
}

async function runMigrations() {
  // Keep cloud data persistent across backend restarts/reconnects.
  // If a destructive reset is explicitly needed for maintenance, use RESET_CLOUD_SCHEMA=1.
  const forceCloudReset = String(process.env.RESET_CLOUD_SCHEMA || '').trim() === '1';
  if (forceCloudReset) {
    await pool.query('DROP TABLE IF EXISTS cloud_events');
    await pool.query('DROP TABLE IF EXISTS cloud_edges');
    await pool.query('DROP TABLE IF EXISTS cloud_nodes');
  }

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

const HYPOTHESIS_PROBLEM_KEYS = ['problem_intensity', 'problem_frequency', 'perceived_urgency', 'solution_attempts', 'previous_spend', 'problem_clarity', 'segment_fit', 'emotional_language'];
const HYPOTHESIS_SOLUTION_KEYS = ['solution_interest', 'solution_clarity', 'perceived_value', 'usage_probability', 'willingness_to_pay'];
const INTERVIEW_HYPOTHESIS_METRIC_ALIASES = {
  score_problema: 'problem_score_avg',
  score_solucion: 'solution_score_avg',
  intensidad_problema: 'problem_intensity_avg',
  frecuencia_problema: 'problem_frequency_avg',
  urgencia_percibida: 'problem_urgency_avg',
  intentos_solucion: 'problem_attempts_avg',
  gasto_previo: 'problem_spend_avg',
  claridad_problema: 'problem_clarity_avg',
  encaje_segmento: 'segment_fit_avg',
  lenguaje_emocional: 'emotional_language_avg',
  interes_solucion: 'solution_interest_avg',
  claridad_solucion: 'solution_clarity_avg',
  valor_percibido: 'solution_value_avg',
  probabilidad_uso_recurrente: 'solution_recurrence_avg',
  disposicion_pagar: 'solution_payment_avg',
  problem_score_avg: 'problem_score_avg',
  solution_score_avg: 'solution_score_avg',
  problem_intensity_avg: 'problem_intensity_avg',
  problem_frequency_avg: 'problem_frequency_avg',
  problem_urgency_avg: 'problem_urgency_avg',
  problem_attempts_avg: 'problem_attempts_avg',
  problem_spend_avg: 'problem_spend_avg',
  problem_clarity_avg: 'problem_clarity_avg',
  segment_fit_avg: 'segment_fit_avg',
  emotional_language_avg: 'emotional_language_avg',
  solution_interest_avg: 'solution_interest_avg',
  solution_clarity_avg: 'solution_clarity_avg',
  solution_value_avg: 'solution_value_avg',
  solution_recurrence_avg: 'solution_recurrence_avg',
  solution_payment_avg: 'solution_payment_avg',
};
const INTERVIEW_HYPOTHESIS_COMPARISON_OPERATORS = new Set(['>=', '>', '<=', '<']);

function toValidScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
}

function averageScores(values = []) {
  const clean = values.map(toValidScore).filter((value) => value != null);
  if (!clean.length) return null;
  return Number((clean.reduce((acc, value) => acc + value, 0) / clean.length).toFixed(2));
}

function normalizeInterviewHypothesisValidationConfig(rawConfig) {
  let parsedConfig = rawConfig;
  if (typeof parsedConfig === 'string') {
    parsedConfig = safeParseJsonField(parsedConfig, null);
  }
  if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) return null;
  const selectedMetrics = Array.isArray(parsedConfig.selected_metrics)
    ? parsedConfig.selected_metrics
      .map((metric) => INTERVIEW_HYPOTHESIS_METRIC_ALIASES[String(metric || '').trim()])
      .filter(Boolean)
    : [];
  const deduplicatedMetrics = [...new Set(selectedMetrics)];
  const thresholdValue = Number(parsedConfig.threshold_value);
  const comparisonOperator = String(parsedConfig.comparison_operator || '>=').trim();
  const outcomeIfTrue = String(parsedConfig.outcome_if_true || 'validada').trim() || 'validada';
  const outcomeIfFalse = String(parsedConfig.outcome_if_false || 'refutada').trim() || 'refutada';
  const evaluationType = String(parsedConfig.evaluation_type || 'average_selected_metrics').trim() || 'average_selected_metrics';
  if (!deduplicatedMetrics.length || !Number.isFinite(thresholdValue) || !INTERVIEW_HYPOTHESIS_COMPARISON_OPERATORS.has(comparisonOperator)) {
    return null;
  }
  return {
    selected_metrics: deduplicatedMetrics,
    threshold_value: Number(thresholdValue.toFixed(2)),
    comparison_operator: comparisonOperator,
    outcome_if_true: outcomeIfTrue,
    outcome_if_false: outcomeIfFalse,
    evaluation_type: evaluationType,
  };
}

function evaluateComparison(actualValue, thresholdValue, operator) {
  if (!Number.isFinite(actualValue) || !Number.isFinite(thresholdValue)) return false;
  if (operator === '>=') return actualValue >= thresholdValue;
  if (operator === '>') return actualValue > thresholdValue;
  if (operator === '<=') return actualValue <= thresholdValue;
  if (operator === '<') return actualValue < thresholdValue;
  return false;
}

function parseInterviewHypothesisRow(row = null) {
  if (!row) return row;
  return {
    ...row,
    validation_metric_config: normalizeInterviewHypothesisValidationConfig(row.validation_metric_config),
  };
}

function buildHypothesisValidationSummary({ result, interviewsCount, passCount, failCount, minInterviews, problemScoreAvg, solutionScoreAvg }) {
  if (result === 'no evaluada') return `Muestra insuficiente para evaluar la hipótesis (${interviewsCount}/${minInterviews || 0} entrevistas).`;
  if (result === 'validada') return `Hipótesis validada: problema y solución superan umbrales (${passCount} criterios cumplidos).`;
  if (result === 'refutada') return `Hipótesis refutada: bajo cumplimiento de criterios (${failCount} fallos).`;
  if (result === 'señal fuerte') return `Señal fuerte: cumplimiento alto de criterios con evidencia consistente.`;
  if (result === 'señal moderada') return `Señal moderada: buen dolor (${problemScoreAvg ?? '—'}) y/o solución (${solutionScoreAvg ?? '—'}) con brechas puntuales.`;
  return 'Señal débil: resultados iniciales aún no alcanzan umbrales robustos.';
}


function computeFutureIso(seconds = 0) {
  const base = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  return new Date(base).toISOString();
}


async function getYouTubeIntegrationByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM youtube_integrations WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

function mergeYouTubeConfig(baseConfig, integration = null) {
  const parsedScopes = String(integration?.scopes || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    ...baseConfig,
    apiKey: String(integration?.api_key || '').trim() || baseConfig.apiKey,
    clientId: String(integration?.client_id || '').trim() || baseConfig.clientId,
    clientSecret: String(integration?.client_secret || '').trim() || baseConfig.clientSecret,
    redirectUri: String(integration?.redirect_uri || '').trim() || baseConfig.redirectUri,
    scopes: parsedScopes.length ? parsedScopes : baseConfig.scopes,
  };
}

async function getYouTubeConfigForUser(userId) {
  const baseConfig = getYouTubeConfig();
  const integration = await getYouTubeIntegrationByUserId(userId);
  return {
    config: mergeYouTubeConfig(baseConfig, integration),
    integration,
    hasCustomConfig: Boolean(integration),
  };
}

async function getAiIntegrationByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM ai_integrations WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function getOpenClawIntegrationByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM openclaw_integrations WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function ensureProjectAccess(userId, projectId) {
  const [rows] = await pool.query('SELECT id, name FROM projects WHERE id = ? AND user_id = ? LIMIT 1', [projectId, userId]);
  return rows[0] || null;
}

function resolveAiBaseUrl(integration) {
  const provider = String(integration?.provider || '').trim().toLowerCase();
  const customBaseUrl = String(integration?.base_url || '').trim();
  if (customBaseUrl) return customBaseUrl.replace(/\/+$/, '');
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (provider === 'ollama') return 'http://localhost:11434/v1';
  return '';
}

const AI_PROVIDER_DEFAULT_MODEL = {
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.1:8b',
};

function normalizeAiModel(provider, modelValue) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const rawModel = String(modelValue || '').trim();
  if (!rawModel) return '';

  const genericInputs = new Set([
    normalizedProvider,
    normalizedProvider.replace(/_/g, '-'),
    'model',
    'default',
    'ia',
    'ai',
  ]);

  if (genericInputs.has(rawModel.toLowerCase()) && AI_PROVIDER_DEFAULT_MODEL[normalizedProvider]) {
    return AI_PROVIDER_DEFAULT_MODEL[normalizedProvider];
  }

  return rawModel;
}

async function getProjectScopeSummary(userId, projectId) {
  const countByProjectColumn = async (tableName) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${normalizeIdentifier(tableName)} WHERE user_id = ? AND project_id = ?`,
      [userId, projectId],
    );
    return Number(rows?.[0]?.total || 0);
  };

  const countByCampaignScope = async (tableName) => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM ${normalizeIdentifier(tableName)} t
       JOIN campaigns c ON c.id = t.campaign_id
       WHERE t.user_id = ? AND c.project_id = ?`,
      [userId, projectId],
    );
    return Number(rows?.[0]?.total || 0);
  };

  const [topCommentRows] = await pool.query(
    `SELECT text, author_name, like_count, published_at
     FROM comment_dataset_comments
     WHERE user_id = ? AND project_id = ?
     ORDER BY like_count DESC, published_at DESC
     LIMIT 5`,
    [userId, projectId],
  );

  const [topInterviewHypRows] = await pool.query(
    `SELECT title, validation_result, evaluated_interviews_count, problem_score_avg, solution_score_avg
     FROM interview_hypotheses
     WHERE user_id = ? AND project_id = ?
     ORDER BY updated_at DESC
     LIMIT 5`,
    [userId, projectId],
  );

  return {
    counts: {
      campaigns: await countByProjectColumn('campaigns'),
      audiences: await countByCampaignScope('audiences'),
      videos: await countByProjectColumn('videos'),
      hypotheses: await countByCampaignScope('hypotheses'),
      interview_hypotheses: await countByProjectColumn('interview_hypotheses'),
      interviews: await countByProjectColumn('interview_sessions'),
      interview_fragments: await countByProjectColumn('interview_semantic_fragments'),
      comment_runs: await countByProjectColumn('comment_ingestion_runs'),
      comment_records: await countByProjectColumn('comment_dataset_comments'),
    },
    top_comments: topCommentRows.map((row) => ({
      author_name: row.author_name || 'Sin autor',
      like_count: Number(row.like_count || 0),
      published_at: row.published_at || null,
      text: String(row.text || '').slice(0, 320),
    })),
    top_interview_hypotheses: topInterviewHypRows.map((row) => ({
      title: row.title || 'Hipótesis sin título',
      validation_result: row.validation_result || 'no evaluada',
      evaluated_interviews_count: Number(row.evaluated_interviews_count || 0),
      problem_score_avg: row.problem_score_avg == null ? null : Number(row.problem_score_avg),
      solution_score_avg: row.solution_score_avg == null ? null : Number(row.solution_score_avg),
    })),
  };
}

function buildProjectScopedSystemPrompt(project, projectSummary) {
  const summaryJson = JSON.stringify(projectSummary, null, 2);
  return [
    'Eres Tessa, una IA analista de investigación de mercado.',
    `Contexto permitido: SOLO proyecto ${project.id} (${project.name || 'sin nombre'}).`,
    'Prohibido usar o inferir información de otros proyectos.',
    'Si la pregunta requiere otro proyecto, responde que tu alcance está restringido al proyecto activo.',
    'Usa los datos del resumen como base factual y sé explícita cuando falte evidencia.',
    'Responde en español, clara y accionable.',
    `Resumen de datos del proyecto:\n${summaryJson}`,
  ].join('\n');
}

async function requestAiChatCompletion(integration, payload) {
  const provider = String(integration?.provider || '').trim().toLowerCase();
  const model = normalizeAiModel(provider, integration?.model);
  const apiKey = String(integration?.api_key || '').trim();
  const baseUrl = resolveAiBaseUrl(integration);

  if (!model) throw new Error('La integración de IA no tiene un modelo válido configurado.');
  if (!baseUrl) throw new Error(`El proveedor ${provider || 'seleccionado'} requiere base_url compatible para chat.`);
  if (provider !== 'ollama' && !apiKey) {
    throw new Error('La integración de IA requiere API key para enviar mensajes.');
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (integration?.organization) headers['OpenAI-Organization'] = String(integration.organization);
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://marketclaw.local';
    headers['X-Title'] = 'MarketClaw Chat IA';
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: payload,
    }),
  });

  const raw = await response.text();
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const apiError = json?.error?.message || json?.error || raw || `HTTP ${response.status}`;
    throw new Error(`No se pudo completar el chat con IA: ${apiError}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('El proveedor de IA no devolvió contenido de respuesta.');
  return {
    content: String(content).trim(),
    usage: json?.usage || null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

function parseRateLimitRetryMs(errorMessage = '') {
  const message = String(errorMessage || '');
  const secondsMatch = message.match(/try again in\s*([0-9]+(?:\.[0-9]+)?)s/i);
  if (secondsMatch && Number.isFinite(Number(secondsMatch[1]))) {
    return Math.max(500, Math.ceil(Number(secondsMatch[1]) * 1000) + 250);
  }
  return 0;
}

function isRateLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('rate limit') || message.includes('tpm') || message.includes('tokens per minute');
}

function isDailyTokenLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('tokens per day') || message.includes('tpd');
}

async function requestAiChatCompletionWithRateLimitRetry(integration, payload, options = {}) {
  const maxRetries = Math.max(0, Number(options.maxRetries) || 4);
  const baseDelayMs = Math.max(300, Number(options.baseDelayMs) || 1200);
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      return await requestAiChatCompletion(integration, payload);
    } catch (error) {
      lastError = error;
      if (isDailyTokenLimitError(error)) throw error;
      if (!isRateLimitError(error) || attempt >= maxRetries) throw error;

      const parsedDelay = parseRateLimitRetryMs(error?.message);
      const jitter = Math.floor(Math.random() * 350);
      const delayMs = parsedDelay || (baseDelayMs * (attempt + 1)) + jitter;
      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw lastError || new Error('No se pudo completar el chat con IA por límite de tasa.');
}

function buildSemanticFragmentAgentPrompt({ commentId, sourceId, commentText, existingCodes = [] }) {
  const compact = (value, max = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const codebook = (Array.isArray(existingCodes) ? existingCodes : [])
    .slice(0, 200)
    .map((code, index) => {
      const slug = String(code?.slug || '').trim();
      const name = String(code?.name || '').trim();
      if (!slug || !name) return '';
      const description = compact(code?.description || '', 180);
      return `${index + 1}) slug=${slug} | nombre=${name}${description ? ` | descripcion=${description}` : ''}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    'Eres una analista cualitativa experta en fragmentación y codificación semántica.',
    'Objetivo: leer un comentario completo, extraer solo pasajes con alta riqueza semántica y codificarlos usando EXCLUSIVAMENTE códigos existentes.',
    'Prohibiciones absolutas: no crear códigos nuevos, no crear subcódigos, no usar placeholders, no usar matching mecánico de keywords.',
    'Reglas:',
    '1) Analiza el comentario completo antes de fragmentar.',
    '2) Extrae 0, 1 o máximo 2 fragmentos por comentario, solo si tienen valor analítico real y riqueza semántica suficiente.',
    '3) Acepta fragmentos con match_fuerte o match_probable contra códigos existentes. Rechaza solo sin_match o baja riqueza.',
    '4) Cada fragmento debe mapearse al código existente más adecuado por significado.',
    '5) Si ningún código encaja de forma razonable, devuelve fragments: [] y reason_if_rejected.',
    '6) Conserva texto exacto original en fragment_text.',
    '7) Incluye offsets reales start_char_index y end_char_index.',
    '8) Devuelve semantic_confidence y assignment_confidence (0..1).',
    '9) Incluye assignment_rationale breve y match_level en {match_fuerte,match_probable,sin_match}.',
    '10) Si no fragmentas, incluir reason_if_rejected en {baja_riqueza_semantica,sin_codigo_razonable,comentario_redundante,texto_demasiado_vago}.',
    'Respuesta requerida: JSON válido puro, sin markdown.',
    '{"comment_id":"","reason_if_rejected":"","fragments":[{"fragment_id":"","fragment_text":"","start_char_index":0,"end_char_index":0,"semantic_confidence":0.0,"assigned_code_slug":"","assignment_confidence":0.0,"assignment_rationale":"","match_level":"match_probable"}]}',
    `comment_id: ${commentId}`,
    `source_id: ${sourceId}`,
    `texto_completo_del_comentario: ${commentText}`,
    'CODEBOOK_EXISTENTE (usar solo estos slugs):',
    codebook || '- sin códigos disponibles -',
  ].join('\n');
}

function buildSemanticFragmentBatchPrompt({ comments = [], existingCodes = [] }) {
  const compact = (value, max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const safeComments = (Array.isArray(comments) ? comments : [])
    .map((item) => ({
      comment_id: String(item?.comment_id || '').trim(),
      source_id: String(item?.source_id || '').trim(),
      text: String(item?.texto_completo_del_comentario || item?.text || '').trim(),
    }))
    .filter((item) => item.comment_id && item.source_id && item.text)
    .slice(0, 50);

  const codebook = (Array.isArray(existingCodes) ? existingCodes : [])
    .slice(0, 220)
    .map((code, index) => {
      const slug = String(code?.slug || '').trim();
      const name = String(code?.name || '').trim();
      if (!slug || !name) return '';
      const description = compact(code?.description || '', 150);
      return `${index + 1}) slug=${slug} | nombre=${name}${description ? ` | descripcion=${description}` : ''}`;
    })
    .filter(Boolean)
    .join('\n');

  const serializedComments = safeComments
    .map((item, index) => `${index + 1}) comment_index=${index + 1} | comment_id=${item.comment_id} | source_id=${item.source_id} | text=${compact(item.text, 700)}`)
    .join('\n');

  return [
    'Eres una analista cualitativa experta en fragmentación y codificación semántica.',
    'Procesa un BATCH de comentarios y devuelve fragmentos de alto valor analítico codificados usando EXCLUSIVAMENTE códigos existentes.',
    'Prohibido: crear códigos/subcódigos nuevos, placeholders, o clasificación mecánica por keywords.',
    'Reglas:',
    '1) Analiza cada comentario completo antes de fragmentar.',
    '2) Extrae 0..2 fragmentos por comentario cuando exista riqueza semántica suficiente y encaje semántico razonable.',
    '3) Ignora relleno, cortesía, ruido y texto ambiguo sin valor analítico.',
    '4) Clasifica cada decisión por comentario: match_fuerte, match_probable, sin_match.',
    '5) Crear fragmentos para match_fuerte y match_probable (si hay riqueza suficiente).',
    '6) Rechazar solo por baja_riqueza_semantica, sin_codigo_razonable, comentario_redundante o texto_demasiado_vago.',
    '7) Conserva texto exacto del fragmento y offsets reales.',
    '8) assignment_confidence y semantic_confidence en rango 0..1.',
    'Devuelve JSON válido puro (sin markdown) con estructura EXACTA:',
    '{"items":[{"comment_index":1,"comment_id":"","reason_if_rejected":"","fragments":[{"fragment_id":"","fragment_text":"","start_char_index":0,"end_char_index":0,"semantic_confidence":0.0,"assigned_code_slug":"","assignment_confidence":0.0,"assignment_rationale":"","match_level":"match_probable"}]}]}',
    'CODEBOOK_EXISTENTE (usar solo estos slugs):',
    codebook || '- sin códigos disponibles -',
    'COMENTARIOS_DEL_BATCH:',
    serializedComments || '- sin comentarios válidos -',
  ].join('\n');
}


function compactAnalysisText(value = '', max = 420) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function serializeCodeMapAnalysisEvidence({ code, fragments = [], relatedCodes = [] }) {
  const safeCode = {
    slug: String(code?.slug || '').trim(),
    name: String(code?.name || '').trim(),
    description: compactAnalysisText(code?.description || '', 260),
  };

  const serializedFragments = (Array.isArray(fragments) ? fragments : [])
    .slice(0, 120)
    .map((fragment, index) => ({
      fragment_id: String(fragment?.fragment_id || fragment?.id || `fragment_${index + 1}`).trim(),
      excerpt: compactAnalysisText(fragment?.excerpt || fragment?.fragment_text || '', 420),
      source_comment_id: String(fragment?.source_comment_id || fragment?.comment_id || '').trim(),
    }))
    .filter((fragment) => fragment.fragment_id && fragment.excerpt);

  const serializedRelated = (Array.isArray(relatedCodes) ? relatedCodes : [])
    .slice(0, 24)
    .map((item) => ({
      slug: String(item?.slug || '').trim(),
      name: String(item?.name || '').trim(),
      description: compactAnalysisText(item?.description || '', 180),
      relation: String(item?.relation || '').trim(),
    }))
    .filter((item) => item.slug && item.name);

  return {
    code: safeCode,
    fragments: serializedFragments,
    related_codes: serializedRelated,
  };
}

function buildCodeMapAgentSectionPrompt({ agentName, sectionName, focusInstruction, evidence }) {
  return [
    `Rol: ${agentName}.`,
    `Sección objetivo: ${sectionName}.`,
    'Objetivo de calidad: redacción profesional, profunda, explícita y accionable; evita respuestas superficiales.',
    'Regla crítica: usa únicamente la evidencia entregada. Está prohibido inventar o completar huecos.',
    'Debes citar explícitamente fragmentos reales en cada conclusión.',
    'Puedes citar códigos relacionados solo si aparecen en la evidencia.',
    `Instrucción de enfoque: ${focusInstruction}`,
    'La sección debe incluir: patrón dominante, implicaciones psicológicas, tensión estratégica y oportunidades concretas.',
    'Devuelve únicamente JSON válido con este formato exacto:',
    '{"analysis":"","citations":[{"fragment_id":"","excerpt":"","code_slug":""}]}',
    'Si faltan pruebas para un punto, dilo explícitamente en analysis sin inventar.',
    'EVIDENCIA_JSON:',
    JSON.stringify(evidence),
  ].join('\n');
}

function buildCodeMapAnalysisRefinerPrompt({ evidence, sections }) {
  return [
    'Eres el Agente Refinador de un análisis semántico.',
    'Toma las secciones de agentes especializados y unifica lenguaje, elimina redundancia y alinea coherencia.',
    'Construye un informe absoluto de investigación: extenso, riguroso y de nivel profesional.',
    'summary_absolute debe ser el bloque más completo y fundacional, incluyendo: patrón central, dolores, deseos, placeres, problemas, soluciones, narrativa dominante, interpretación psicológica y lectura estratégica.',
    'No inventes nueva evidencia; solo reorganiza y mejora claridad con base en las mismas citas.',
    'Devuelve JSON válido exacto con estructura:',
    '{"summary_absolute":"","dolores":{"analysis":"","citations":[]},"deseos":{"analysis":"","citations":[]},"placeres":{"analysis":"","citations":[]},"problemas":{"analysis":"","citations":[]},"soluciones":{"analysis":"","citations":[]},"sintesis_final":{"analysis":"","citations":[]}}',
    'EVIDENCIA_JSON:',
    JSON.stringify(evidence),
    'SECCIONES_JSON:',
    JSON.stringify(sections),
  ].join('\n');
}

function buildCodeMapAnalysisOptimizerPrompt({ evidence, refinedDocument }) {
  return [
    'Eres el Agente Optimizador Final.',
    'Optimiza claridad, legibilidad y densidad analítica sin alterar fidelidad a la evidencia.',
    'Eleva el resultado final a estándar premium tipo informe ejecutivo-técnico para consola de investigación.',
    'No reduzcas de más: preserva amplitud analítica y detalle argumental en summary_absolute y sintesis_final.',
    'Mantén las citas y evita cualquier afirmación no soportada por fragmentos/códigos entregados.',
    'Devuelve JSON válido exacto con esta estructura:',
    '{"summary_absolute":"","dolores":{"analysis":"","citations":[]},"deseos":{"analysis":"","citations":[]},"placeres":{"analysis":"","citations":[]},"problemas":{"analysis":"","citations":[]},"soluciones":{"analysis":"","citations":[]},"sintesis_final":{"analysis":"","citations":[]}}',
    'EVIDENCIA_JSON:',
    JSON.stringify(evidence),
    'DOCUMENTO_REFINADO_JSON:',
    JSON.stringify(refinedDocument),
  ].join('\n');
}

function normalizeCodeMapAnalysisSection(value, fallbackAnalysis = '') {
  const section = value && typeof value === 'object' ? value : {};
  const citations = Array.isArray(section.citations) ? section.citations : [];
  return {
    analysis: compactAnalysisText(section.analysis || fallbackAnalysis || '', 5200),
    citations: citations
      .slice(0, 10)
      .map((item) => ({
        fragment_id: String(item?.fragment_id || '').trim(),
        excerpt: compactAnalysisText(item?.excerpt || '', 320),
        code_slug: String(item?.code_slug || '').trim(),
      }))
      .filter((item) => item.fragment_id && item.excerpt),
  };
}

function normalizeCodeMapAnalysisDocument(parsed, fallbackSections = {}) {
  const base = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    summary_absolute: compactAnalysisText(base.summary_absolute || fallbackSections.summary_absolute || '', 6200),
    dolores: normalizeCodeMapAnalysisSection(base.dolores || fallbackSections.dolores, fallbackSections.dolores?.analysis || ''),
    deseos: normalizeCodeMapAnalysisSection(base.deseos || fallbackSections.deseos, fallbackSections.deseos?.analysis || ''),
    placeres: normalizeCodeMapAnalysisSection(base.placeres || fallbackSections.placeres, fallbackSections.placeres?.analysis || ''),
    problemas: normalizeCodeMapAnalysisSection(base.problemas || fallbackSections.problemas, fallbackSections.problemas?.analysis || ''),
    soluciones: normalizeCodeMapAnalysisSection(base.soluciones || fallbackSections.soluciones, fallbackSections.soluciones?.analysis || ''),
    sintesis_final: normalizeCodeMapAnalysisSection(base.sintesis_final || fallbackSections.sintesis_final, fallbackSections.sintesis_final?.analysis || ''),
  };
}

function extractJsonObjectFromText(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const unwrapped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(unwrapped);
  } catch {
    const startObj = unwrapped.indexOf('{');
    const endObj = unwrapped.lastIndexOf('}');
    if (startObj >= 0 && endObj > startObj) {
      try {
        return JSON.parse(unwrapped.slice(startObj, endObj + 1));
      } catch {
        // continue
      }
    }

    const startArr = unwrapped.indexOf('[');
    const endArr = unwrapped.lastIndexOf(']');
    if (startArr >= 0 && endArr > startArr) {
      try {
        return JSON.parse(unwrapped.slice(startArr, endArr + 1));
      } catch {
        return null;
      }
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        const arrStart = text.indexOf('[');
        const arrEnd = text.lastIndexOf(']');
        if (arrStart >= 0 && arrEnd > arrStart) {
          try {
            return JSON.parse(text.slice(arrStart, arrEnd + 1));
          } catch {
            return null;
          }
        }
        return null;
      }
    }
    return null;
  }
}

function selectRelevantFragmentsForCodeMapChat({ fragments = [], question = '', limit = 8 }) {
  const tokens = String(question || '')
    .toLowerCase()
    .split(/[^a-záéíóúñ0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  const tokenSet = new Set(tokens);
  const safeFragments = Array.isArray(fragments) ? fragments : [];

  const scored = safeFragments
    .map((fragment) => {
      const excerpt = String(fragment?.excerpt || fragment?.fragment_text || '').trim();
      const lc = excerpt.toLowerCase();
      let score = 0;
      for (const token of tokenSet) {
        if (lc.includes(token)) score += 1;
      }
      return {
        fragment_id: String(fragment?.fragment_id || fragment?.id || '').trim(),
        excerpt: compactAnalysisText(excerpt, 280),
        source_comment_id: String(fragment?.source_comment_id || fragment?.comment_id || '').trim(),
        score,
      };
    })
    .filter((item) => item.fragment_id && item.excerpt)
    .sort((a, b) => b.score - a.score);

  const withSignal = scored.filter((item) => item.score > 0).slice(0, limit);
  if (withSignal.length) return withSignal;
  return scored.slice(0, Math.max(4, Math.min(limit, 8)));
}

function buildCodeMapAnalysisChatPrompt({ session = {}, question = '', relevantEvidence = [] }) {
  const codeContext = {
    code_slug: String(session?.code_slug || '').trim(),
    code_name: String(session?.code_name || '').trim(),
    code_description: compactAnalysisText(session?.code_description || '', 240),
  };

  const initialReport = session?.initial_report && typeof session.initial_report === 'object'
    ? session.initial_report
    : {};
  const fixedSummary = {
    summary_absolute: compactAnalysisText(initialReport.summary_absolute || '', 1200),
    dolores: compactAnalysisText(initialReport?.dolores?.analysis || '', 700),
    deseos: compactAnalysisText(initialReport?.deseos?.analysis || '', 700),
    placeres: compactAnalysisText(initialReport?.placeres?.analysis || '', 700),
    problemas: compactAnalysisText(initialReport?.problemas?.analysis || '', 700),
    soluciones: compactAnalysisText(initialReport?.soluciones?.analysis || '', 700),
    sintesis_final: compactAnalysisText(initialReport?.sintesis_final?.analysis || '', 700),
  };

  const history = Array.isArray(session?.conversation_history) ? session.conversation_history : [];
  const recentHistory = history.slice(-8).map((message) => ({
    role: String(message?.role || '').trim(),
    content: compactAnalysisText(message?.content || '', 420),
  }));

  return [
    'Eres un copiloto analítico especializado en un único código del Mapa de Códigos.',
    'Regla crítica: mantener foco 100% en este código y su evidencia. No mezclar otros contextos.',
    'No inventes; responde solo con base en el informe inicial, memoria y evidencia relevante adjunta.',
    'Economía de tokens: no repitas todo el informe salvo que sea necesario para responder.',
    'Formato de salida: JSON válido exacto:',
    '{"answer":"","memory_summary":"","citations":[{"fragment_id":"","excerpt":"","code_slug":""}]}',
    'memory_summary debe actualizar y compactar aprendizajes relevantes de la conversación (máx 900 caracteres).',
    'CONTEXTO_FIJO_CODIGO_JSON:',
    JSON.stringify(codeContext),
    'INFORME_BASE_JSON:',
    JSON.stringify(fixedSummary),
    'MEMORIA_PREVIA_RESUMIDA:',
    compactAnalysisText(session?.memory_summary || '', 900),
    'HISTORIAL_RECIENTE_JSON:',
    JSON.stringify(recentHistory),
    'EVIDENCIA_RELEVANTE_JSON:',
    JSON.stringify(relevantEvidence),
    `PREGUNTA_USUARIO: ${String(question || '').trim()}`,
  ].join('\n');
}

function clampConfidence(value, fallback = 0.75) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return Number(parsed.toFixed(3));
}


const normalizeRejectReason = (value) => {
  const reason = String(value || '').trim().toLowerCase();
  if (!reason) return '';
  if (reason.includes('redund')) return 'comentario_redundante';
  if (reason.includes('vago')) return 'texto_demasiado_vago';
  if (reason.includes('riqueza') || reason.includes('semantic') || reason.includes('semantica')) return 'baja_riqueza_semantica';
  if (reason.includes('codigo') || reason.includes('match') || reason.includes('encaje')) return 'sin_codigo_razonable';
  return '';
};

function normalizeLookupKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildExistingCodeResolvers(existingCodes = []) {
  const codeRows = Array.isArray(existingCodes) ? existingCodes : [];
  const slugByNormalizedSlug = new Map();
  const slugByNormalizedName = new Map();

  for (const code of codeRows) {
    const slug = String(code?.slug || '').trim();
    const name = String(code?.name || '').trim();
    if (!slug) continue;
    const slugKey = normalizeLookupKey(slug);
    if (slugKey) slugByNormalizedSlug.set(slugKey, slug);
    const nameKey = normalizeLookupKey(name);
    if (nameKey) slugByNormalizedName.set(nameKey, slug);
  }

  return {
    allowedCodeSlugs: new Set(codeRows.map((code) => String(code?.slug || '').trim()).filter(Boolean)),
    resolveAssignedCodeSlug(rawValue = '') {
      const raw = String(rawValue || '').trim();
      if (!raw) return '';
      if (/^\d+$/.test(raw)) {
        const idx = Number(raw) - 1;
        if (idx >= 0 && idx < codeRows.length) {
          const indexedSlug = String(codeRows[idx]?.slug || '').trim();
          if (indexedSlug) return indexedSlug;
        }
      }
      const normalized = normalizeLookupKey(raw);
      return slugByNormalizedSlug.get(normalized)
        || slugByNormalizedName.get(normalized)
        || '';
    },
  };
}

function fallbackSemanticSplit(commentId, commentText = '') {
  const text = String(commentText || '');
  if (!text.trim()) {
    return {
      comment_id: String(commentId || ''),
      fragments: [],
    };
  }

  const fragments = [];
  const sentenceRegex = /[^.!?\n]+[.!?]?|[^\n]+/g;
  const matches = [...text.matchAll(sentenceRegex)];
  for (const match of matches) {
    const rawSegment = String(match[0] || '');
    const startBase = Number(match.index || 0);
    const trimmed = rawSegment.trim();
    if (!trimmed) continue;

    const leftTrim = rawSegment.length - rawSegment.trimStart().length;
    const start = startBase + leftTrim;
    const end = start + trimmed.length;

    fragments.push({
      fragment_id: uuid(),
      fragment_text: trimmed,
      start_char_index: start,
      end_char_index: end,
      semantic_confidence: 0.65,
    });
  }

  if (!fragments.length) {
    fragments.push({
      fragment_id: uuid(),
      fragment_text: text.trim(),
      start_char_index: text.indexOf(text.trim()),
      end_char_index: text.indexOf(text.trim()) + text.trim().length,
      semantic_confidence: 0.6,
    });
  }

  return {
    comment_id: String(commentId || ''),
    fragments,
  };
}

function normalizeSemanticFragmentAgentOutput({ parsed, commentId, sourceId, commentText, existingCodes = [] }) {
  const text = String(commentText || '');
  const incoming = Array.isArray(parsed?.fragments) ? parsed.fragments : [];
  const normalized = [];
  let cursor = 0;

  const { allowedCodeSlugs, resolveAssignedCodeSlug } = buildExistingCodeResolvers(existingCodes);

  for (const item of incoming) {
    const fragmentText = String(item?.fragment_text || '').trim();
    if (!fragmentText) continue;

    const rawAssignedCode = String(
      item?.assigned_code_slug
      || item?.assigned_code
      || item?.code_slug
      || item?.assigned_code_name
      || item?.code_name
      || '',
    ).trim();
    const mappedSlug = resolveAssignedCodeSlug(rawAssignedCode);
    if (!mappedSlug || !allowedCodeSlugs.has(mappedSlug)) continue;

    const matchLevelRaw = String(item?.match_level || item?.match || '').trim().toLowerCase();
    const matchLevel = matchLevelRaw === 'match_fuerte'
      ? 'match_fuerte'
      : matchLevelRaw === 'match_probable'
        ? 'match_probable'
        : matchLevelRaw === 'sin_match'
          ? 'sin_match'
          : 'match_probable';
    if (matchLevel === 'sin_match') continue;

    let start = Number(item?.start_char_index);
    let end = Number(item?.end_char_index);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0 || end > text.length) {
      const foundAt = text.indexOf(fragmentText, Math.max(0, cursor));
      if (foundAt >= 0) {
        start = foundAt;
        end = foundAt + fragmentText.length;
        cursor = end;
      } else {
        const fallbackAt = text.indexOf(fragmentText);
        if (fallbackAt >= 0) {
          start = fallbackAt;
          end = fallbackAt + fragmentText.length;
        } else {
          continue;
        }
      }
    }

    normalized.push({
      fragment_id: String(item?.fragment_id || uuid()),
      comment_id: String(commentId || ''),
      source_id: String(sourceId || ''),
      fragment_text: fragmentText,
      start_char_index: Math.max(0, Math.floor(start)),
      end_char_index: Math.max(0, Math.floor(end)),
      semantic_confidence: clampConfidence(item?.semantic_confidence, 0.75),
      assigned_code_slug: mappedSlug,
      assignment_confidence: clampConfidence(item?.assignment_confidence, 0.75),
      assignment_rationale: String(item?.assignment_rationale || '').trim().slice(0, 280),
      match_level: matchLevel,
    });
  }

  const rejectReason = normalizeRejectReason(
    parsed?.reason_if_rejected
    || parsed?.discard_reason
    || parsed?.reject_reason
    || '',
  );

  return {
    comment_id: String(commentId || ''),
    fragments: normalized,
    reason_if_rejected: normalized.length ? '' : (rejectReason || 'sin_codigo_razonable'),
  };
}

function normalizeSemanticFragmentBatchOutput({ parsed, comments = [], existingCodes = [] }) {
  const byComment = new Map(
    (Array.isArray(comments) ? comments : [])
      .map((item) => {
        const commentId = String(item?.comment_id || '').trim();
        const sourceId = String(item?.source_id || '').trim();
        const commentText = String(item?.texto_completo_del_comentario || item?.text || '').trim();
        if (!commentId || !sourceId || !commentText) return null;
        return [commentId, { comment_id: commentId, source_id: sourceId, comment_text: commentText }];
      })
      .filter(Boolean),
  );

  const incomingItems = Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.comments)
        ? parsed.comments
        : Array.isArray(parsed)
          ? parsed
          : [];

  const normalizedItems = [];
  const consumed = new Set();

  for (const item of incomingItems) {
    const commentId = String(item?.comment_id || item?.id || '').trim();
    let source = byComment.get(commentId);
    if (!source) {
      const rawIndex = Number(item?.comment_index ?? item?.index);
      const sourceByIndex = Number.isInteger(rawIndex) && rawIndex > 0
        ? comments[rawIndex - 1]
        : null;
      if (sourceByIndex) {
        const fallbackCommentId = String(sourceByIndex?.comment_id || '').trim();
        source = byComment.get(fallbackCommentId) || null;
      }
    }
    if (!source) continue;
    consumed.add(source.comment_id);
    normalizedItems.push(normalizeSemanticFragmentAgentOutput({
      parsed: item,
      commentId: source.comment_id,
      sourceId: source.source_id,
      commentText: source.comment_text,
      existingCodes,
    }));
  }

  for (const [commentId, source] of byComment.entries()) {
    if (consumed.has(commentId)) continue;
    normalizedItems.push({ comment_id: source.comment_id, fragments: [], reason_if_rejected: 'sin_codigo_razonable' });
  }

  const diagnostics = {
    baja_riqueza_semantica: 0,
    sin_codigo_razonable: 0,
    comentario_redundante: 0,
    texto_demasiado_vago: 0,
  };
  for (const item of normalizedItems) {
    const fragments = Array.isArray(item?.fragments) ? item.fragments : [];
    if (fragments.length > 0) continue;
    const reason = String(item?.reason_if_rejected || '').trim();
    if (reason && Object.prototype.hasOwnProperty.call(diagnostics, reason)) {
      diagnostics[reason] += 1;
    } else {
      diagnostics.sin_codigo_razonable += 1;
    }
  }

  return {
    items: normalizedItems,
    diagnostics,
  };
}


const AI_PROVIDERS = new Set([
  'openai',
  'openrouter',
  'anthropic',
  'groq',
  'gemini',
  'ollama',
  'custom_compatible_api',
]);

async function getYouTubeConnectionByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM youtube_connections WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

function normalizeFrontendPath(rawPath = '/projects') {
  const pathValue = String(rawPath || '/projects').trim() || '/projects';
  if (!pathValue.startsWith('/')) return '/projects';
  if (pathValue.startsWith('//')) return '/projects';
  return pathValue;
}

function isPrivateIpv4Host(hostname = '') {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function validateYouTubeRedirectUri(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return { ok: false, reason: 'Debes configurar redirect_uri para OAuth de YouTube.' };
  }

  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'redirect_uri no es una URL válida.' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!['http:', 'https:'].includes(protocol)) {
    return { ok: false, reason: 'redirect_uri debe usar http o https.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (isPrivateIpv4Host(host) && host !== '127.0.0.1') {
    return {
      ok: false,
      reason: 'Google OAuth bloquea redirect_uri con IP privada (ej. 192.168.x.x). Usa localhost o un dominio HTTPS público registrado en Google Cloud Console.',
    };
  }

  if (protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1') {
    return { ok: false, reason: 'Con http solo se permite localhost/127.0.0.1 para OAuth.' };
  }

  return { ok: true };
}

function inferRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  if (!host) return '';
  const protocol = forwardedProto || 'http';
  return `${protocol}://${host}`;
}

function buildDefaultYouTubeRedirectUri(req) {
  const origin = inferRequestOrigin(req).replace(/\/$/, '');
  if (!origin) return '';
  return `${origin}/api/youtube/auth/callback`;
}

function resolveYouTubeRedirectUri(config, req) {
  const defaultRedirectUri = buildDefaultYouTubeRedirectUri(req);
  const configured = String(config?.redirectUri || '').trim();
  if (!configured) return defaultRedirectUri;

  let parsed = null;
  try {
    parsed = new URL(configured);
  } catch {
    return configured;
  }

  const frontendBase = String(config?.frontendBaseUrl || '').trim();
  const frontendOrigin = (() => {
    try {
      return frontendBase ? new URL(frontendBase).origin : '';
    } catch {
      return '';
    }
  })();

  const pointsToFrontendRoot = frontendOrigin && parsed.origin === frontendOrigin && parsed.pathname === '/';
  if (pointsToFrontendRoot && defaultRedirectUri) {
    return defaultRedirectUri;
  }

  return configured;
}

function withResolvedYouTubeRedirectUri(config, req) {
  return {
    ...config,
    redirectUri: resolveYouTubeRedirectUri(config, req),
  };
}

function parseYouTubeVideoId(rawValue = '') {
  const input = String(rawValue || '').trim();
  if (!input) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const parsed = new URL(input);
    if (parsed.hostname.includes('youtu.be')) return String(parsed.pathname || '').replace('/', '').slice(0, 11);
    const searchVideoId = String(parsed.searchParams.get('v') || '').trim();
    if (searchVideoId) return searchVideoId.slice(0, 11);
    const embedMatch = parsed.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    return embedMatch?.[1] || '';
  } catch {
    return '';
  }
}

function slugify(input = '') {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractResolvedVideoId(item = null) {
  if (!item) return '';
  if (typeof item.videoId === 'string' && item.videoId.trim()) return item.videoId.trim();
  if (typeof item.id === 'string' && item.id.trim()) return item.id.trim();
  if (item.id && typeof item.id === 'object' && typeof item.id.videoId === 'string' && item.id.videoId.trim()) {
    return item.id.videoId.trim();
  }
  return '';
}


function normalizeYouTubeIngestionInput(rawInput = {}) {
  const normalized = {
    video_url: String(rawInput.video_url || '').trim(),
    video_id: parseYouTubeVideoId(rawInput.video_id || rawInput.video_url || ''),
    channel_id: String(rawInput.channel_id || '').trim(),
    video_search_query: String(rawInput.video_search_query || '').trim(),
    keyword: String(rawInput.keyword || '').trim(),
    videos_limit: rawInput.videos_limit == null || rawInput.videos_limit === '' ? null : Math.min(50, Math.max(1, Number(rawInput.videos_limit) || 1)),
    comments_per_video: Math.min(500, Math.max(1, Number(rawInput.comments_per_video) || Number(rawInput.max_comments) || 100)),
    max_comments: Math.min(5000, Math.max(1, Number(rawInput.max_comments) || Number(rawInput.comments_per_video) || 100)),
    include_replies: Boolean(rawInput.include_replies),
    order: ['relevance', 'time'].includes(String(rawInput.order || '').trim()) ? String(rawInput.order || '').trim() : 'time',
  };

  if (!Number.isFinite(Number(normalized.comments_per_video)) || Number(normalized.comments_per_video) <= 0) {
    throw new Error('comments_per_video is required and must be greater than 0');
  }

  let inputType = 'none';
  if (normalized.video_id) inputType = 'video';
  else if (normalized.video_search_query) inputType = 'search';
  else if (normalized.keyword) inputType = 'keyword';
  else throw new Error('You must provide video_url/video_id, video_search_query or keyword');

  return {
    ...normalized,
    input_type: inputType,
    source_query: inputType === 'search' ? normalized.video_search_query : (inputType === 'keyword' ? normalized.keyword : ''),
  };
}

async function resolveVideosFromInput({ normalizedInput, config, auth }) {
  if (normalizedInput.input_type === 'video') {
    return [{ videoId: normalizedInput.video_id, title: '', channel: '', publishedAt: null, queryContext: null }];
  }

  const queryTerms = Array.from(new Set([
    ...String(normalizedInput.video_search_query || '').split(/[\n,;]+/g),
    ...String(normalizedInput.keyword || '').split(/[\n,;]+/g),
  ]
    .map((q) => q.trim())
    .filter(Boolean)));

  if (!queryTerms.length) {
    throw new Error('No se encontró una búsqueda válida para resolver videos de YouTube.');
  }

  const maxVideosPerQuery = normalizedInput.videos_limit == null ? 10 : normalizedInput.videos_limit;
  const searchOrder = normalizedInput.order === 'time' ? 'date' : 'relevance';

  const resolved = [];
  const seen = new Set();

  for (const queryTerm of queryTerms) {
    let pageToken = '';
    let collected = 0;
    while (collected < maxVideosPerQuery) {
      const searchResponse = await searchYouTubeVideos({
        config,
        auth,
        params: {
          q: queryTerm,
          type: 'video',
          maxResults: String(Math.min(50, maxVideosPerQuery - collected)),
          order: searchOrder,
          pageToken: pageToken || undefined,
          safeSearch: 'none',
          channelId: normalizedInput.channel_id || undefined,
        },
      });

      const items = Array.isArray(searchResponse?.data?.items) ? searchResponse.data.items : [];
      for (const item of items) {
        const videoId = extractResolvedVideoId(item);
        if (!videoId || seen.has(videoId)) continue;
        resolved.push({
          videoId,
          title: String(item?.title || '').trim(),
          channel: String(item?.channelTitle || '').trim(),
          publishedAt: item?.publishedAt || null,
          queryContext: queryTerm,
        });
        seen.add(videoId);
        collected += 1;
      }

      const nextToken = searchResponse?.data?.nextPageToken || '';
      if (!nextToken) break;
      pageToken = nextToken;
    }
  }

  if (!resolved.length) {
    throw new Error('No se encontraron videos para la búsqueda indicada. Ajusta la consulta o incrementa la cantidad de videos.');
  }

  return resolved;
}

async function ingestCommentsFromResolvedVideos({ resolvedVideos, normalizedInput, config, auth }) {
  const skippableReasons = new Set(['commentsDisabled', 'notFound', 'videoNotFound', 'processingFailure']);
  const rows = [];
  const stats = { videos_resolved: resolvedVideos.length, videos_processed: 0, videos_skipped: 0 };

  for (const video of resolvedVideos) {
    try {
      let pageToken = '';
      const videoRows = [];
      const pageSize = Math.min(100, normalizedInput.comments_per_video);

      while (videoRows.length < normalizedInput.comments_per_video) {
        let response;
        try {
          response = await listYouTubeCommentThreads({
            config,
            auth,
            params: {
              videoId: video.videoId,
              maxResults: String(pageSize),
              order: normalizedInput.order,
              textFormat: 'plainText',
              pageToken: pageToken || undefined,
            },
          });
        } catch (pageError) {
          const reason = String(pageError?.reason || '').trim();
          const status = Number(pageError?.statusCode || 0);
          const canRetryWithApiKey = Boolean(auth?.apiKey) && Boolean(auth?.accessToken) && (reason === 'forbidden' || status === 403);
          if (!canRetryWithApiKey) throw pageError;
          response = await listYouTubeCommentThreads({
            config,
            auth: { apiKey: auth.apiKey, accessToken: null },
            params: {
              videoId: video.videoId,
              maxResults: String(pageSize),
              order: normalizedInput.order,
              textFormat: 'plainText',
              pageToken: pageToken || undefined,
            },
          });
        }

        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        items.forEach((thread) => {
          videoRows.push({
            source: 'youtube',
            source_comment_id: thread.topLevelCommentId || thread.id,
            parent_comment_id: null,
            video_id: thread.videoId || video.videoId,
            channel_id: thread.channelId || normalizedInput.channel_id || '',
            author_name: thread.authorDisplayName || '',
            author_channel_id: thread.authorChannelId || '',
            text: thread.textOriginal || thread.textDisplay || '',
            published_at: thread.publishedAt || null,
            like_count: Number(thread.likeCount || 0),
            reply_count: Number(thread.replyCount || 0),
            source_query: video.queryContext || normalizedInput.source_query || '',
          });

          if (normalizedInput.include_replies && Array.isArray(thread.replies) && videoRows.length < normalizedInput.comments_per_video) {
            thread.replies.forEach((reply) => {
              if (videoRows.length >= normalizedInput.comments_per_video) return;
              videoRows.push({
                source: 'youtube',
                source_comment_id: reply.id,
                parent_comment_id: reply.parentId || (thread.topLevelCommentId || thread.id),
                video_id: thread.videoId || video.videoId,
                channel_id: thread.channelId || normalizedInput.channel_id || '',
                author_name: reply.authorDisplayName || '',
                author_channel_id: reply.authorChannelId || '',
                text: reply.textOriginal || reply.textDisplay || '',
                published_at: reply.publishedAt || null,
                like_count: Number(reply.likeCount || 0),
                reply_count: 0,
                source_query: video.queryContext || normalizedInput.source_query || '',
              });
            });
          }
        });

        const nextToken = response?.data?.nextPageToken || '';
        if (!nextToken) break;
        pageToken = nextToken;
      }

      rows.push(...videoRows.slice(0, normalizedInput.comments_per_video));
      stats.videos_processed += 1;
    } catch (videoError) {
      const reason = String(videoError?.reason || '').trim();
      const status = Number(videoError?.statusCode || 0);
      const message = String(videoError?.message || '').toLowerCase();
      const isPrivateForbidden = reason === 'forbidden' && (message.includes('private') || message.includes('permission'));
      const isSkippable = skippableReasons.has(reason) || status === 404 || isPrivateForbidden;
      if (!isSkippable) throw videoError;
      stats.videos_skipped += 1;
    }
  }

  return { rows, stats };
}

function normalizeFragmentTextForHash(input = '') {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeFragment(input = '') {
  return normalizeFragmentTextForHash(input)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function buildSemanticHash(input = '') {
  return crypto.createHash('sha1').update(normalizeFragmentTextForHash(input)).digest('hex');
}

function scoreDensity(text = '') {
  const tokens = tokenizeFragment(text);
  if (!tokens.length) return 0;
  const unique = new Set(tokens);
  const ratio = unique.size / Math.max(tokens.length, 1);
  const emotionalHints = ['miedo', 'dolor', 'ansiedad', 'problema', 'necesito', 'quiero', 'bloqueo', 'frustracion', 'urgente', 'rechazo'];
  const hintHits = tokens.reduce((acc, token) => (emotionalHints.includes(token) ? acc + 1 : acc), 0);
  const hintBoost = Math.min(0.25, hintHits * 0.04);
  return Math.max(0, Math.min(1, (ratio * 0.75) + hintBoost));
}

function scoreExtractionQuality(text = '') {
  const clean = String(text || '').trim();
  const length = clean.length;
  if (!length) return 0;
  const minIdeal = 30;
  const maxIdeal = 420;
  if (length < 8) return 0.08;
  if (length < minIdeal) return Math.max(0.2, length / minIdeal);
  if (length <= maxIdeal) return 0.95;
  const overflowPenalty = Math.min(0.75, (length - maxIdeal) / 1000);
  return Math.max(0.2, 0.95 - overflowPenalty);
}

function scoreRedundancy({ semanticHash, corpusHashCounts, tokenSet = new Set(), corpusTokenSets = [] }) {
  const exactCount = Number(corpusHashCounts.get(semanticHash) || 0);
  let nearDuplicate = 0;
  const sample = corpusTokenSets.slice(0, 120);
  for (const other of sample) {
    const inter = [...tokenSet].filter((token) => other.has(token)).length;
    const union = new Set([...tokenSet, ...other]).size;
    const jaccard = union ? inter / union : 0;
    if (jaccard >= 0.82) {
      nearDuplicate += 1;
      if (nearDuplicate >= 6) break;
    }
  }
  const score = Math.min(1, (exactCount > 0 ? 0.55 : 0) + (Math.min(nearDuplicate, 6) * 0.075));
  return score;
}

function enrichCommentFragments({ fragments = [], existingFragments = [] }) {
  const now = nowIso();
  const safeIncoming = Array.isArray(fragments) ? fragments : [];
  const safeExisting = Array.isArray(existingFragments) ? existingFragments : [];
  const corpus = [...safeExisting, ...safeIncoming];

  const corpusHashCounts = new Map();
  const corpusTokenSets = [];
  const sourceMarkerCount = new Map();

  corpus.forEach((fragment) => {
    const excerpt = String(fragment.excerpt || fragment.text || '').trim();
    if (!excerpt) return;
    const semanticHash = String(fragment.semantic_hash || buildSemanticHash(excerpt));
    corpusHashCounts.set(semanticHash, Number(corpusHashCounts.get(semanticHash) || 0) + 1);
    corpusTokenSets.push(new Set(tokenizeFragment(excerpt)));
    const sourceKey = `${fragment.source_comment_id || fragment.comment_id || ''}|${fragment.video_id || fragment.source_video_id || ''}|${fragment.source_run_id || ''}`;
    sourceMarkerCount.set(sourceKey, Number(sourceMarkerCount.get(sourceKey) || 0) + 1);
  });

  return safeIncoming.map((fragment) => {
    const excerpt = String(fragment.excerpt || fragment.text || '').trim();
    const semanticHash = String(fragment.semantic_hash || buildSemanticHash(excerpt));
    const tokenSet = new Set(tokenizeFragment(excerpt));
    const redundancyScore = scoreRedundancy({ semanticHash, corpusHashCounts, tokenSet, corpusTokenSets });
    const extractionQualityScore = scoreExtractionQuality(excerpt);
    const densityScore = scoreDensity(excerpt);
    const noveltyScore = Math.max(0, Math.min(1, (1 - redundancyScore) * 0.72 + densityScore * 0.28));
    const sourceMarker = `${fragment.source_comment_id || fragment.comment_id || ''}|${fragment.video_id || fragment.source_video_id || ''}|${fragment.source_run_id || ''}`;
    const sourceDispersionMarker = sourceMarkerCount.get(sourceMarker) > 1 ? 'repeated_source_pattern' : 'isolated_source_pattern';

    return {
      ...fragment,
      id: String(fragment.id || `comment_fragment_${Date.now()}_${Math.floor(Math.random() * 1000)}`),
      source_comment_id: String(fragment.source_comment_id || fragment.comment_id || ''),
      source_video_id: String(fragment.source_video_id || fragment.video_id || ''),
      source_run_id: String(fragment.source_run_id || ''),
      excerpt,
      source_comment_text: String(fragment.source_comment_text || ''),
      selection_start: Number.isFinite(Number(fragment.selection_start)) ? Number(fragment.selection_start) : null,
      selection_end: Number.isFinite(Number(fragment.selection_end)) ? Number(fragment.selection_end) : null,
      fragment_length: excerpt.length,
      source_type: String(fragment.source_type || 'manual'),
      hypothesis_id: fragment.hypothesis_id || null,
      audience_id: fragment.audience_id || null,
      semantic_hash: semanticHash,
      redundancy_score: Number(redundancyScore.toFixed(4)),
      novelty_score: Number(noveltyScore.toFixed(4)),
      density_score: Number(densityScore.toFixed(4)),
      extraction_quality_score: Number(extractionQualityScore.toFixed(4)),
      source_dispersion_marker: sourceDispersionMarker,
      ai_candidate_score: fragment.ai_candidate_score == null ? null : Number(fragment.ai_candidate_score),
      fragment_status: String(fragment.fragment_status || 'raw'),
      created_at: fragment.created_at || now,
      updated_at: now,
      coding_budget_target: 30,
      coding_budget_max: 40,
    };
  });
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(input, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function jaccardSimilarity(setA, setB) {
  const a = setA instanceof Set ? setA : new Set();
  const b = setB instanceof Set ? setB : new Set();
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function buildSemanticTokenSet(fragments = []) {
  const stopwords = new Set([
    'pero', 'aunque', 'porque', 'para', 'esto', 'esta', 'este', 'muy', 'mas', 'solo', 'como', 'cuando', 'donde',
    'sobre', 'entre', 'desde', 'hasta', 'tambien', 'también', 'entonces', 'igual', 'siempre', 'nunca', 'cada',
    'tengo', 'tener', 'hace', 'hacer', 'dice', 'dijo', 'digan', 'siento', 'sentir', 'estar', 'ser', 'fue', 'era',
    'han', 'hay', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'que', 'con', 'sin', 'por', 'sus', 'nos', 'les',
  ]);
  const counts = new Map();
  fragments.forEach((fragment) => {
    tokenizeFragment(String(fragment.excerpt || ''))
      .filter((token) => token.length >= 4 && !stopwords.has(token))
      .forEach((token) => counts.set(token, Number(counts.get(token) || 0) + 1));
  });
  return new Set(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([token]) => token),
  );
}

function buildAbstractCodeLabel(clusterItems = []) {
  const combined = clusterItems.map((item) => String(item.excerpt || '')).join(' ').toLowerCase();
  const tokenSet = buildSemanticTokenSet(clusterItems);
  const hasAny = (tokens) => tokens.some((token) => tokenSet.has(token) || combined.includes(token));

  const semanticRules = [
    { test: () => hasAny(['necesita', 'utiliza', 'interesa', 'conveniencia']), label: 'interacción instrumental' },
    { test: () => hasAny(['miedo', 'temor', 'ansiedad', 'inseguridad']), label: 'ansiedad vincular' },
    { test: () => hasAny(['distancia', 'frio', 'frío', 'indiferencia', 'desinteres']), label: 'distanciamiento afectivo' },
    { test: () => hasAny(['discusion', 'pelea', 'conflicto', 'tension']), label: 'escalada de conflicto' },
    { test: () => hasAny(['espera', 'demora', 'tarda', 'responde']), label: 'desfase comunicacional' },
    { test: () => hasAny(['control', 'celos', 'vigilancia', 'prohibe']), label: 'dinámica de control' },
    { test: () => hasAny(['culpa', 'culpable', 'responsable', 'reproche']), label: 'carga de culpa relacional' },
    { test: () => hasAny(['cansancio', 'agotamiento', 'desgaste', 'fatiga']), label: 'desgaste emocional sostenido' },
    { test: () => hasAny(['apoyo', 'escucha', 'contencion', 'acompaña']), label: 'búsqueda de sostén emocional' },
  ];

  const matched = semanticRules.find((rule) => rule.test());
  if (matched) return matched.label;

  const topTokens = Array.from(tokenSet).slice(0, 2);
  if (topTokens.length === 2) return `patrón relacional ${topTokens[0]}-${topTokens[1]}`;
  if (topTokens.length === 1) return `patrón relacional ${topTokens[0]}`;
  return 'patrón relacional emergente';
}

function isLiteralLikeCodeName(name, fragments = []) {
  const normalizedName = String(name || '').toLowerCase().trim();
  if (!normalizedName) return true;
  if (normalizedName.length > 48) return true;
  if (normalizedName.split(/\s+/).filter(Boolean).length > 6) return true;
  if (/[,.;:!?"'()]/.test(normalizedName)) return true;

  const nameTokens = new Set(tokenizeFragment(normalizedName));
  if (!nameTokens.size) return true;

  return fragments.some((fragment) => {
    const excerpt = String(fragment.excerpt || '').toLowerCase().trim();
    if (!excerpt) return false;
    if (excerpt.includes(normalizedName)) return true;
    const fragmentTokens = new Set(tokenizeFragment(excerpt));
    const overlap = [...nameTokens].filter((token) => fragmentTokens.has(token)).length;
    const ratio = overlap / Math.max(1, nameTokens.size);
    return ratio >= 0.8;
  });
}

function rankAndSelectFragmentsForCoding(fragments = []) {
  const analyzed = (Array.isArray(fragments) ? fragments : [])
    .map((fragment) => {
      const redundancy = clamp(0, safeNumber(fragment.redundancy_score, 0), 1);
      const novelty = clamp(0, safeNumber(fragment.novelty_score, 0.5), 1);
      const density = clamp(0, safeNumber(fragment.density_score, 0.5), 1);
      const quality = clamp(0, safeNumber(fragment.extraction_quality_score, 0.5), 1);
      const dispersionBoost = String(fragment.source_dispersion_marker || '').includes('repeated') ? 0.08 : 0;
      const aiCandidateScore = clamp(0, (0.4 * novelty) + (0.35 * density) + (0.2 * quality) - (0.35 * redundancy) + dispersionBoost, 1);
      return {
        ...fragment,
        redundancy_score: redundancy,
        novelty_score: novelty,
        density_score: density,
        extraction_quality_score: quality,
        ai_candidate_score: Number(aiCandidateScore.toFixed(4)),
      };
    })
    .filter((fragment) => String(fragment.excerpt || '').trim().length >= 8)
    .sort((a, b) => Number(b.ai_candidate_score || 0) - Number(a.ai_candidate_score || 0));

  const total = analyzed.length;
  if (!total) return { analyzed: [], selected: [], ratio: 0 };

  const targetMin = Math.max(1, Math.floor(total * 0.08));
  const targetMax = Math.max(targetMin, Math.floor(total * 0.15));
  const hardMax = Math.max(1, Math.floor(total * 0.2));

  const baseSelected = analyzed
    .filter((fragment) => fragment.density_score >= 0.24 && fragment.extraction_quality_score >= 0.24)
    .slice(0, hardMax);

  let selected = baseSelected.slice(0, targetMax);
  if (selected.length < targetMin) selected = analyzed.slice(0, targetMin);

  // Forzar segunda compresión si supera 25%.
  const currentRatio = selected.length / Math.max(total, 1);
  if (currentRatio > 0.25) {
    selected = selected.filter((fragment) => Number(fragment.ai_candidate_score || 0) >= 0.58);
    if (selected.length < targetMin) {
      selected = analyzed.slice(0, targetMin);
    }
  }

  const selectedHashes = new Set();
  const deduped = [];
  for (const fragment of selected) {
    const hash = String(fragment.semantic_hash || '');
    if (hash && selectedHashes.has(hash)) continue;
    selectedHashes.add(hash);
    deduped.push({ ...fragment, fragment_status: 'selected' });
  }

  const selectedIds = new Set(deduped.map((fragment) => String(fragment.id || '')));
  const analyzedWithStatus = analyzed.map((fragment) => (
    selectedIds.has(String(fragment.id || ''))
      ? { ...fragment, fragment_status: 'selected' }
      : { ...fragment, fragment_status: Number(fragment.ai_candidate_score || 0) >= 0.3 ? 'candidate' : 'rejected' }
  ));

  return {
    analyzed: analyzedWithStatus,
    selected: deduped,
    ratio: deduped.length / Math.max(total, 1),
  };
}

function buildCompressedCodesFromSelectedFragments({ selectedFragments = [], existingCodes = [] }) {
  const cfg = {
    minTextLength: 18,
    minTokenCount: 3,
    minSemanticQuality: 0.32,
    assignThreshold: 0.24,
    mergeThreshold: 0.34,
    maxClusterSize: 36,
    minClusterSize: 3,
    maxDepth: 3,
    minSplitGain: 0.07,
    minCoherence: 0.29,
    maxClusters: 60,
  };

  const raw = (Array.isArray(selectedFragments) ? selectedFragments : [])
    .map((fragment, index) => {
      const excerpt = String(fragment.excerpt || '').trim();
      const tokens = tokenizeFragment(excerpt);
      const semanticQuality = clamp(
        0,
        (0.34 * clamp(0, safeNumber(fragment.density_score, 0.4), 1))
        + (0.3 * clamp(0, safeNumber(fragment.extraction_quality_score, 0.4), 1))
        + (0.22 * clamp(0, safeNumber(fragment.novelty_score, 0.4), 1))
        + (0.14 * (Math.min(30, tokens.length) / 30)),
        1,
      );
      return {
        ...fragment,
        id: String(fragment.id || `comment_fragment_${Date.now()}_${index}`),
        excerpt,
        tokens,
        tokenSet: buildSemanticTokenSet([{ excerpt }]),
        semantic_quality: Number(semanticQuality.toFixed(4)),
      };
    })
    .filter((fragment) => (
      fragment.excerpt.length >= cfg.minTextLength
      && fragment.tokens.length >= cfg.minTokenCount
      && fragment.semantic_quality >= cfg.minSemanticQuality
    ));

  const bySemanticFingerprint = new Map();
  raw.forEach((fragment) => {
    const hash = String(fragment.semantic_hash || '');
    const key = hash || Array.from(fragment.tokenSet).sort().slice(0, 6).join('|');
    if (!key) return;
    const prev = bySemanticFingerprint.get(key);
    if (!prev || Number(fragment.semantic_quality || 0) > Number(prev.semantic_quality || 0)) {
      bySemanticFingerprint.set(key, fragment);
    }
  });
  const fragments = Array.from(bySemanticFingerprint.values());

  const avgPairwise = (items = []) => {
    if (items.length <= 1) return 1;
    let pairs = 0;
    let acc = 0;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        acc += jaccardSimilarity(items[i].tokenSet, items[j].tokenSet);
        pairs += 1;
      }
    }
    return pairs ? acc / pairs : 0;
  };

  const centroidTokenSet = (items = []) => buildSemanticTokenSet(items.map((item) => ({ excerpt: item.excerpt })));

  const scoreInterpretability = (items = []) => {
    if (!items.length) return 0;
    const counts = new Map();
    items.forEach((item) => {
      item.tokenSet.forEach((token) => counts.set(token, Number(counts.get(token) || 0) + 1));
    });
    const top = Array.from(counts.values()).sort((a, b) => b - a).slice(0, 3);
    const concentration = top.reduce((acc, value) => acc + value, 0) / Math.max(1, items.length * 3);
    return clamp(0, concentration, 1);
  };

  const buildInitialClusters = (items = []) => {
    const clusters = [];
    items.forEach((item) => {
      let best = null;
      let bestScore = 0;
      clusters.forEach((cluster) => {
        const sim = jaccardSimilarity(item.tokenSet, cluster.centroid);
        if (sim > bestScore) {
          bestScore = sim;
          best = cluster;
        }
      });
      if (best && bestScore >= cfg.assignThreshold) {
        best.items.push(item);
        best.centroid = centroidTokenSet(best.items);
      } else {
        clusters.push({
          id: `cluster_seed_${clusters.length + 1}`,
          items: [item],
          centroid: centroidTokenSet([item]),
          parent_id: null,
          depth: 0,
        });
      }
    });
    return clusters;
  };

  const refineAssignments = (seedClusters = []) => {
    if (!seedClusters.length) return [];
    let clusters = seedClusters.map((cluster) => ({ ...cluster, items: [...cluster.items] }));
    for (let iter = 0; iter < 2; iter += 1) {
      const allItems = clusters.flatMap((cluster) => cluster.items);
      const emptied = clusters.map((cluster) => ({ ...cluster, items: [] }));
      allItems.forEach((item) => {
        let bestIndex = 0;
        let bestScore = -1;
        emptied.forEach((cluster, idx) => {
          const sim = jaccardSimilarity(item.tokenSet, cluster.centroid);
          if (sim > bestScore) {
            bestScore = sim;
            bestIndex = idx;
          }
        });
        emptied[bestIndex].items.push(item);
      });
      clusters = emptied
        .filter((cluster) => cluster.items.length)
        .map((cluster) => ({ ...cluster, centroid: centroidTokenSet(cluster.items) }));
    }
    return clusters;
  };

  const splitClusterRecursively = (cluster, depth = 0) => {
    const coherence = avgPairwise(cluster.items);
    const canSplit = depth < cfg.maxDepth && cluster.items.length >= (cfg.minClusterSize * 2);
    const shouldSplit = canSplit && (cluster.items.length > cfg.maxClusterSize || coherence < cfg.minCoherence);
    if (!shouldSplit) {
      return [{ ...cluster, depth, coherence: Number(coherence.toFixed(4)), centroid: centroidTokenSet(cluster.items) }];
    }

    let seedA = cluster.items[0];
    let seedB = cluster.items[cluster.items.length - 1];
    let minSim = 1;
    for (let i = 0; i < cluster.items.length; i += 1) {
      for (let j = i + 1; j < cluster.items.length; j += 1) {
        const sim = jaccardSimilarity(cluster.items[i].tokenSet, cluster.items[j].tokenSet);
        if (sim < minSim) {
          minSim = sim;
          seedA = cluster.items[i];
          seedB = cluster.items[j];
        }
      }
    }

    const left = [];
    const right = [];
    cluster.items.forEach((item) => {
      const l = jaccardSimilarity(item.tokenSet, seedA.tokenSet);
      const r = jaccardSimilarity(item.tokenSet, seedB.tokenSet);
      if (l >= r) left.push(item);
      else right.push(item);
    });

    if (left.length < cfg.minClusterSize || right.length < cfg.minClusterSize) {
      return [{ ...cluster, depth, coherence: Number(coherence.toFixed(4)), centroid: centroidTokenSet(cluster.items) }];
    }

    const before = coherence;
    const after = ((avgPairwise(left) * left.length) + (avgPairwise(right) * right.length)) / Math.max(1, cluster.items.length);
    if ((after - before) < cfg.minSplitGain) {
      return [{ ...cluster, depth, coherence: Number(coherence.toFixed(4)), centroid: centroidTokenSet(cluster.items) }];
    }

    return [
      ...splitClusterRecursively({
        id: `${cluster.id}.a`,
        items: left,
        centroid: centroidTokenSet(left),
        parent_id: cluster.id,
      }, depth + 1),
      ...splitClusterRecursively({
        id: `${cluster.id}.b`,
        items: right,
        centroid: centroidTokenSet(right),
        parent_id: cluster.id,
      }, depth + 1),
    ];
  };

  const mergeTinyClusters = (clusters = []) => {
    const pool = clusters.map((cluster) => ({ ...cluster, items: [...cluster.items], centroid: centroidTokenSet(cluster.items) }));
    const stable = [];

    while (pool.length) {
      const cluster = pool.shift();
      if (!cluster) break;
      if (cluster.items.length >= cfg.minClusterSize) {
        stable.push(cluster);
        continue;
      }

      let bestTarget = null;
      let bestScore = 0;
      [...pool, ...stable].forEach((candidate) => {
        const sim = jaccardSimilarity(cluster.centroid, candidate.centroid);
        if (sim > bestScore) {
          bestScore = sim;
          bestTarget = candidate;
        }
      });

      if (bestTarget && bestScore >= cfg.mergeThreshold) {
        bestTarget.items.push(...cluster.items);
        bestTarget.centroid = centroidTokenSet(bestTarget.items);
      } else {
        stable.push(cluster);
      }
    }

    return stable;
  };

  const clustersSeeded = refineAssignments(buildInitialClusters(fragments));
  const clustersSplit = clustersSeeded.flatMap((cluster) => splitClusterRecursively(cluster, 0));
  let clusters = mergeTinyClusters(clustersSplit)
    .filter((cluster) => cluster.items.length >= cfg.minClusterSize)
    .slice(0, cfg.maxClusters);

  const nearestExistingCode = (items = []) => {
    const clusterSet = centroidTokenSet(items);
    let bestCode = null;
    let bestScore = 0;
    (Array.isArray(existingCodes) ? existingCodes : []).forEach((code) => {
      const codeSet = new Set(tokenizeFragment(`${code.name || ''} ${code.description || ''}`));
      const score = jaccardSimilarity(clusterSet, codeSet);
      if (score > bestScore) {
        bestScore = score;
        bestCode = code;
      }
    });
    return {
      code: bestCode ? { slug: String(bestCode.slug || ''), name: String(bestCode.name || '') } : null,
      score: Number(bestScore.toFixed(4)),
    };
  };

  const semanticClusters = clusters.map((cluster, index) => {
    const coherence = Number(avgPairwise(cluster.items).toFixed(4));
    const centroid = centroidTokenSet(cluster.items);
    const similarityToCentroid = cluster.items.map((item) => jaccardSimilarity(item.tokenSet, centroid));
    const density = Number((similarityToCentroid.reduce((acc, value) => acc + value, 0) / Math.max(1, similarityToCentroid.length)).toFixed(4));
    const interpretability = Number(scoreInterpretability(cluster.items).toFixed(4));

    let nearestNeighborSimilarity = 0;
    clusters.forEach((candidate) => {
      if (candidate.id === cluster.id) return;
      nearestNeighborSimilarity = Math.max(nearestNeighborSimilarity, jaccardSimilarity(centroid, candidate.centroid));
    });
    const separation = Number((1 - nearestNeighborSimilarity).toFixed(4));

    const quality = clamp(0, (0.36 * coherence) + (0.27 * density) + (0.22 * separation) + (0.15 * interpretability), 1);
    let clusterState = 'valido';
    if (quality < 0.56 || coherence < cfg.minCoherence) clusterState = 'debil';
    if (quality < 0.44 || coherence < 0.2) clusterState = 'ruido';

    let patternName = buildAbstractCodeLabel(cluster.items);
    if (isLiteralLikeCodeName(patternName, cluster.items)) patternName = `patrón semántico ${index + 1}`;

    const close = nearestExistingCode(cluster.items);
    let suggestedDecision = 'crear';
    if (clusterState === 'ruido') suggestedDecision = 'ignorar';
    else if (close.code && close.score >= 0.4) suggestedDecision = 'reutilizar';
    else if (cluster.items.length > cfg.maxClusterSize * 0.75 && coherence < 0.48) suggestedDecision = 'dividir';

    const sourceSpread = new Set(cluster.items.map((item) => `${item.source_video_id || ''}|${item.source_comment_id || item.id}`)).size;

    return {
      id: `semantic_cluster_${index + 1}`,
      parent_id: cluster.parent_id || null,
      depth: Number(cluster.depth || 0),
      size: cluster.items.length,
      coherence,
      density,
      separation,
      interpretability,
      quality_score: Number(quality.toFixed(4)),
      cluster_state: clusterState,
      suggested_pattern_name: patternName,
      suggested_code_type: (/(miedo|ansiedad|culpa|emocional|afectivo)/i.test(patternName) ? 'emocional' : /(vincul|comunic|interacci|relacional)/i.test(patternName) ? 'relacional' : 'emergente'),
      suggested_decision: suggestedDecision,
      confidence: Number(clamp(0.1, (0.55 * quality) + (0.25 * close.score) + (0.2 * Math.min(1, cluster.items.length / 18)), 0.95).toFixed(4)),
      source_dispersion: Number((sourceSpread / Math.max(1, cluster.items.length)).toFixed(4)),
      representative_fragments: cluster.items
        .map((item) => ({
          fragment_id: String(item.id || ''),
          excerpt: String(item.excerpt || ''),
          centroid_similarity: jaccardSimilarity(item.tokenSet, centroid),
        }))
        .sort((a, b) => b.centroid_similarity - a.centroid_similarity)
        .slice(0, 4),
      fragment_ids: cluster.items.map((item) => String(item.id || '')),
      similar_existing_code: close.code,
      existing_similarity_score: close.score,
      can_split: cluster.items.length >= (cfg.minClusterSize * 2),
      can_merge: Boolean(cluster.parent_id),
    };
  });

  const usefulClusters = semanticClusters
    .filter((cluster) => cluster.cluster_state !== 'ruido' || cluster.size >= cfg.minClusterSize + 1)
    .sort((a, b) => Number(b.quality_score || 0) - Number(a.quality_score || 0));

  const noiseClusters = semanticClusters.filter((cluster) => cluster.cluster_state === 'ruido');

  return {
    proposals: [],
    generatedCodes: [],
    semanticClusters: usefulClusters,
    noiseClusters,
    meta: {
      assistant_mode: true,
      auto_code_generation: false,
      analyzed_fragments_count: fragments.length,
      clusters_count: usefulClusters.length,
      noise_clusters_count: noiseClusters.length,
      generated_at: nowIso(),
    },
  };
}


function buildCodeGenerationAgentPrompt({ comments = [], minCodes = 20, maxCodes = 40, stage = 'final' }) {
  const compactText = (value, max = 180) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

  const normalizedComments = (Array.isArray(comments) ? comments : [])
    .map((item, index) => {
      const id = String(item.id || item.comment_id || item.source_comment_id || `comment_${index + 1}`);
      const text = String(item.text || item.comment_text || item.body || item.content || '').trim();
      return { id, text };
    })
    .filter((item) => item.text);

  const commentsBlock = normalizedComments
    .map((item, index) => `${index + 1}) ${compactText(item.text, 180)}`)
    .join('\n');

  const stageConfig = String(stage || 'final').toLowerCase() === 'chunk'
    ? {
      min: Math.max(4, Number(minCodes) || 6),
      max: Math.max(6, Number(maxCodes) || 12),
      target: 'Devuelve candidatos compactos: 6-12 códigos por bloque.',
    }
    : {
      min: Math.max(12, Number(minCodes) || 20),
      max: Math.max(Math.max(12, Number(minCodes) || 20), Number(maxCodes) || 40),
      target: 'Taxonomía final: 20-40 códigos usando saturación semántica.',
    };

  return `Tarea: crear taxonomía conceptual jerárquica desde comentarios completos.
No hacer: trazabilidad, asignación comentario-código, clasificación uno a uno.
Método: clusterizar por significado, subclusterizar solo si hay heterogeneidad real, proponer códigos y subcódigos.
Naming: 2-5 palabras, conceptual, claro, reutilizable, no literal, sin números secuenciales.
Prohibido en títulos: código, cluster, conceptual, tema, grupo, placeholders o prefijos vacíos.
El título debe comprimir la narrativa dominante (problema/emoción/conducta), no reciclar keywords sueltas.
Objetivo: detectar patrones semánticos de alta cobertura con mínimo ruido.
Límites: mínimo ${stageConfig.min} y máximo ${stageConfig.max} códigos; fusionar excesos; descartar ruido. ${stageConfig.target}
Campos por código: suggested_code_name, description, naming_rationale, coherence_level(alta|media|baja), pattern_size(bajo|medio|alto), recommendation(crear|fusionar|descartar), subclusters.
Regla: los subclusters deben ser conceptuales y no redundantes.
Formato de salida: JSON válido, sin texto adicional.
{
  "proposals": [
    {
      "suggested_code_name": "string",
      "description": "string",
      "naming_rationale": "string",
      "coherence_level": "alta|media|baja",
      "pattern_size": "bajo|medio|alto",
      "recommendation": "crear|fusionar|descartar",
      "subclusters": [
        {
          "suggested_subcode_name": "string",
          "description": "string",
          "naming_rationale": "string",
          "coherence_level": "alta|media|baja",
          "pattern_size": "bajo|medio|alto",
          "recommendation": "crear|fusionar|descartar"
        }
      ]
    }
  ]
}

COMENTARIOS A ANALIZAR (unidad: comentario completo):
${commentsBlock}`;
}

function buildCodeGenerationSynthesisPrompt({ candidates = [], minCodes = 20, maxCodes = 40 }) {
  const compactText = (value, max = 180) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

  const candidateLines = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 120)
    .map((item, index) => `${index + 1}) ${compactText(item.suggested_code_name, 90)} :: ${compactText(item.description, 140)}`)
    .join('\n');

  return `Consolida esta lista de candidatos en taxonomía final sin trazabilidad.
Objetivo: entre ${Math.max(12, Number(minCodes) || 20)} y ${Math.max(Math.max(12, Number(minCodes) || 20), Number(maxCodes) || 40)} códigos finales, maximizando cobertura semántica y deteniéndose por saturación.
Fusiona redundancias, descarta ruido y conserva solo nombres conceptuales reutilizables.
Regla de naming: títulos de 2-5 palabras, sin números secuenciales ni términos genéricos (código/cluster/conceptual/tema/grupo).
Incluye subcódigos útiles y marca recommendation.
Devuelve solo JSON con forma {"proposals":[...]} usando los mismos campos del flujo principal.

CANDIDATOS:
${candidateLines}`;
}

function flattenSubclustersAsCodeProposals(proposals = []) {
  const normalized = Array.isArray(proposals) ? proposals : [];
  const extra = [];
  normalized.forEach((proposal) => {
    const parentName = String(proposal?.suggested_code_name || proposal?.cluster_name || '').trim();
    const subclusters = Array.isArray(proposal?.subclusters) ? proposal.subclusters : [];
    subclusters.forEach((sub) => {
      const subName = String(sub?.suggested_subcode_name || sub?.cluster_name || '').trim();
      if (!subName) return;
      extra.push({
        cluster_name: String(sub.cluster_name || subName || '').trim(),
        suggested_code_name: subName,
        description: String(sub.description || `Subpatrón derivado de ${parentName || 'cluster principal'}.`).trim(),
        naming_rationale: String(sub.naming_rationale || 'Subcluster convertido en código independiente por utilidad conceptual.').trim(),
        coherence_level: String(sub.coherence_level || proposal.coherence_level || 'media').toLowerCase(),
        pattern_size: String(sub.pattern_size || 'medio').toLowerCase(),
        recommendation: String(sub.recommendation || 'crear').toLowerCase(),
        saturation_score: Number.isFinite(Number(sub.saturation_score)) ? Number(sub.saturation_score) : null,
        subclusters: [],
        generated_without_traceability: true,
        conceptual_taxonomy_stage: 'discovery',
      });
    });
  });
  return [...normalized, ...extra];
}

function dedupeCodeProposalsByName(proposals = [], maxItems = 60) {
  const normalized = Array.isArray(proposals) ? proposals : [];
  const keyOf = (name) => String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const map = new Map();
  normalized.forEach((item) => {
    const key = keyOf(item?.suggested_code_name || item?.cluster_name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, item);
      return;
    }
    const current = map.get(key);
    const currentSubCount = Array.isArray(current?.subclusters) ? current.subclusters.length : 0;
    const nextSubCount = Array.isArray(item?.subclusters) ? item.subclusters.length : 0;
    if (nextSubCount > currentSubCount) map.set(key, item);
  });

  return Array.from(map.values()).slice(0, Math.max(1, maxItems));
}

function chunkCommentsForGeneration(comments = [], chunkSize = 120) {
  const normalized = Array.isArray(comments) ? comments : [];
  const size = Math.max(20, Number(chunkSize) || 120);
  const chunks = [];
  for (let i = 0; i < normalized.length; i += size) {
    chunks.push(normalized.slice(i, i + size));
  }
  return chunks;
}

function normalizeCodeGenerationAgentOutput(parsed) {
  const bannedTitleTokens = new Set([
    'codigo', 'cluster', 'conceptual', 'tema', 'grupo', 'placeholder',
    'patron', 'relacional', 'subcluster', 'subcodigo', 'generic',
  ]);

  const conceptualRules = [
    { test: /(abandono|reemplaz|dejar|dejo|dejó|perderlo|perderla|perder)/, label: 'miedo a ser reemplazado' },
    { test: /(ignora|ignorado|indiferenc|desinteres|distancia|alejam)/, label: 'percepción de desinterés' },
    { test: /(culpa|culpable|reproche|arrepent)/, label: 'culpa por ruptura' },
    { test: /(ansiedad|angustia|temor|miedo|inseguridad)/, label: 'ansiedad vincular persistente' },
    { test: /(validac|atencion|atención|escucha|apoyo|afecto)/, label: 'búsqueda de validación afectiva' },
    { test: /(reconcili|volver|retomar|recuperar)/, label: 'deseo de reconciliación' },
    { test: /(celos|compar|nueva pareja|tercera persona)/, label: 'comparación con nueva pareja' },
    { test: /(intermitente|aparece|desaparece|inconsistente)/, label: 'apego intermitente' },
    { test: /(espera|esperanza|aun puede|aún puede|todavia|todavía)/, label: 'esperanza unilateral' },
    { test: /(control|manipul|presion|presión|exigencia)/, label: 'dinámica de control afectivo' },
  ];

  const formatAsTitle = (value) => String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');

  const looksGeneric = (value) => {
    const normalized = String(value || '').toLowerCase().trim();
    if (!normalized) return true;
    if (/\b\d+\b/.test(normalized)) return true;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 5) return true;
    const useful = tokens.filter((token) => !bannedTitleTokens.has(token));
    return useful.length < 2;
  };

  const inferConceptualFallbackName = (description, fallback = 'dinámica emocional emergente') => {
    const source = String(description || '').toLowerCase();
    if (!source) return formatAsTitle(fallback);

    const matched = conceptualRules.find((rule) => rule.test.test(source));
    if (matched) return formatAsTitle(matched.label);

    const tokens = source
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 4 && !bannedTitleTokens.has(token));
    const unique = Array.from(new Set(tokens));
    const compressed = unique.slice(0, 3).join(' ').trim();
    if (!compressed || compressed.split(/\s+/).length < 2) return formatAsTitle(fallback);
    return formatAsTitle(compressed);
  };

  const normalizeConceptualName = (raw, description, fallback = 'dinámica emocional emergente') => {
    let value = String(raw || '').toLowerCase().trim();
    value = value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();

    value = value
      .replace(/^patron\s+relacional\s*/g, '')
      .replace(/^patron\s+conceptual\s*/g, '')
      .replace(/^cluster\s+conceptual\s*/g, '')
      .replace(/^subcluster\s+conceptual\s*/g, '')
      .replace(/^codigo\s+conceptual\s*/g, '')
      .replace(/^subcodigo\s+conceptual\s*/g, '')
      .replace(/^patron\s*/g, '')
      .trim();

    const compact = value
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !bannedTitleTokens.has(token))
      .slice(0, 5)
      .join(' ')
      .trim();

    if (looksGeneric(compact)) return inferConceptualFallbackName(description, fallback);
    return formatAsTitle(compact);
  };

  const normalizeDescription = (rawDescription, normalizedName) => {
    const raw = String(rawDescription || '').replace(/\s+/g, ' ').trim();
    const name = String(normalizedName || '').replace(/\s+/g, ' ').trim();
    const rawLower = raw.toLowerCase();
    const nameLower = name.toLowerCase();

    const looksPlaceholder = !raw
      || /^(null|undefined|n\/a|na|sin descripcion|sin descripción|descripcion pendiente|descripción pendiente)$/i.test(rawLower)
      || /patron\s+conceptual\s*\d+/i.test(rawLower)
      || /codigo\s+conceptual\s*\d+/i.test(rawLower)
      || /cluster\s*\d+/i.test(rawLower)
      || rawLower === nameLower;

    if (looksPlaceholder || raw.length < 30) {
      return `Agrupa comentarios que expresan ${nameLower || 'una dinámica emocional recurrente'} como patrón semántico dominante y recurrente en el corpus analizado.`;
    }

    return raw;
  };

  const inferNameRationale = (name, description) => {
    const n = String(name || '').toLowerCase();
    const d = String(description || '').toLowerCase();
    if (/miedo|ansiedad|abandono|inseguridad/.test(n + d)) {
      return 'El nombre resume un patrón emocional dominante y reutilizable del cluster.';
    }
    if (/desinteres|indiferencia|alejamiento|distancia/.test(n + d)) {
      return 'El nombre abstrae la interpretación recurrente de pérdida o distancia en el vínculo.';
    }
    if (/validacion|apoyo|seguridad|reconex/.test(n + d)) {
      return 'El nombre representa una necesidad psicológica compartida entre múltiples comentarios.';
    }
    return 'El nombre condensa el significado dominante del cluster en una etiqueta conceptual reutilizable.';
  };

  const proposals = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return proposals.slice(0, 40).map((proposal, index) => {
    const normalizedName = normalizeConceptualName(
      proposal.suggested_code_name || proposal.cluster_name,
      proposal.description,
      `dinámica relacional emergente ${index + 1}`,
    );
    const normalizedClusterName = normalizeConceptualName(
      proposal.cluster_name || proposal.suggested_code_name,
      proposal.description,
      `dinámica relacional emergente ${index + 1}`,
    );
    const normalizedDescription = normalizeDescription(proposal.description, normalizedName);

    return {
    cluster_name: normalizedClusterName,
    suggested_code_name: normalizedName,
    description: normalizedDescription,
    naming_rationale: inferNameRationale(normalizedName, normalizedDescription),
    coherence_level: ['alta', 'media', 'baja'].includes(String(proposal.coherence_level || '').toLowerCase()) ? String(proposal.coherence_level).toLowerCase() : 'media',
    pattern_size: ['bajo', 'medio', 'alto'].includes(String(proposal.pattern_size || '').toLowerCase()) ? String(proposal.pattern_size).toLowerCase() : 'medio',
    recommendation: ['crear', 'fusionar', 'descartar'].includes(String(proposal.recommendation || '').toLowerCase()) ? String(proposal.recommendation).toLowerCase() : 'crear',
    subclusters: (Array.isArray(proposal.subclusters) ? proposal.subclusters : []).slice(0, 12).map((sub, subIndex) => ({
      cluster_name: normalizeConceptualName(sub.cluster_name || sub.suggested_subcode_name, sub.description, `subpatrón ${subIndex + 1}`),
      suggested_subcode_name: normalizeConceptualName(sub.suggested_subcode_name || sub.cluster_name, sub.description, `subnarrativa ${subIndex + 1}`),
      description: normalizeDescription(sub.description, sub.suggested_subcode_name || sub.cluster_name),
      naming_rationale: inferNameRationale(sub.suggested_subcode_name || sub.cluster_name, sub.description),
      coherence_level: ['alta', 'media', 'baja'].includes(String(sub.coherence_level || '').toLowerCase()) ? String(sub.coherence_level).toLowerCase() : 'media',
      pattern_size: ['bajo', 'medio', 'alto'].includes(String(sub.pattern_size || '').toLowerCase()) ? String(sub.pattern_size).toLowerCase() : 'medio',
      recommendation: ['crear', 'fusionar', 'descartar'].includes(String(sub.recommendation || '').toLowerCase()) ? String(sub.recommendation).toLowerCase() : 'crear',
    })),
    generated_without_traceability: true,
    conceptual_taxonomy_stage: 'discovery',
  };
  });
}

function validateGeneratedCodeProposal(proposal = {}) {
  const title = String(proposal?.suggested_code_name || '').trim();
  const description = String(proposal?.description || '').trim();
  const titleNormalized = title.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const descNormalized = description.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  const titleInvalid = !title
    || /^(null|undefined)$/i.test(titleNormalized)
    || /^(patron|patron conceptual|codigo|codigo conceptual|cluster|tema|grupo)\s*\d*$/i.test(titleNormalized)
    || /(patron\s+conceptual\s*\d+|codigo\s+conceptual\s*\d+|cluster\s*\d+)/i.test(titleNormalized)
    || title.split(/\s+/).filter(Boolean).length < 2;

  const descriptionInvalid = !description
    || /^(null|undefined)$/i.test(descNormalized)
    || descNormalized === titleNormalized
    || description.length < 30
    || /(sin descripcion|sin descripción|descripcion pendiente|descripción pendiente|placeholder)/i.test(descNormalized);

  return {
    valid: !titleInvalid && !descriptionInvalid,
    titleInvalid,
    descriptionInvalid,
  };
}

function buildCodeGenerationRepairPrompt({ proposals = [] }) {
  const compact = (value, max = 280) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const items = (Array.isArray(proposals) ? proposals : [])
    .slice(0, 60)
    .map((proposal, index) => ({
      index: index + 1,
      suggested_code_name: compact(proposal?.suggested_code_name || proposal?.cluster_name || '', 100),
      description: compact(proposal?.description || '', 260),
      coherence_level: String(proposal?.coherence_level || 'media').toLowerCase(),
      pattern_size: String(proposal?.pattern_size || 'medio').toLowerCase(),
      recommendation: String(proposal?.recommendation || 'crear').toLowerCase(),
    }));

  return [
    'Corrige la lista de códigos para que cada item tenga título y descripción de calidad analítica.',
    'Reglas obligatorias:',
    '1) suggested_code_name: concepto compacto, 2-5 palabras, semántico, sin placeholders ni números secuenciales.',
    '2) Prohibido suggested_code_name con: patrón conceptual X, código conceptual X, cluster X, código X, tema X.',
    '3) description: explicación clara del patrón semántico del código, mínimo 30 caracteres.',
    '4) description NO puede ser vacía, null, undefined, placeholder ni repetición literal del título.',
    '5) Mantén coherence_level/pattern_size/recommendation.',
    'Devuelve JSON válido con forma EXACTA: {"proposals":[{"suggested_code_name":"","description":"","coherence_level":"alta|media|baja","pattern_size":"bajo|medio|alto","recommendation":"crear|fusionar|descartar"}]}',
    'INPUT:',
    JSON.stringify({ proposals: items }),
  ].join('\n');
}

async function repairInvalidCodeGenerationProposals({ integration, proposals = [] }) {
  const normalized = Array.isArray(proposals) ? proposals : [];
  const invalid = normalized.filter((proposal) => !validateGeneratedCodeProposal(proposal).valid);
  if (!invalid.length) return normalized;

  let repaired = normalized;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = buildCodeGenerationRepairPrompt({ proposals: repaired });
    const completion = await requestAiChatCompletionWithRateLimitRetry(integration, [
      { role: 'system', content: 'Responde únicamente JSON válido, sin markdown ni texto extra.' },
      { role: 'user', content: prompt },
    ], { maxRetries: 2, baseDelayMs: 1000 });
    const parsed = extractJsonObjectFromText(completion.content);
    repaired = normalizeCodeGenerationAgentOutput(parsed);
    const pendingInvalid = repaired.filter((proposal) => !validateGeneratedCodeProposal(proposal).valid);
    if (!pendingInvalid.length) break;
  }

  return repaired;
}


async function ensureYouTubeAccessToken(connection, config) {
  if (!connection) return null;
  const expiresAtMs = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 15000) {
    return { ...connection, access_token: connection.access_token };
  }
  if (!connection.refresh_token) {
    return { ...connection, access_token: connection.access_token || '' };
  }

  const refreshed = await refreshYouTubeAccessToken({ refreshToken: connection.refresh_token, config });
  const nextAccessToken = refreshed.access_token || connection.access_token;
  const nextExpiresAt = computeFutureIso(refreshed.expires_in || 3600);
  const nextScope = refreshed.scope || connection.scope || '';
  const nextTokenType = refreshed.token_type || connection.token_type || 'Bearer';

  await pool.query(
    `UPDATE youtube_connections
     SET access_token = ?, scope = ?, token_type = ?, expires_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextAccessToken, nextScope, nextTokenType, nextExpiresAt, nowIso(), connection.id],
  );

  return {
    ...connection,
    access_token: nextAccessToken,
    scope: nextScope,
    token_type: nextTokenType,
    expires_at: nextExpiresAt,
  };
}

async function getYouTubeAuthForUser(userId, config) {
  const connection = await getYouTubeConnectionByUserId(userId);
  if (!connection) {
    if (isYouTubeApiKeyConfigured(config)) return { apiKey: config.apiKey, connection: null };
    return { apiKey: '', connection: null };
  }
  const withAccess = await ensureYouTubeAccessToken(connection, config);
  return {
    accessToken: withAccess?.access_token || '',
    apiKey: isYouTubeApiKeyConfigured(config) ? config.apiKey : '',
    connection: withAccess,
  };
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

    if (url.pathname === '/api/youtube/config' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const { config, integration } = await getYouTubeConfigForUser(user.id);
      const runtimeConfig = withResolvedYouTubeRedirectUri(config, req);
      const connection = await getYouTubeConnectionByUserId(user.id);
      return sendJson(req, res, 200, {
        data: {
          oauthConfigured: isYouTubeOAuthConfigured(runtimeConfig),
          apiKeyConfigured: isYouTubeApiKeyConfigured(runtimeConfig),
          redirectUri: runtimeConfig.redirectUri || null,
          configuredRedirectUri: config.redirectUri || null,
          scopes: runtimeConfig.scopes,
          connected: Boolean(connection),
          hasCustomConfig: Boolean(integration),
          integration: integration ? {
            api_key: integration.api_key || '',
            client_id: integration.client_id || '',
            client_secret: integration.client_secret || '',
            redirect_uri: integration.redirect_uri || '',
            scopes: integration.scopes || '',
          } : null,
          channel: connection ? {
            id: connection.youtube_channel_id || '',
            title: connection.youtube_channel_title || '',
          } : null,
        },
      });
    }


    if (url.pathname === '/api/youtube/settings' && req.method === 'PUT') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);

      const apiKey = String(body.api_key || '').trim();
      const clientId = String(body.client_id || '').trim();
      const clientSecret = String(body.client_secret || '').trim();
      const redirectUri = String(body.redirect_uri || '').trim();
      const scopes = String(body.scopes || '').trim();

      const oauthAttempted = Boolean(clientId || clientSecret || redirectUri);
      if (oauthAttempted) {
        const redirectCheck = validateYouTubeRedirectUri(redirectUri);
        if (!redirectCheck.ok) {
          return sendJson(req, res, 400, { error: redirectCheck.reason, code: 'invalid_redirect_uri' });
        }
      }

      const id = buildEntityId('youtube_integration');
      await pool.query(
        `INSERT INTO youtube_integrations (id, user_id, api_key, client_id, client_secret, redirect_uri, scopes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           api_key = excluded.api_key,
           client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           redirect_uri = excluded.redirect_uri,
           scopes = excluded.scopes,
           updated_at = excluded.updated_at`,
        [id, user.id, apiKey, clientId, clientSecret, redirectUri, scopes, nowIso(), nowIso()],
      );

      const { config, integration } = await getYouTubeConfigForUser(user.id);
      const runtimeConfig = withResolvedYouTubeRedirectUri(config, req);
      return sendJson(req, res, 200, {
        data: {
          oauthConfigured: isYouTubeOAuthConfigured(runtimeConfig),
          apiKeyConfigured: isYouTubeApiKeyConfigured(runtimeConfig),
          redirectUri: runtimeConfig.redirectUri || null,
          configuredRedirectUri: config.redirectUri || null,
          scopes: runtimeConfig.scopes,
          hasCustomConfig: Boolean(integration),
          integration: integration ? {
            api_key: integration.api_key || '',
            client_id: integration.client_id || '',
            client_secret: integration.client_secret || '',
            redirect_uri: integration.redirect_uri || '',
            scopes: integration.scopes || '',
          } : null,
        },
      });
    }


    if (url.pathname === '/api/integrations/ai/config' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const integration = await getAiIntegrationByUserId(user.id);
      return sendJson(req, res, 200, {
        data: {
          enabled: Boolean(integration && integration.provider && integration.model),
          integration: integration ? {
            provider: integration.provider || '',
            model: integration.model || '',
            api_key: integration.api_key || '',
            base_url: integration.base_url || '',
            organization: integration.organization || '',
          } : null,
        },
      });
    }

    if (url.pathname === '/api/integrations/ai/settings' && req.method === 'PUT') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const provider = String(body.provider || '').trim().toLowerCase();
      const model = normalizeAiModel(provider, body.model);
      const apiKey = String(body.api_key || '').trim();
      const baseUrl = String(body.base_url || '').trim();
      const organization = String(body.organization || '').trim();

      if (!AI_PROVIDERS.has(provider)) {
        return sendJson(req, res, 400, { error: 'Proveedor de IA inválido.' });
      }
      if (!model) {
        return sendJson(req, res, 400, { error: 'Debes especificar el modelo para la integración de IA.' });
      }

      const id = buildEntityId('ai_integration');
      await pool.query(
        `INSERT INTO ai_integrations (id, user_id, provider, model, api_key, base_url, organization, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           api_key = excluded.api_key,
           base_url = excluded.base_url,
           organization = excluded.organization,
           updated_at = excluded.updated_at`,
        [id, user.id, provider, model, apiKey, baseUrl, organization, nowIso(), nowIso()],
      );

      const integration = await getAiIntegrationByUserId(user.id);
      return sendJson(req, res, 200, {
        data: {
          enabled: Boolean(integration && integration.provider && integration.model),
          integration: integration ? {
            provider: integration.provider || '',
            model: integration.model || '',
            api_key: integration.api_key || '',
            base_url: integration.base_url || '',
            organization: integration.organization || '',
          } : null,
        },
      });
    }

    if (url.pathname === '/api/integrations/openclaw/config' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const integration = await getOpenClawIntegrationByUserId(user.id);
      return sendJson(req, res, 200, {
        data: {
          connected: Boolean(integration && integration.endpoint_url && integration.workspace_id),
          integration: integration ? {
            endpoint_url: integration.endpoint_url || '',
            workspace_id: integration.workspace_id || '',
            api_key: integration.api_key || '',
          } : null,
        },
      });
    }

    if (url.pathname === '/api/integrations/openclaw/settings' && req.method === 'PUT') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);

      const endpointUrl = String(body.endpoint_url || '').trim();
      const workspaceId = String(body.workspace_id || '').trim();
      const apiKey = String(body.api_key || '').trim();

      if (!endpointUrl || !workspaceId) {
        return sendJson(req, res, 400, { error: 'Debes indicar endpoint y workspace para OpenClaw.' });
      }

      const id = buildEntityId('openclaw_integration');
      await pool.query(
        `INSERT INTO openclaw_integrations (id, user_id, endpoint_url, workspace_id, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           endpoint_url = excluded.endpoint_url,
           workspace_id = excluded.workspace_id,
           api_key = excluded.api_key,
           updated_at = excluded.updated_at`,
        [id, user.id, endpointUrl, workspaceId, apiKey, nowIso(), nowIso()],
      );

      const integration = await getOpenClawIntegrationByUserId(user.id);
      return sendJson(req, res, 200, {
        data: {
          connected: Boolean(integration && integration.endpoint_url && integration.workspace_id),
          integration: integration ? {
            endpoint_url: integration.endpoint_url || '',
            workspace_id: integration.workspace_id || '',
            api_key: integration.api_key || '',
          } : null,
        },
      });
    }

    if (url.pathname === '/api/projects/chat/history' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      if (!projectId) return sendJson(req, res, 400, { error: 'projectId is required' });

      const project = await ensureProjectAccess(user.id, projectId);
      if (!project) return sendJson(req, res, 404, { error: 'Project not found' });

      const [rows] = await pool.query(
        `SELECT id, role, content, created_at
         FROM ai_project_chat_messages
         WHERE user_id = ? AND project_id = ?
         ORDER BY created_at ASC
         LIMIT 200`,
        [user.id, projectId],
      );
      return sendJson(req, res, 200, { data: { items: rows } });
    }

    if (url.pathname === '/api/projects/chat/messages' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const projectId = String(body?.projectId || '').trim();
      const message = String(body?.message || '').trim();

      if (!projectId) return sendJson(req, res, 400, { error: 'projectId is required' });
      if (!message) return sendJson(req, res, 400, { error: 'message is required' });

      const project = await ensureProjectAccess(user.id, projectId);
      if (!project) return sendJson(req, res, 404, { error: 'Project not found' });

      const integration = await getAiIntegrationByUserId(user.id);
      if (!integration || !integration.provider || !integration.model) {
        return sendJson(req, res, 400, {
          error: 'Debes configurar la integración de Inteligencia Artificial antes de usar Chat IA.',
        });
      }

      const [historyRows] = await pool.query(
        `SELECT role, content
         FROM ai_project_chat_messages
         WHERE user_id = ? AND project_id = ?
         ORDER BY created_at DESC
         LIMIT 12`,
        [user.id, projectId],
      );
      const orderedHistory = historyRows.reverse().map((row) => ({ role: row.role, content: row.content }));

      const projectSummary = await getProjectScopeSummary(user.id, projectId);
      const systemPrompt = buildProjectScopedSystemPrompt(project, projectSummary);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...orderedHistory,
        { role: 'user', content: message },
      ];

      const userMessageRow = {
        id: buildEntityId('ai_chat_message'),
        user_id: user.id,
        project_id: projectId,
        role: 'user',
        content: message,
        created_at: nowIso(),
      };
      await pool.query(
        `INSERT INTO ai_project_chat_messages (id, user_id, project_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userMessageRow.id, userMessageRow.user_id, userMessageRow.project_id, userMessageRow.role, userMessageRow.content, userMessageRow.created_at],
      );

      try {
        const completion = await requestAiChatCompletion(integration, messages);
        const assistantMessageRow = {
          id: buildEntityId('ai_chat_message'),
          user_id: user.id,
          project_id: projectId,
          role: 'assistant',
          content: completion.content,
          created_at: nowIso(),
        };
        await pool.query(
          `INSERT INTO ai_project_chat_messages (id, user_id, project_id, role, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [assistantMessageRow.id, assistantMessageRow.user_id, assistantMessageRow.project_id, assistantMessageRow.role, assistantMessageRow.content, assistantMessageRow.created_at],
        );

        return sendJson(req, res, 200, {
          data: {
            project: { id: project.id, name: project.name },
            user_message: userMessageRow,
            assistant_message: assistantMessageRow,
            usage: completion.usage,
          },
        });
      } catch (error) {
        return sendJson(req, res, 502, {
          error: error?.message || 'No se pudo generar respuesta de IA para este proyecto.',
        });
      }
    }

    if (url.pathname === '/api/comment-base/semantic-fragment-agent' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const batchComments = Array.isArray(body?.comments)
        ? body.comments
          .map((item) => ({
            comment_id: String(item?.comment_id || '').trim(),
            source_id: String(item?.source_id || '').trim(),
            texto_completo_del_comentario: String(item?.texto_completo_del_comentario || item?.text || '').trim(),
          }))
          .filter((item) => item.comment_id && item.source_id && item.texto_completo_del_comentario)
        : [];
      const commentId = String(body?.comment_id || '').trim();
      const sourceId = String(body?.source_id || '').trim();
      const commentText = String(body?.texto_completo_del_comentario || '').trim();
      const hasBatch = batchComments.length > 0;
      const existingCodes = Array.isArray(body?.existing_codes)
        ? body.existing_codes
          .map((code) => ({
            slug: String(code?.slug || '').trim(),
            name: String(code?.name || '').trim(),
            description: String(code?.description || '').trim(),
          }))
          .filter((code) => code.slug && code.name)
        : [];

      if (!hasBatch && (!commentId || !sourceId || !commentText)) {
        return sendJson(req, res, 400, {
          error: 'Debes enviar comments[] (batch) o comment_id + source_id + texto_completo_del_comentario.',
        });
      }
      if (!existingCodes.length) {
        return sendJson(req, res, 400, {
          error: 'Debes enviar existing_codes con los códigos existentes del codebook para autofragmentar y codificar.',
        });
      }

      const integration = await getAiIntegrationByUserId(user.id);
      if (!integration || !integration.provider || !integration.model) {
        return sendJson(req, res, 400, {
          error: 'Debes configurar la integración de Inteligencia Artificial antes de usar el agente de fragmentación.',
        });
      }

      const prompt = hasBatch
        ? buildSemanticFragmentBatchPrompt({ comments: batchComments, existingCodes })
        : buildSemanticFragmentAgentPrompt({
          commentId,
          sourceId,
          commentText,
          existingCodes,
        });

      try {
        const completion = await requestAiChatCompletionWithRateLimitRetry(integration, [
          {
            role: 'system',
            content: 'Responde exclusivamente con JSON válido, sin markdown ni texto adicional.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ]);

        const parsed = extractJsonObjectFromText(completion.content);
        if (hasBatch) {
          const normalized = normalizeSemanticFragmentBatchOutput({
            parsed,
            comments: batchComments,
            existingCodes,
          });
          return sendJson(req, res, 200, {
            data: {
              items: normalized.items.map((item) => ({
                comment_id: item.comment_id,
                reason_if_rejected: String(item?.reason_if_rejected || '').trim() || null,
                fragments: (Array.isArray(item.fragments) ? item.fragments : []).map((fragment) => ({
                  fragment_id: fragment.fragment_id,
                  fragment_text: fragment.fragment_text,
                  start_char_index: fragment.start_char_index,
                  end_char_index: fragment.end_char_index,
                  semantic_confidence: fragment.semantic_confidence,
                  assigned_code_slug: fragment.assigned_code_slug,
                  assignment_confidence: fragment.assignment_confidence,
                  assignment_rationale: fragment.assignment_rationale,
                  match_level: String(fragment?.match_level || '').trim() || 'match_probable',
                })),
              })),
              meta: {
                diagnostics: normalized.diagnostics || {
                  baja_riqueza_semantica: 0,
                  sin_codigo_razonable: 0,
                  comentario_redundante: 0,
                  texto_demasiado_vago: 0,
                },
              },
            },
          });
        }

        const normalized = normalizeSemanticFragmentAgentOutput({
          parsed,
          commentId,
          sourceId,
          commentText,
          existingCodes,
        });

        return sendJson(req, res, 200, {
          data: {
            comment_id: normalized.comment_id,
            fragments: normalized.fragments.map((fragment) => ({
              fragment_id: fragment.fragment_id,
              fragment_text: fragment.fragment_text,
              start_char_index: fragment.start_char_index,
              end_char_index: fragment.end_char_index,
              semantic_confidence: fragment.semantic_confidence,
              assigned_code_slug: fragment.assigned_code_slug,
              assignment_confidence: fragment.assignment_confidence,
              assignment_rationale: fragment.assignment_rationale,
              match_level: String(fragment?.match_level || '').trim() || 'match_probable',
            })),
            reason_if_rejected: String(normalized?.reason_if_rejected || '').trim() || null,
          },
        });
      } catch (error) {
        return sendJson(req, res, 502, {
          error: error?.message || 'No se pudo ejecutar autofragmentación y codificación con IA.',
        });
      }
    }

    if (url.pathname === '/api/youtube/auth/start' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const { config } = await getYouTubeConfigForUser(user.id);
      const runtimeConfig = withResolvedYouTubeRedirectUri(config, req);
      if (!isYouTubeOAuthConfigured(runtimeConfig)) {
        return sendJson(req, res, 400, { error: 'YouTube OAuth is not configured on backend' });
      }

      const redirectCheck = validateYouTubeRedirectUri(runtimeConfig.redirectUri);
      if (!redirectCheck.ok) {
        return sendJson(req, res, 400, { error: redirectCheck.reason, code: 'invalid_redirect_uri' });
      }

      const body = await readBody(req);
      const stateToken = crypto.randomUUID();
      const stateId = buildEntityId('youtube_oauth_state');
      const redirectPath = normalizeFrontendPath(body.redirect_path || '/projects');

      await pool.query(
        `INSERT INTO youtube_oauth_states (id, user_id, state_token, redirect_path, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [stateId, user.id, stateToken, redirectPath, computeFutureIso(10 * 60)],
      );

      return sendJson(req, res, 200, {
        data: {
          authUrl: buildYouTubeConsentUrl({ state: stateToken, config: runtimeConfig }),
        },
      });
    }

    if (url.pathname === '/api/youtube/auth/callback' && req.method === 'GET') {
      const baseConfig = getYouTubeConfig();
      const stateToken = String(url.searchParams.get('state') || '').trim();
      const code = String(url.searchParams.get('code') || '').trim();
      const errorParam = String(url.searchParams.get('error') || '').trim();

      const redirectWithStatus = (status, message = '') => {
        const frontend = baseConfig.frontendBaseUrl.replace(/\/$/, '');
        const destination = new URL('/projects', frontend);
        destination.searchParams.set('youtube', status);
        if (message) destination.searchParams.set('reason', message);
        res.writeHead(302, { Location: destination.toString() });
        res.end();
      };

      if (!stateToken) return redirectWithStatus('error', 'missing_state');
      if (errorParam) return redirectWithStatus('error', errorParam);
      if (!code) return redirectWithStatus('error', 'missing_code');

      const [stateRows] = await pool.query(
        `SELECT * FROM youtube_oauth_states
         WHERE state_token = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [stateToken],
      );
      const state = stateRows[0] || null;
      if (!state) return redirectWithStatus('error', 'invalid_state');
      if (new Date(state.expires_at).getTime() < Date.now()) {
        await pool.query('UPDATE youtube_oauth_states SET consumed_at = ? WHERE id = ?', [nowIso(), state.id]);
        return redirectWithStatus('error', 'expired_state');
      }

      const { config } = await getYouTubeConfigForUser(state.user_id);
      const runtimeConfig = withResolvedYouTubeRedirectUri(config, req);
      const tokenPayload = await exchangeYouTubeCodeForTokens({ code, config: runtimeConfig });
      const accessToken = tokenPayload.access_token || '';
      const refreshToken = tokenPayload.refresh_token || '';
      const expiresAt = computeFutureIso(tokenPayload.expires_in || 3600);
      const scope = tokenPayload.scope || runtimeConfig.scopes.join(' ');
      const tokenType = tokenPayload.token_type || 'Bearer';

      let channelId = '';
      let channelTitle = '';
      if (accessToken) {
        const channelResp = await listYouTubeChannels({
          config: runtimeConfig,
          auth: { accessToken, apiKey: '' },
          params: { mine: 'true', maxResults: 1, fields: 'items(id,snippet(title))' },
        });
        const me = channelResp?.data?.items?.[0];
        channelId = me?.id || '';
        channelTitle = me?.title || '';
      }

      const connectionId = buildEntityId('youtube_connection');
      await pool.query(
        `INSERT INTO youtube_connections (
          id, user_id, youtube_channel_id, youtube_channel_title, access_token, refresh_token,
          scope, token_type, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          youtube_channel_id = excluded.youtube_channel_id,
          youtube_channel_title = excluded.youtube_channel_title,
          access_token = excluded.access_token,
          refresh_token = CASE WHEN excluded.refresh_token = '' THEN youtube_connections.refresh_token ELSE excluded.refresh_token END,
          scope = excluded.scope,
          token_type = excluded.token_type,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`,
        [
          connectionId,
          state.user_id,
          channelId,
          channelTitle,
          accessToken,
          refreshToken,
          scope,
          tokenType,
          expiresAt,
          nowIso(),
          nowIso(),
        ],
      );

      await pool.query('UPDATE youtube_oauth_states SET consumed_at = ? WHERE id = ?', [nowIso(), state.id]);

      const frontend = runtimeConfig.frontendBaseUrl.replace(/\/$/, '');
      const destination = new URL(normalizeFrontendPath(state.redirect_path || '/projects'), frontend);
      destination.searchParams.set('youtube', 'connected');
      res.writeHead(302, { Location: destination.toString() });
      res.end();
      return;
    }

    if (url.pathname === '/api/youtube/auth/disconnect' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const { config } = await getYouTubeConfigForUser(user.id);
      const connection = await getYouTubeConnectionByUserId(user.id);
      if (connection?.refresh_token) {
        try {
          await revokeYouTubeToken({ token: connection.refresh_token, config });
        } catch {
          // noop
        }
      }
      if (connection?.access_token) {
        try {
          await revokeYouTubeToken({ token: connection.access_token, config });
        } catch {
          // noop
        }
      }
      await pool.query('DELETE FROM youtube_connections WHERE user_id = ?', [user.id]);
      return sendJson(req, res, 200, { ok: true });
    }

    const youtubeResourceMatch = url.pathname.match(/^\/api\/youtube\/(channels|videos|playlists|comment-threads|comments)$/);
    if (youtubeResourceMatch && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const resource = youtubeResourceMatch[1];
      const { config } = await getYouTubeConfigForUser(user.id);
      const auth = await getYouTubeAuthForUser(user.id, config);

      if (!auth.accessToken && !auth.apiKey) {
        return sendJson(req, res, 400, { error: 'YouTube integration is not configured. Configure API key and/or OAuth first.' });
      }

      const params = Object.fromEntries(url.searchParams.entries());
      let response;
      if (resource === 'channels') response = await listYouTubeChannels({ config, auth, params });
      if (resource === 'videos') response = await listYouTubeVideos({ config, auth, params });
      if (resource === 'playlists') response = await listYouTubePlaylists({ config, auth, params });
      if (resource === 'comment-threads') response = await listYouTubeCommentThreads({ config, auth, params });
      if (resource === 'comments') response = await listYouTubeComments({ config, auth, params });

      return sendJson(req, res, 200, {
        data: response?.data || { items: [] },
        meta: {
          etag: response?.etag || null,
          source: auth.accessToken ? 'oauth' : 'api_key',
        },
      });
    }

    if (url.pathname === '/api/comment-base/code-map-analysis-agent' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body?.project_id || '').trim();
      const campaignId = String(body?.campaign_id || '').trim();
      const code = body?.code && typeof body.code === 'object' ? body.code : {};
      const codeSlug = String(code?.slug || '').trim();
      const codeName = String(code?.name || '').trim();

      const fragments = Array.isArray(body?.fragments) ? body.fragments : [];
      const relatedCodes = Array.isArray(body?.related_codes) ? body.related_codes : [];

      if (!projectId || !campaignId || !codeSlug || !codeName) {
        return sendJson(req, res, 400, { error: 'project_id, campaign_id y code (slug, name) son requeridos.' });
      }

      const safeFragments = fragments
        .map((fragment, index) => ({
          fragment_id: String(fragment?.fragment_id || fragment?.id || `fragment_${index + 1}`).trim(),
          excerpt: String(fragment?.excerpt || fragment?.fragment_text || '').trim(),
          source_comment_id: String(fragment?.source_comment_id || fragment?.comment_id || '').trim(),
        }))
        .filter((fragment) => fragment.fragment_id && fragment.excerpt)
        .slice(0, 120);

      if (!safeFragments.length) {
        return sendJson(req, res, 400, { error: 'Se requieren fragmentos con evidencia para analizar el código.' });
      }

      const [campaignRows] = await pool.query(
        'SELECT id, project_id FROM campaigns WHERE id = ? AND project_id = ? AND user_id = ? LIMIT 1',
        [campaignId, projectId, user.id],
      );
      const campaign = campaignRows[0] || null;
      if (!campaign) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      const integration = await getAiIntegrationByUserId(user.id);
      if (!integration || !integration.provider || !integration.model) {
        return sendJson(req, res, 400, {
          error: 'Debes configurar la integración de Inteligencia Artificial antes de usar Análisis IA del mapa de códigos.',
        });
      }

      const evidence = serializeCodeMapAnalysisEvidence({
        code: {
          slug: codeSlug,
          name: codeName,
          description: String(code?.description || '').trim(),
        },
        fragments: safeFragments,
        relatedCodes,
      });

      const runSectionAgent = async ({ agentName, sectionName, focusInstruction }) => {
        const prompt = buildCodeMapAgentSectionPrompt({
          agentName,
          sectionName,
          focusInstruction,
          evidence,
        });
        const completion = await requestAiChatCompletionWithRateLimitRetry(integration, [
          { role: 'system', content: 'Responde solo con JSON válido. No uses markdown.' },
          { role: 'user', content: prompt },
        ], { maxRetries: 3, baseDelayMs: 1100 });
        const parsed = extractJsonObjectFromText(completion.content);
        return normalizeCodeMapAnalysisSection(parsed, 'Sin evidencia suficiente para esta sección.');
      };

      try {
        const dolores = await runSectionAgent({
          agentName: 'Agente de Dolores',
          sectionName: 'Dolores',
          focusInstruction: 'Analiza frustraciones, tensiones, pérdidas, miedos y sufrimiento presentes en la evidencia.',
        });
        const deseos = await runSectionAgent({
          agentName: 'Agente de Deseos',
          sectionName: 'Deseos',
          focusInstruction: 'Analiza aspiraciones, anhelos, metas emocionales o prácticas presentes en los fragmentos.',
        });
        const placeres = await runSectionAgent({
          agentName: 'Agente de Placeres',
          sectionName: 'Placeres',
          focusInstruction: 'Analiza recompensas buscadas, alivios esperados y estados positivos aspirados.',
        });
        const problemas = await runSectionAgent({
          agentName: 'Agente de Problemas',
          sectionName: 'Problemas',
          focusInstruction: 'Define el problema central y sus variaciones tal como aparece en la evidencia real.',
        });
        const soluciones = await runSectionAgent({
          agentName: 'Agente de Soluciones',
          sectionName: 'Soluciones',
          focusInstruction: 'Analiza soluciones deseadas, intentadas o implícitas en los fragmentos del código.',
        });

        const baseSections = {
          summary_absolute: '',
          dolores,
          deseos,
          placeres,
          problemas,
          soluciones,
          sintesis_final: { analysis: '', citations: [] },
        };

        const refinerPrompt = buildCodeMapAnalysisRefinerPrompt({ evidence, sections: baseSections });
        const refinedCompletion = await requestAiChatCompletionWithRateLimitRetry(integration, [
          { role: 'system', content: 'Responde solo con JSON válido. No uses markdown.' },
          { role: 'user', content: refinerPrompt },
        ], { maxRetries: 3, baseDelayMs: 1100 });
        const refinedParsed = extractJsonObjectFromText(refinedCompletion.content);
        const refinedDocument = normalizeCodeMapAnalysisDocument(refinedParsed, baseSections);

        const optimizerPrompt = buildCodeMapAnalysisOptimizerPrompt({ evidence, refinedDocument });
        const optimizedCompletion = await requestAiChatCompletionWithRateLimitRetry(integration, [
          { role: 'system', content: 'Responde solo con JSON válido. No uses markdown.' },
          { role: 'user', content: optimizerPrompt },
        ], { maxRetries: 3, baseDelayMs: 1100 });
        const optimizedParsed = extractJsonObjectFromText(optimizedCompletion.content);
        const finalDocument = normalizeCodeMapAnalysisDocument(optimizedParsed, refinedDocument);

        return sendJson(req, res, 200, {
          data: {
            ...finalDocument,
            meta: {
              provider: integration.provider,
              model: integration.model,
              fragments_used: evidence.fragments.length,
              related_codes_used: evidence.related_codes.length,
              flow: 'dolores->deseos->placeres->problemas->soluciones->refinador->optimizador_final',
            },
          },
        });
      } catch (error) {
        return sendJson(req, res, 502, {
          error: error?.message || 'No se pudo ejecutar el análisis IA del código en el mapa.',
        });
      }
    }


    if (url.pathname === '/api/comment-base/inputs' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body.project_id || '').trim();
      const campaignId = String(body.campaign_id || '').trim();
      if (!projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'project_id and campaign_id are required' });
      }

      const [campaignRows] = await pool.query('SELECT id, project_id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1', [campaignId, user.id]);
      const campaign = campaignRows[0] || null;
      if (!campaign || String(campaign.project_id) !== String(projectId)) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      let normalizedInput;
      try {
        normalizedInput = normalizeYouTubeIngestionInput(body);
      } catch (error) {
        return sendJson(req, res, 400, { error: String(error?.message || 'Invalid ingestion input') });
      }

      const inputId = buildEntityId('comment_ingestion_input');
      const createdAt = nowIso();
      await pool.query(
        `INSERT INTO comment_ingestion_inputs
          (id, user_id, project_id, campaign_id, source, name, config_json, linked_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inputId,
          user.id,
          projectId,
          campaignId,
          'youtube',
          String(body.name || normalizedInput.video_url || normalizedInput.video_id || normalizedInput.channel_id || 'YouTube input').trim(),
          JSON.stringify(normalizedInput),
          null,
          createdAt,
          createdAt,
        ],
      );

      return sendJson(req, res, 200, {
        data: {
          id: inputId,
          source: 'youtube',
          name: String(body.name || '').trim() || 'YouTube input',
          config: normalizedInput,
          created_at: createdAt,
        },
      });
    }

    if (url.pathname === '/api/comment-base/inputs' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const campaignId = String(url.searchParams.get('campaignId') || '').trim();
      if (!projectId || !campaignId) return sendJson(req, res, 400, { error: 'projectId and campaignId are required' });

      const [rows] = await pool.query(
        `SELECT * FROM comment_ingestion_inputs
         WHERE user_id = ? AND project_id = ? AND campaign_id = ?
         ORDER BY created_at DESC LIMIT 100`,
        [user.id, projectId, campaignId],
      );
      const items = rows.map((row) => ({
        ...row,
        config: (() => {
          try { return JSON.parse(row.config_json || '{}'); } catch { return {}; }
        })(),
      }));
      return sendJson(req, res, 200, { data: { items } });
    }

    if (url.pathname === '/api/comment-base/fragments/enrich' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body.project_id || '').trim();
      const campaignId = String(body.campaign_id || '').trim();
      const fragments = Array.isArray(body.fragments) ? body.fragments : [];
      const existingFragments = Array.isArray(body.existing_fragments) ? body.existing_fragments : [];

      if (!projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'project_id and campaign_id are required' });
      }

      const [campaignRows] = await pool.query('SELECT id, project_id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1', [campaignId, user.id]);
      const campaign = campaignRows[0] || null;
      if (!campaign || String(campaign.project_id) !== String(projectId)) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      const cleaned = fragments
        .map((fragment) => ({ ...fragment, excerpt: String(fragment?.excerpt || fragment?.text || '').trim() }))
        .filter((fragment) => fragment.excerpt && fragment.excerpt.length >= 8);

      const enriched = enrichCommentFragments({
        fragments: cleaned,
        existingFragments: existingFragments.slice(0, 5000),
      });

      return sendJson(req, res, 200, {
        data: {
          items: enriched,
          meta: {
            coding_budget_target: 30,
            coding_budget_max: 40,
            dropped_as_noise: Math.max(0, fragments.length - cleaned.length),
          },
        },
      });
    }

    if (url.pathname === '/api/comment-base/code-selection-agent' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body.project_id || '').trim();
      const campaignId = String(body.campaign_id || '').trim();
      const fragments = Array.isArray(body.fragments) ? body.fragments : [];
      const existingCodes = Array.isArray(body.existing_codes) ? body.existing_codes : [];

      if (!projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'project_id and campaign_id are required' });
      }

      const [campaignRows] = await pool.query('SELECT id, project_id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1', [campaignId, user.id]);
      const campaign = campaignRows[0] || null;
      if (!campaign || String(campaign.project_id) !== String(projectId)) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      const ranked = rankAndSelectFragmentsForCoding(fragments);
      const clustered = buildCompressedCodesFromSelectedFragments({
        selectedFragments: ranked.selected,
        existingCodes,
      });

      return sendJson(req, res, 200, {
        data: {
          selected_fragments: ranked.selected,
          clusters_internal: Array.isArray(clustered.semanticClusters) ? clustered.semanticClusters : [],
          semantic_clusters: Array.isArray(clustered.semanticClusters) ? clustered.semanticClusters : [],
          noise_clusters: Array.isArray(clustered.noiseClusters) ? clustered.noiseClusters : [],
          final_code_proposals: [],
          metrics: {
            total_fragments_analyzed: ranked.analyzed.length,
            total_fragments_selected: ranked.selected.length,
            compression_ratio: ranked.ratio,
            final_codes_count: 0,
            semantic_clusters_count: Array.isArray(clustered.semanticClusters) ? clustered.semanticClusters.length : 0,
            noise_clusters_count: Array.isArray(clustered.noiseClusters) ? clustered.noiseClusters.length : 0,
            assistant_mode: true,
            auto_code_generation: false,
            reason: 'semantic_cluster_assistant_requires_human_decision',
          },
          meta: clustered.meta || { assistant_mode: true, auto_code_generation: false },
        },
      });
    }

    if (url.pathname === '/api/comment-base/code-generation-agent' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body.project_id || '').trim();
      const campaignId = String(body.campaign_id || '').trim();
      const comments = Array.isArray(body.comments) ? body.comments : [];

      if (!projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'project_id and campaign_id are required' });
      }

      const [campaignRows] = await pool.query('SELECT id, project_id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1', [campaignId, user.id]);
      const campaign = campaignRows[0] || null;
      if (!campaign || String(campaign.project_id) !== String(projectId)) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      const integration = await getAiIntegrationByUserId(user.id);
      if (!integration || !integration.provider || !integration.model) {
        return sendJson(req, res, 400, {
          error: 'Debes configurar la integración de Inteligencia Artificial para usar Generar.',
          meta: {
            generated_without_traceability: true,
            unit: 'comments',
            flow: 'clusterize_comments_then_subclusterize_then_propose_codes',
            source: 'llm_required',
          },
        });
      }

      try {
        const commentsInput = Array.isArray(comments) ? comments : [];
        const [dbRows] = await pool.query(
          `SELECT id, source_comment_id, text
           FROM comment_dataset_comments
           WHERE user_id = ? AND project_id = ? AND campaign_id = ?
           ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC`,
          [user.id, projectId, campaignId],
        );

        const dbComments = (Array.isArray(dbRows) ? dbRows : []).map((row) => ({
          id: row.source_comment_id || row.id,
          text: row.text,
        }));

        const mergedById = new Map();
        [...dbComments, ...commentsInput].forEach((item, index) => {
          const id = String(item?.id || item?.comment_id || item?.source_comment_id || `comment_${index + 1}`);
          const text = String(item?.text || item?.comment_text || item?.body || item?.content || '').trim();
          if (!text) return;
          if (!mergedById.has(id)) mergedById.set(id, { id, text });
        });
        const allComments = Array.from(mergedById.values());

        if (!allComments.length) {
          return sendJson(req, res, 200, {
            data: {
              proposals: [],
              metrics: {
                comments_analyzed: 0,
                clusters_count: 0,
                top_level_clusters_count: 0,
                generated_without_traceability: true,
              },
              meta: {
                generated_without_traceability: true,
                unit: 'comments',
                flow: 'clusterize_comments_then_subclusterize_then_propose_codes',
                prompt_version: 'fase_22_3_full_db_iterative_llm',
                provider: integration.provider,
                model: integration.model,
                source: 'ai_model',
              },
            },
          });
        }

        const MIN_CODES = 20;
        const MAX_CODES = 40;
        const CHUNK_SIZE = 120;
        const MAX_CHUNKS = 18;
        const MAX_GENERATION_MS = 90000;
        const startedAtMs = Date.now();
        const commentChunks = chunkCommentsForGeneration(allComments, CHUNK_SIZE);
        let mergedProposals = [];
        let chunkCalls = 0;
        let stagnantRounds = 0;
        let previousUniqueCount = 0;
        let stoppedBy = 'all_chunks';
        let tokenBudgetError = '';

        for (const chunk of commentChunks) {
          if (chunkCalls >= MAX_CHUNKS) {
            stoppedBy = 'max_chunks';
            break;
          }

          const elapsedMs = Date.now() - startedAtMs;
          if (elapsedMs >= MAX_GENERATION_MS) {
            stoppedBy = 'max_generation_time';
            break;
          }

          const prompt = buildCodeGenerationAgentPrompt({ comments: chunk, minCodes: 6, maxCodes: 12, stage: 'chunk' });
          let completion;
          try {
            completion = await requestAiChatCompletionWithRateLimitRetry(integration, [
              { role: 'system', content: 'Responde únicamente JSON válido, sin markdown ni texto extra.' },
              { role: 'user', content: prompt },
            ], { maxRetries: 2, baseDelayMs: 1200 });
          } catch (error) {
            if (isDailyTokenLimitError(error)) {
              tokenBudgetError = String(error?.message || 'daily_token_limit_reached');
              stoppedBy = 'daily_token_limit';
              break;
            }
            throw error;
          }
          const parsed = extractJsonObjectFromText(completion.content);
          const normalizedChunkProposals = normalizeCodeGenerationAgentOutput(parsed);
          const repairedChunkProposals = await repairInvalidCodeGenerationProposals({
            integration,
            proposals: normalizedChunkProposals,
          });
          const chunkProposals = flattenSubclustersAsCodeProposals(repairedChunkProposals);
          mergedProposals = dedupeCodeProposalsByName([...mergedProposals, ...chunkProposals], 160);
          chunkCalls += 1;

          const uniqueCount = mergedProposals.length;
          const growth = uniqueCount - previousUniqueCount;
          if (growth <= 1) stagnantRounds += 1;
          else stagnantRounds = 0;
          previousUniqueCount = uniqueCount;

          const saturationReached = uniqueCount >= 30 && stagnantRounds >= 3;
          if (saturationReached) {
            stoppedBy = 'semantic_saturation';
            break;
          }
        }

        let finalProposals = mergedProposals;
        if (mergedProposals.length > MAX_CODES) {
          const synthesisPrompt = buildCodeGenerationSynthesisPrompt({
            candidates: mergedProposals,
            minCodes: MIN_CODES,
            maxCodes: MAX_CODES,
          });
          let synthesized;
          try {
            synthesized = await requestAiChatCompletionWithRateLimitRetry(integration, [
              { role: 'system', content: 'Responde únicamente JSON válido, sin markdown ni texto extra.' },
              { role: 'user', content: synthesisPrompt },
            ], { maxRetries: 3, baseDelayMs: 1200 });
          } catch (error) {
            if (isDailyTokenLimitError(error)) {
              tokenBudgetError = String(error?.message || 'daily_token_limit_reached');
              stoppedBy = 'daily_token_limit';
              finalProposals = dedupeCodeProposalsByName(flattenSubclustersAsCodeProposals(mergedProposals), MAX_CODES);
              synthesized = null;
            } else {
              throw error;
            }
          }
          if (synthesized) {
            const parsedSynthesis = extractJsonObjectFromText(synthesized.content);
            const normalizedSynthesized = normalizeCodeGenerationAgentOutput(parsedSynthesis);
            const repairedSynthesized = await repairInvalidCodeGenerationProposals({
              integration,
              proposals: normalizedSynthesized,
            });
            const synthesizedProposals = flattenSubclustersAsCodeProposals(repairedSynthesized);
            finalProposals = dedupeCodeProposalsByName(synthesizedProposals, MAX_CODES);
          }
        } else {
          finalProposals = dedupeCodeProposalsByName(flattenSubclustersAsCodeProposals(mergedProposals), MAX_CODES);
        }

        finalProposals = dedupeCodeProposalsByName(
          await repairInvalidCodeGenerationProposals({
            integration,
            proposals: finalProposals,
          }),
          MAX_CODES,
        );

        return sendJson(req, res, 200, {
          data: {
            proposals: finalProposals,
            metrics: {
              comments_analyzed: allComments.length,
              chunks_analyzed: chunkCalls,
              clusters_count: finalProposals.length,
              top_level_clusters_count: finalProposals.length,
              generated_without_traceability: true,
              semantic_saturation_reached: finalProposals.length >= 30,
              generation_elapsed_ms: Date.now() - startedAtMs,
              stop_reason: stoppedBy,
              token_budget_limited: stoppedBy === 'daily_token_limit',
            },
            meta: {
              generated_without_traceability: true,
              unit: 'comments',
              flow: 'clusterize_comments_then_subclusterize_then_propose_codes',
              prompt_version: 'fase_22_3_full_db_iterative_llm',
              provider: integration.provider,
              model: integration.model,
              source: 'ai_model',
              chunk_size: CHUNK_SIZE,
              max_chunks: MAX_CHUNKS,
              max_generation_ms: MAX_GENERATION_MS,
              token_budget_error: tokenBudgetError || null,
            },
          },
        });
      } catch (error) {
        return sendJson(req, res, 502, {
          error: error?.message || 'No se pudo generar clusters/códigos con el modelo IA.',
          meta: {
            generated_without_traceability: true,
            unit: 'comments',
            flow: 'clusterize_comments_then_subclusterize_then_propose_codes',
            source: 'llm_only_no_fallback',
          },
        });
      }
    }


    if (url.pathname === '/api/comment-base/code-map-analysis-chat' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body?.project_id || '').trim();
      const campaignId = String(body?.campaign_id || '').trim();
      const question = String(body?.question || '').trim();
      const session = body?.analysis_session && typeof body.analysis_session === 'object' ? body.analysis_session : null;

      if (!projectId || !campaignId || !question || !session) {
        return sendJson(req, res, 400, { error: 'project_id, campaign_id, question y analysis_session son requeridos.' });
      }

      const [campaignRows] = await pool.query(
        'SELECT id, project_id FROM campaigns WHERE id = ? AND project_id = ? AND user_id = ? LIMIT 1',
        [campaignId, projectId, user.id],
      );
      const campaign = campaignRows[0] || null;
      if (!campaign) return sendJson(req, res, 404, { error: 'Campaign not found' });

      const integration = await getAiIntegrationByUserId(user.id);
      if (!integration || !integration.provider || !integration.model) {
        return sendJson(req, res, 400, { error: 'Debes configurar la integración de IA para usar el chat analítico por código.' });
      }

      const relevantEvidence = selectRelevantFragmentsForCodeMapChat({
        fragments: Array.isArray(session?.fragments_snapshot) ? session.fragments_snapshot : [],
        question,
        limit: 8,
      });

      try {
        const prompt = buildCodeMapAnalysisChatPrompt({ session, question, relevantEvidence });
        const completion = await requestAiChatCompletionWithRateLimitRetry(integration, [
          { role: 'system', content: 'Responde solo con JSON válido. No uses markdown.' },
          { role: 'user', content: prompt },
        ], { maxRetries: 3, baseDelayMs: 900 });

        const parsed = extractJsonObjectFromText(completion.content) || {};
        const normalizedCitations = (Array.isArray(parsed?.citations) ? parsed.citations : [])
          .slice(0, 8)
          .map((item) => ({
            fragment_id: String(item?.fragment_id || '').trim(),
            excerpt: compactAnalysisText(item?.excerpt || '', 220),
            code_slug: String(item?.code_slug || '').trim() || String(session?.code_slug || '').trim(),
          }))
          .filter((item) => item.fragment_id && item.excerpt);

        return sendJson(req, res, 200, {
          data: {
            answer: compactAnalysisText(parsed?.answer || '', 5000),
            memory_summary: compactAnalysisText(parsed?.memory_summary || session?.memory_summary || '', 900),
            citations: normalizedCitations,
            meta: {
              provider: integration.provider,
              model: integration.model,
              evidence_used: relevantEvidence.length,
            },
          },
        });
      } catch (error) {
        return sendJson(req, res, 502, {
          error: error?.message || 'No se pudo generar respuesta del chat analítico del código.',
        });
      }
    }


    if (url.pathname === '/api/comment-base/code-proposal-reviews' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      return sendJson(req, res, 410, {
        error: 'Code proposal reviews are disabled in comments mode.',
        code_generation_disabled: true,
        reason: 'comment_mode_fragment_to_code_disabled',
      });
    }

    if (url.pathname === '/api/comment-base/code-proposal-reviews' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      return sendJson(req, res, 200, {
        data: {
          items: [],
          summaryByCode: {},
          meta: {
            code_generation_disabled: true,
            reason: 'comment_mode_fragment_to_code_disabled',
          },
        },
      });
    }

    if (url.pathname === '/api/comment-base/ingest' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      const projectId = String(body.project_id || '').trim();
      const campaignId = String(body.campaign_id || '').trim();
      if (!projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'project_id and campaign_id are required' });
      }

      const [campaignRows] = await pool.query(
        'SELECT id, project_id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1',
        [campaignId, user.id],
      );
      const campaign = campaignRows[0] || null;
      if (!campaign || String(campaign.project_id) !== String(projectId)) {
        return sendJson(req, res, 404, { error: 'Campaign not found' });
      }

      const requestedInputId = String(body.input_id || '').trim();
      let inputId = requestedInputId;
      let normalizedInput = null;

      if (requestedInputId) {
        const [inputRows] = await pool.query(
          `SELECT * FROM comment_ingestion_inputs
           WHERE id = ? AND user_id = ? AND project_id = ? AND campaign_id = ? LIMIT 1`,
          [requestedInputId, user.id, projectId, campaignId],
        );
        const savedInput = inputRows[0] || null;
        if (!savedInput) return sendJson(req, res, 404, { error: 'Input not found' });
        try {
          normalizedInput = normalizeYouTubeIngestionInput(JSON.parse(savedInput.config_json || '{}'));
        } catch (error) {
          return sendJson(req, res, 400, { error: String(error?.message || 'Invalid saved ingestion input') });
        }
      } else {
        try {
          normalizedInput = normalizeYouTubeIngestionInput(body);
        } catch (error) {
          return sendJson(req, res, 400, { error: String(error?.message || 'Invalid ingestion input') });
        }
      }

      if (!inputId) {
        inputId = buildEntityId('comment_ingestion_input');
        await pool.query(
          `INSERT INTO comment_ingestion_inputs
            (id, user_id, project_id, campaign_id, source, name, config_json, linked_run_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            inputId,
            user.id,
            projectId,
            campaignId,
            'youtube',
            String(body.name || normalizedInput.video_url || normalizedInput.video_id || normalizedInput.channel_id || 'YouTube input').trim(),
            JSON.stringify(normalizedInput),
            null,
            nowIso(),
            nowIso(),
          ],
        );
      }

      const runId = buildEntityId('comment_ingestion_run');
      const startedAt = nowIso();
      await pool.query(
        `INSERT INTO comment_ingestion_runs
          (id, user_id, project_id, campaign_id, source, source_job, input_id, source_query_json, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          user.id,
          projectId,
          campaignId,
          'youtube',
          'youtube_comments_ingestion',
          inputId,
          JSON.stringify(normalizedInput),
          'running',
          startedAt,
          startedAt,
          startedAt,
        ],
      );

      try {
        const { config } = await getYouTubeConfigForUser(user.id);
        const auth = await getYouTubeAuthForUser(user.id, config);
        if (!auth.accessToken && !auth.apiKey) {
          throw new Error('YouTube integration is not configured. Configure API key and/or OAuth first.');
        }

        const resolvedVideos = await resolveVideosFromInput({ normalizedInput, config, auth });
        const { rows, stats } = await ingestCommentsFromResolvedVideos({ resolvedVideos, normalizedInput, config, auth });
        if (!rows.length) {
          throw new Error(`No se pudieron importar comentarios. Videos resueltos: ${stats.videos_resolved}, procesados: ${stats.videos_processed}, omitidos: ${stats.videos_skipped}.`);
        }
        const slicedRows = rows;

        const audienceId = String(body.audience_id || '').trim() || null;

        const hypothesisId = String(body.hypothesis_id || '').trim() || null;
        let importedCount = 0;
        for (const row of slicedRows) {
          const id = buildEntityId('comment_record');
          await pool.query(
            `INSERT INTO comment_dataset_comments
              (id, user_id, project_id, campaign_id, audience_id, hypothesis_id, source, source_comment_id, parent_comment_id,
               video_id, channel_id, author_name, author_channel_id, text, published_at, like_count, reply_count,
               source_job, source_run_id, source_input_id, source_query_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, project_id, campaign_id, source, source_comment_id) DO UPDATE SET
               parent_comment_id = excluded.parent_comment_id,
               video_id = excluded.video_id,
               channel_id = excluded.channel_id,
               author_name = excluded.author_name,
               author_channel_id = excluded.author_channel_id,
               text = excluded.text,
               published_at = excluded.published_at,
               like_count = excluded.like_count,
               reply_count = excluded.reply_count,
               source_job = excluded.source_job,
               source_run_id = excluded.source_run_id,
               source_input_id = excluded.source_input_id,
               source_query_json = excluded.source_query_json,
               updated_at = excluded.updated_at`,
            [
              id,
              user.id,
              projectId,
              campaignId,
              audienceId,
              hypothesisId,
              row.source,
              row.source_comment_id,
              row.parent_comment_id,
              row.video_id,
              row.channel_id,
              row.author_name,
              row.author_channel_id,
              row.text,
              row.published_at,
              row.like_count,
              row.reply_count,
              'youtube_comments_ingestion',
              runId,
              inputId,
              JSON.stringify(normalizedInput),
              nowIso(),
              nowIso(),
            ],
          );
          importedCount += 1;
        }

        await pool.query(
          `UPDATE comment_ingestion_runs
           SET status = ?, comments_count = ?, imported_count = ?, completed_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            'succeeded',
            slicedRows.length,
            importedCount,
            nowIso(),
            nowIso(),
            runId,
          ],
        );

        await pool.query(
          `UPDATE comment_ingestion_runs
           SET error_message = ?, updated_at = ?
           WHERE id = ?`,
          [JSON.stringify({
            input_type: normalizedInput.input_type,
            videos_resolved: stats.videos_resolved,
            videos_processed: stats.videos_processed,
            videos_skipped: stats.videos_skipped,
          }), nowIso(), runId],
        );

        await pool.query(
          `UPDATE comment_ingestion_inputs SET linked_run_id = ?, updated_at = ? WHERE id = ?`,
          [runId, nowIso(), inputId],
        );

        return sendJson(req, res, 200, {
          data: {
            run_id: runId,
            status: 'succeeded',
            comments_count: slicedRows.length,
            imported_count: importedCount,
          },
        });
      } catch (error) {
        await pool.query(
          `UPDATE comment_ingestion_runs
           SET status = ?, error_message = ?, completed_at = ?, updated_at = ?
           WHERE id = ?`,
          ['failed', String(error?.message || 'Ingestion failed'), nowIso(), nowIso(), runId],
        );
        await pool.query(
          `UPDATE comment_ingestion_inputs SET linked_run_id = ?, updated_at = ? WHERE id = ?`,
          [runId, nowIso(), inputId],
        );
        return sendJson(req, res, 500, { error: String(error?.message || 'Ingestion failed') });
      }
    }

    if (url.pathname === '/api/comment-base/table' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const campaignId = String(url.searchParams.get('campaignId') || '').trim();
      if (!projectId || !campaignId) return sendJson(req, res, 400, { error: 'projectId and campaignId are required' });

      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const q = String(url.searchParams.get('q') || '').trim();

      const where = ['user_id = ?', 'project_id = ?', 'campaign_id = ?'];
      const values = [user.id, projectId, campaignId];
      if (q) {
        where.push('(text LIKE ? OR author_name LIKE ? OR source_comment_id LIKE ?)');
        values.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const [rows] = await pool.query(
        `SELECT * FROM comment_dataset_comments WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC LIMIT ? OFFSET ?`,
        [...values, limit, offset],
      );
      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM comment_dataset_comments WHERE ${where.join(' AND ')}`,
        values,
      );
      return sendJson(req, res, 200, {
        data: {
          items: rows,
          total: Number(countRows?.[0]?.total || 0),
          limit,
          offset,
        },
      });
    }

    if (url.pathname === '/api/comment-base/runs' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const campaignId = String(url.searchParams.get('campaignId') || '').trim();
      if (!projectId || !campaignId) return sendJson(req, res, 400, { error: 'projectId and campaignId are required' });

      const [rows] = await pool.query(
        `SELECT r.*, i.name AS input_name, i.config_json AS input_config_json
         FROM comment_ingestion_runs r
         LEFT JOIN comment_ingestion_inputs i ON i.id = r.input_id
         WHERE r.user_id = ? AND r.project_id = ? AND r.campaign_id = ?
         ORDER BY r.created_at DESC LIMIT 30`,
        [user.id, projectId, campaignId],
      );
      const items = rows.map((row) => ({
        ...row,
        input_config: (() => {
          try { return JSON.parse(row.input_config_json || '{}'); } catch { return {}; }
        })(),
      }));
      return sendJson(req, res, 200, { data: { items } });
    }

    const deleteRunMatch = url.pathname.match(/^\/api\/comment-base\/runs\/([^/]+)$/);
    if (deleteRunMatch && req.method === 'DELETE') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const runId = String(deleteRunMatch[1] || '').trim();
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const campaignId = String(url.searchParams.get('campaignId') || '').trim();
      if (!runId || !projectId || !campaignId) {
        return sendJson(req, res, 400, { error: 'run id, projectId and campaignId are required' });
      }

      const [runRows] = await pool.query(
        `SELECT * FROM comment_ingestion_runs WHERE id = ? AND user_id = ? AND project_id = ? AND campaign_id = ? LIMIT 1`,
        [runId, user.id, projectId, campaignId],
      );
      const run = runRows[0] || null;
      if (!run) return sendJson(req, res, 404, { error: 'Run not found' });

      await pool.query('DELETE FROM comment_dataset_comments WHERE user_id = ? AND project_id = ? AND campaign_id = ? AND source_run_id = ?', [user.id, projectId, campaignId, runId]);
      if (run.input_id) {
        await pool.query('DELETE FROM comment_ingestion_inputs WHERE id = ? AND user_id = ? AND project_id = ? AND campaign_id = ?', [run.input_id, user.id, projectId, campaignId]);
      }
      await pool.query('DELETE FROM comment_ingestion_runs WHERE id = ? AND user_id = ? AND project_id = ? AND campaign_id = ?', [runId, user.id, projectId, campaignId]);

      return sendJson(req, res, 200, { data: { deleted_run_id: runId, deleted_input_id: run.input_id || null } });
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
          targetType: row.target_type || null,
          targetEntityId: row.target_id || null,
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


    if (url.pathname === '/api/interviews/cloud/document' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      const nodeId = String(url.searchParams.get('nodeId') || '').trim();
      if (!nodeId) {
        sendJson(req, res, 400, { error: 'nodeId is required' });
        return;
      }
      const node = await getCloudNodeById(nodeId, user.id);
      if (!node || node.type !== 'file') {
        sendJson(req, res, 404, { error: 'Document not found' });
        return;
      }

      const [contextRows] = await pool.query(
        `WITH RECURSIVE ancestors(id, depth) AS (
           SELECT id, 0 FROM cloud_nodes WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT p.id, ancestors.depth + 1
           FROM ancestors
           JOIN cloud_nodes c ON c.id = ancestors.id
           JOIN cloud_nodes p ON p.id = c.parent_id AND p.user_id = c.user_id
           WHERE ancestors.depth < 20
           UNION ALL
           SELECT e.parent_id, ancestors.depth + 1
           FROM ancestors
           JOIN cloud_edges e ON e.child_id = ancestors.id AND e.user_id = ?
           WHERE ancestors.depth < 20
         )
         SELECT
           COALESCE(st.id, sc.id) AS interview_id,
           COALESCE(st.client_id, sc.client_id) AS client_id,
           COALESCE(st.project_id, sc.project_id) AS project_id,
           COALESCE(st.campaign_id, sc.campaign_id) AS campaign_id
         FROM ancestors a
         JOIN cloud_nodes n ON n.id = a.id AND n.user_id = ?
         LEFT JOIN interview_sessions st
           ON st.id = n.target_id
          AND n.target_type = 'interview_session'
          AND st.user_id = n.user_id
         LEFT JOIN interview_sessions sc
           ON n.canonical_key = ('interviews_cloud_session:' || sc.campaign_id || ':' || sc.id)
          AND sc.user_id = n.user_id
         WHERE st.id IS NOT NULL OR sc.id IS NOT NULL
         ORDER BY a.depth ASC
         LIMIT 1`,
        [nodeId, user.id, user.id, user.id],
      );
      const context = contextRows[0] || {};
      const parsed = readInterviewDocumentForNode(node);
      sendJson(req, res, 200, {
        data: {
          node_id: node.id,
          name: node.name,
          mime_type: node.mime_type,
          size: node.size,
          interview_id: context.interview_id || null,
          client_id: context.client_id || null,
          project_id: context.project_id || node.project_id,
          campaign_id: context.campaign_id || null,
          format: parsed.format,
          warning: parsed.warning || null,
          text: parsed.text || '',
        },
      });
      return;
    }

    if (url.pathname === '/api/interviews/fragments' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const documentNodeId = String(url.searchParams.get('documentNodeId') || '').trim();
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      const campaignId = String(url.searchParams.get('campaignId') || '').trim();

      if (documentNodeId) {
        const [rows] = await pool.query(
          `SELECT * FROM interview_semantic_fragments
           WHERE user_id = ? AND document_node_id = ?
           ORDER BY created_at DESC`,
          [user.id, documentNodeId],
        );
        sendJson(req, res, 200, { data: rows });
        return;
      }

      if (projectId) {
        const [rows] = campaignId
          ? await pool.query(
            `SELECT * FROM interview_semantic_fragments
             WHERE user_id = ? AND project_id = ? AND (campaign_id = ? OR campaign_id IS NULL)
             ORDER BY created_at DESC`,
            [user.id, projectId, campaignId],
          )
          : await pool.query(
            `SELECT * FROM interview_semantic_fragments
             WHERE user_id = ? AND project_id = ?
             ORDER BY created_at DESC`,
            [user.id, projectId],
          );
        sendJson(req, res, 200, { data: rows });
        return;
      }

      return sendJson(req, res, 400, { error: 'documentNodeId o projectId son obligatorios' });
    }

    if (url.pathname === '/api/interviews/fragments' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const documentNodeId = String(body?.document_node_id || '').trim() || null;
      const interviewSessionId = String(body?.interview_session_id || '').trim() || null;
      const sourceType = String(body?.source_type || '').trim().toLowerCase();
      const selectedText = String(body?.selected_text || '').trim();
      if ((!documentNodeId && !interviewSessionId) || !['selection', 'manual'].includes(sourceType) || !selectedText) {
        return sendJson(req, res, 400, { error: 'document_node_id o interview_session_id, source_type(selection|manual) y selected_text son obligatorios' });
      }

      let node = null;
      let context = {};

      if (documentNodeId) {
        node = await getCloudNodeById(documentNodeId, user.id);
        if (!node || node.type !== 'file') return sendJson(req, res, 404, { error: 'Document not found' });

        const [contextRows] = await pool.query(
          `WITH RECURSIVE ancestors(id, depth) AS (
             SELECT id, 0 FROM cloud_nodes WHERE id = ? AND user_id = ?
             UNION ALL
             SELECT p.id, ancestors.depth + 1
             FROM ancestors
             JOIN cloud_nodes c ON c.id = ancestors.id
             JOIN cloud_nodes p ON p.id = c.parent_id AND p.user_id = c.user_id
             WHERE ancestors.depth < 20
             UNION ALL
             SELECT e.parent_id, ancestors.depth + 1
             FROM ancestors
             JOIN cloud_edges e ON e.child_id = ancestors.id AND e.user_id = ?
             WHERE ancestors.depth < 20
           )
           SELECT
             COALESCE(st.id, sc.id) AS interview_id,
             COALESCE(st.client_id, sc.client_id) AS client_id,
             COALESCE(st.project_id, sc.project_id) AS project_id,
             COALESCE(st.campaign_id, sc.campaign_id) AS campaign_id
           FROM ancestors a
           JOIN cloud_nodes n ON n.id = a.id AND n.user_id = ?
           LEFT JOIN interview_sessions st
             ON st.id = n.target_id
            AND n.target_type = 'interview_session'
            AND st.user_id = n.user_id
           LEFT JOIN interview_sessions sc
             ON n.canonical_key = ('interviews_cloud_session:' || sc.campaign_id || ':' || sc.id)
            AND sc.user_id = n.user_id
           WHERE st.id IS NOT NULL OR sc.id IS NOT NULL
           ORDER BY a.depth ASC
           LIMIT 1`,
          [documentNodeId, user.id, user.id, user.id],
        );
        context = contextRows[0] || {};
      }

      if (interviewSessionId) {
        const [sessionRows] = await pool.query(
          'SELECT id AS interview_id, project_id, campaign_id FROM interview_sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [interviewSessionId, user.id],
        );
        const session = sessionRows[0];
        if (!session) return sendJson(req, res, 404, { error: 'Interview session not found' });
        context = { ...context, ...session };
      }

      const fragment = {
        id: buildEntityId('fragment'),
        user_id: user.id,
        project_id: context.project_id || node?.project_id,
        campaign_id: context.campaign_id || null,
        interview_session_id: interviewSessionId || context.interview_id || null,
        document_node_id: documentNodeId,
        source_type: sourceType,
        selected_text: selectedText,
        start_offset: Number.isFinite(Number(body?.start_offset)) ? Number(body.start_offset) : null,
        end_offset: Number.isFinite(Number(body?.end_offset)) ? Number(body.end_offset) : null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      await pool.query(
        `INSERT INTO interview_semantic_fragments
         (id, user_id, project_id, campaign_id, interview_session_id, document_node_id, source_type, selected_text, start_offset, end_offset, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fragment.id,
          fragment.user_id,
          fragment.project_id,
          fragment.campaign_id,
          fragment.interview_session_id,
          fragment.document_node_id,
          fragment.source_type,
          fragment.selected_text,
          fragment.start_offset,
          fragment.end_offset,
          fragment.created_at,
          fragment.updated_at,
        ],
      );
      sendJson(req, res, 201, { data: fragment });
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
        await pool.query('INSERT INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)', [buildEntityId('hypothesis_video_link'), hyp.id, video.id, contextAudienceId, user.id]);
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
        [buildEntityId('interview_client'), projectId, campaignId, body.audience_id || null, user.id, body.name || 'Cliente', body.contact || null, body.notes || null, now, now],
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
        const [rows] = await pool.query(
          `SELECT ih.*, a.name AS audience_name, c.name AS related_client_name, f.title AS interview_form_title
           FROM interview_hypotheses ih
           LEFT JOIN audiences a ON a.id = ih.audience_id
           LEFT JOIN interview_clients c ON c.id = ih.related_client_id
           LEFT JOIN interview_forms f ON f.id = ih.interview_form_id
           WHERE ih.user_id = ? AND ih.project_id = ? AND ih.campaign_id = ?
           ORDER BY ih.created_at DESC`,
          [user.id, projectId, campaignId],
        );
        return sendJson(req, res, 200, { data: rows.map(parseInterviewHypothesisRow) });
      }
      const body = await readBody(req);
      const now = nowIso();
      const validationMetricConfig = normalizeInterviewHypothesisValidationConfig(body.validation_metric_config);
      await pool.query(
        `INSERT INTO interview_hypotheses (
          id, project_id, campaign_id, audience_id, segment, related_client_id, interview_form_id,
          user_id, type, title, description, status, last_evaluated_at,
          min_interviews, validation_metric_config,
          evaluated_interviews_count, problem_score_avg, solution_score_avg, validation_result,
          experiment_notes, observations, next_actions,
          created_at, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          buildEntityId('interview_hypothesis'),
          projectId,
          campaignId,
          body.audience_id || null,
          body.segment || null,
          body.related_client_id || null,
          body.interview_form_id || null,
          user.id,
          body.type || 'problema',
          body.title || 'Hipótesis entrevistas',
          body.description || null,
          body.status || 'exploracion',
          body.last_evaluated_at || null,
          body.min_interviews ?? null,
          validationMetricConfig ? JSON.stringify(validationMetricConfig) : null,
          body.evaluated_interviews_count ?? null,
          body.problem_score_avg ?? null,
          body.solution_score_avg ?? null,
          body.validation_result || 'no evaluada',
          body.experiment_notes || null,
          body.observations || null,
          body.next_actions || null,
          now,
          now,
        ],
      );
      const [rows] = await pool.query('SELECT * FROM interview_hypotheses WHERE user_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [user.id, campaignId]);
      return sendJson(req, res, 200, { data: parseInterviewHypothesisRow(rows[0] || null) });
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
      const validationMetricConfig = normalizeInterviewHypothesisValidationConfig(body.validation_metric_config);
      await pool.query(
        `UPDATE interview_hypotheses
         SET type = ?, title = ?, description = ?, status = ?, audience_id = ?,
             segment = ?, related_client_id = ?, interview_form_id = ?, last_evaluated_at = ?,
             min_interviews = ?, validation_metric_config = ?,
             evaluated_interviews_count = ?, problem_score_avg = ?, solution_score_avg = ?, validation_result = ?,
             experiment_notes = ?, observations = ?, next_actions = ?,
             updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [
          body.type || 'problema',
          body.title || 'Hipótesis entrevistas',
          body.description || null,
          body.status || 'exploracion',
          body.audience_id || null,
          body.segment || null,
          body.related_client_id || null,
          body.interview_form_id || null,
          body.last_evaluated_at || null,
          body.min_interviews ?? null,
          validationMetricConfig ? JSON.stringify(validationMetricConfig) : null,
          body.evaluated_interviews_count ?? null,
          body.problem_score_avg ?? null,
          body.solution_score_avg ?? null,
          body.validation_result || 'no evaluada',
          body.experiment_notes || null,
          body.observations || null,
          body.next_actions || null,
          nowIso(),
          id,
          user.id,
        ],
      );
      const [rows] = await pool.query('SELECT * FROM interview_hypotheses WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      return sendJson(req, res, 200, { data: parseInterviewHypothesisRow(rows[0] || null) });
    }

    const interviewHypothesisEvaluateMatch = url.pathname.match(/^\/api\/interview-hypotheses\/([^/]+)\/evaluate$/);
    if (interviewHypothesisEvaluateMatch && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const id = interviewHypothesisEvaluateMatch[1];

      const [hypRows] = await pool.query('SELECT * FROM interview_hypotheses WHERE id = ? AND user_id = ? LIMIT 1', [id, user.id]);
      const hypothesis = hypRows[0] || null;
      if (!hypothesis) return sendJson(req, res, 404, { error: 'Hypothesis not found' });

      const [linkedRows] = await pool.query(
        `SELECT * FROM interview_sessions
         WHERE user_id = ? AND project_id = ? AND campaign_id = ? AND interview_hypothesis_id = ?`,
        [user.id, hypothesis.project_id, hypothesis.campaign_id, hypothesis.id],
      );

      let interviews = linkedRows;
      if (!interviews.length) {
        const clauses = ['user_id = ?', 'project_id = ?', 'campaign_id = ?'];
        const params = [user.id, hypothesis.project_id, hypothesis.campaign_id];
        if (hypothesis.audience_id) {
          clauses.push('audience_id = ?');
          params.push(hypothesis.audience_id);
        }
        if (hypothesis.related_client_id) {
          clauses.push('client_id = ?');
          params.push(hypothesis.related_client_id);
        }
        if (hypothesis.interview_form_id) {
          clauses.push('form_id = ?');
          params.push(hypothesis.interview_form_id);
        }
        const [contextRows] = await pool.query(`SELECT * FROM interview_sessions WHERE ${clauses.join(' AND ')}`, params);
        interviews = contextRows;
      }

      const evaluations = interviews.map((row) => safeParseJsonField(row.responses_json, {})?.__lean_evaluation || {});

      const metric = {
        problem_score_avg: averageScores(evaluations.map((item) => averageScores(HYPOTHESIS_PROBLEM_KEYS.map((key) => item[key])))),
        solution_score_avg: averageScores(evaluations.map((item) => averageScores(HYPOTHESIS_SOLUTION_KEYS.map((key) => item[key])))),
        problem_intensity_avg: averageScores(evaluations.map((item) => item.problem_intensity)),
        problem_frequency_avg: averageScores(evaluations.map((item) => item.problem_frequency)),
        problem_urgency_avg: averageScores(evaluations.map((item) => item.perceived_urgency)),
        problem_attempts_avg: averageScores(evaluations.map((item) => item.solution_attempts)),
        problem_spend_avg: averageScores(evaluations.map((item) => item.previous_spend)),
        problem_clarity_avg: averageScores(evaluations.map((item) => item.problem_clarity)),
        segment_fit_avg: averageScores(evaluations.map((item) => item.segment_fit)),
        emotional_language_avg: averageScores(evaluations.map((item) => item.emotional_language)),
        solution_interest_avg: averageScores(evaluations.map((item) => item.solution_interest)),
        solution_clarity_avg: averageScores(evaluations.map((item) => item.solution_clarity)),
        solution_value_avg: averageScores(evaluations.map((item) => item.perceived_value)),
        solution_recurrence_avg: averageScores(evaluations.map((item) => item.usage_probability)),
        solution_payment_avg: averageScores(evaluations.map((item) => item.willingness_to_pay)),
      };

      const validationMetricConfig = normalizeInterviewHypothesisValidationConfig(hypothesis.validation_metric_config);
      const selectedMetricValues = validationMetricConfig
        ? validationMetricConfig.selected_metrics
          .map((metricKey) => Number(metric[metricKey]))
          .filter((value) => Number.isFinite(value))
        : [];
      const selectedMetricsAverage = selectedMetricValues.length
        ? Number((selectedMetricValues.reduce((acc, value) => acc + value, 0) / selectedMetricValues.length).toFixed(2))
        : null;

      let passedCriteria = 0;
      let failedCriteria = 0;
      if (validationMetricConfig) {
        const passed = evaluateComparison(
          selectedMetricsAverage,
          validationMetricConfig.threshold_value,
          validationMetricConfig.comparison_operator,
        );
        passedCriteria = passed ? 1 : 0;
        failedCriteria = passed ? 0 : 1;
      }

      const minInterviews = Number(hypothesis.min_interviews);
      const minInterviewsTarget = Number.isFinite(minInterviews) && minInterviews > 0 ? minInterviews : 1;
      let validationResult = 'no evaluada';
      if (interviews.length >= minInterviewsTarget) {
        if (validationMetricConfig) {
          const passed = evaluateComparison(
            selectedMetricsAverage,
            validationMetricConfig.threshold_value,
            validationMetricConfig.comparison_operator,
          );
          validationResult = passed ? validationMetricConfig.outcome_if_true : validationMetricConfig.outcome_if_false;
        } else {
          validationResult = 'señal débil';
        }
      }

      const validationSummary = buildHypothesisValidationSummary({
        result: validationResult,
        interviewsCount: interviews.length,
        passCount: passedCriteria,
        failCount: failedCriteria,
        minInterviews: minInterviewsTarget,
        problemScoreAvg: metric.problem_score_avg,
        solutionScoreAvg: metric.solution_score_avg,
      });

      await pool.query(
        `UPDATE interview_hypotheses
         SET evaluated_interviews_count = ?, problem_score_avg = ?, solution_score_avg = ?,
             problem_intensity_avg = ?, problem_frequency_avg = ?, problem_urgency_avg = ?, problem_attempts_avg = ?,
             problem_spend_avg = ?, problem_clarity_avg = ?, segment_fit_avg = ?, emotional_language_avg = ?,
            solution_interest_avg = ?, solution_clarity_avg = ?, solution_value_avg = ?, solution_recurrence_avg = ?, solution_payment_avg = ?,
            criteria_passed_count = ?, criteria_failed_count = ?, validation_summary = ?, validation_result = ?,
            last_evaluated_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [
          interviews.length,
          metric.problem_score_avg,
          metric.solution_score_avg,
          metric.problem_intensity_avg,
          metric.problem_frequency_avg,
          metric.problem_urgency_avg,
          metric.problem_attempts_avg,
          metric.problem_spend_avg,
          metric.problem_clarity_avg,
          metric.segment_fit_avg,
          metric.emotional_language_avg,
          metric.solution_interest_avg,
          metric.solution_clarity_avg,
          metric.solution_value_avg,
          metric.solution_recurrence_avg,
          metric.solution_payment_avg,
          passedCriteria,
          failedCriteria,
          validationSummary,
          validationResult,
          nowIso(),
          nowIso(),
          id,
          user.id,
        ],
      );

      const [rows] = await pool.query(
        `SELECT ih.*, a.name AS audience_name, c.name AS related_client_name, f.title AS interview_form_title
         FROM interview_hypotheses ih
         LEFT JOIN audiences a ON a.id = ih.audience_id
         LEFT JOIN interview_clients c ON c.id = ih.related_client_id
         LEFT JOIN interview_forms f ON f.id = ih.interview_form_id
         WHERE ih.id = ? AND ih.user_id = ? LIMIT 1`,
        [id, user.id],
      );
      return sendJson(req, res, 200, { data: parseInterviewHypothesisRow(rows[0] || null) });
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
        [buildEntityId('interview_form'), projectId, campaignId, user.id, body.title || 'Formulario', body.description || null, JSON.stringify(questions), now, now],
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
        [buildEntityId('interview_session'), projectId, campaignId, user.id, body.client_id, body.audience_id || client.audience_id || null, body.form_id, body.interview_hypothesis_id || null, body.conducted_at || now, body.notes || null, status, status === 'completed' ? now : null, JSON.stringify(responses), JSON.stringify(snapshot), now, now],
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
        [buildEntityId('hypothesis_video_link'), hypothesisId, videoId, contextAudienceId, user.id],
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
      await pool.query('INSERT OR IGNORE INTO hypothesis_videos (id, hypothesis_id, video_id, audience_id, user_id) VALUES (?, ?, ?, ?, ?)', [buildEntityId('hypothesis_video_link'), targetHypothesisId, targetVideoId, contextAudienceId, user.id]);
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
          [buildEntityId('hypothesis_video_link'), targetHypothesisId, video.id, contextAudienceId, user.id],
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

const MAX_PORT_RETRIES = 10;

function startServerWithPortRetry(initialPort) {
  let attempts = 0;
  let currentPort = Number(initialPort);

  const tryListen = () => {
    const onListening = () => {
      server.off('error', onError);
      if (attempts > 0) {
        console.warn(`Port ${port} was busy. Backend started on fallback port ${currentPort}.`);
      }
      console.log(`SQLite backend running on port ${currentPort}`);
    };

    const onError = (error) => {
      server.off('listening', onListening);
      if (error?.code === 'EADDRINUSE' && attempts < MAX_PORT_RETRIES) {
        attempts += 1;
        currentPort += 1;
        console.warn(`Port ${currentPort - 1} is already in use. Retrying on ${currentPort}...`);
        setTimeout(tryListen, 50);
        return;
      }
      console.error(`Failed to start backend on port ${currentPort}:`, error);
      process.exit(1);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(currentPort);
  };

  tryListen();
}

runMigrations()
  .then(() => {
    startServerWithPortRetry(port);
  })
  .catch((error) => {
    console.error('Failed to initialize backend:', error);
    process.exit(1);
  });
