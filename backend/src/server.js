import process from 'node:process';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { createPool } from './config/db.js';

const port = Number(process.env.BACKEND_PORT || 4000);
const pool = createPool();
const sessions = new Map();
const allowedTables = new Set(['projects', 'campaigns', 'audiences', 'hypotheses', 'videos', 'users']);

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS campaigns (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (project_id),
  INDEX (user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audiences (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (campaign_id),
  INDEX (user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hypotheses (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(255) NOT NULL,
  \
\`condition\` TEXT,
  validation_status VARCHAR(64) DEFAULT 'No Validada',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (campaign_id),
  INDEX (user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS videos (
  id CHAR(36) PRIMARY KEY,
  audience_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  url TEXT,
  cpc DECIMAL(10,2) DEFAULT 0,
  views INT DEFAULT 0,
  engagement DECIMAL(10,2) DEFAULT 0,
  likes INT DEFAULT 0,
  shares INT DEFAULT 0,
  comments INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (audience_id),
  INDEX (user_id),
  FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
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

async function runMigrations() {
  for (const statement of schemaSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
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
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    if (req.url === '/api/health' && req.method === 'GET') {
      await pool.query('SELECT 1 AS ok');
      sendJson(res, 200, { ok: true, error: null });
      return;
    }

    if (req.url === '/api/auth/signup' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.email || !body.password) {
        sendJson(res, 400, { error: 'Email and password are required' });
        return;
      }

      const [existing] = await pool.query('SELECT id, email FROM users WHERE email = ?', [body.email]);
      if (existing.length) {
        sendJson(res, 409, { error: 'Email already registered' });
        return;
      }

      const user = { id: uuid(), email: body.email, password_hash: hashPassword(body.password) };
      await pool.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [user.id, user.email, user.password_hash]);

      const token = uuid();
      const session = { access_token: token, user: { id: user.id, email: user.email } };
      sessions.set(token, session.user);
      sendJson(res, 200, { session, user: session.user });
      return;
    }

    if (req.url === '/api/auth/signin' && req.method === 'POST') {
      const body = await readBody(req);
      const [rows] = await pool.query('SELECT id, email, password_hash FROM users WHERE email = ?', [body.email || '']);
      const dbUser = rows[0];
      if (!dbUser || !verifyPassword(body.password || '', dbUser.password_hash)) {
        sendJson(res, 401, { error: 'Invalid credentials' });
        return;
      }

      const token = uuid();
      const session = { access_token: token, user: { id: dbUser.id, email: dbUser.email } };
      sessions.set(token, session.user);
      sendJson(res, 200, { session, user: session.user });
      return;
    }

    if (req.url === '/api/auth/me' && req.method === 'GET') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      sendJson(res, 200, { user });
      return;
    }

    if (req.url === '/api/auth/signout' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      sessions.delete(token);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.url === '/api/db/query' && req.method === 'POST') {
      const user = authFromRequest(req);
      if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      const rows = await executeCrudQuery(body, user.id);
      sendJson(res, 200, { data: rows, error: null });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || String(error) });
  }
});

runMigrations()
  .then(() => {
    server.listen(port, () => {
      console.log(`MySQL backend running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize backend:', error);
    process.exit(1);
  });
