import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultDbPath = path.join(backendRoot, 'data', 'app.sqlite');

function resolveFromProjectRoot(candidatePath) {
  if (!candidatePath || !String(candidatePath).trim()) return '';
  if (path.isAbsolute(candidatePath)) return candidatePath;
  return path.resolve(backendRoot, '..', candidatePath);
}

function hasUsers(dbPath) {
  let db;
  try {
    if (!fs.existsSync(dbPath)) return false;
    db = new DatabaseSync(dbPath);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
      .get();
    if (!table) return false;
    const row = db.prepare('SELECT COUNT(*) AS total FROM users').get();
    return Number(row?.total || 0) > 0;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // noop
    }
  }
}

function resolveConfiguredDbPath(env = process.env) {
  const configuredPath = env.SQLITE_PATH || env.MYSQLITE_PATH || defaultDbPath;
  if (!configuredPath || !String(configuredPath).trim()) {
    return '';
  }

  return resolveFromProjectRoot(configuredPath);
}

function findBestExistingDbPath(primaryPath) {
  const knownCandidates = [
    primaryPath,
    defaultDbPath,
    path.resolve(backendRoot, 'data', 'database.sqlite'),
    path.resolve(backendRoot, '..', 'data', 'app.sqlite'),
  ]
    .map((candidate) => resolveFromProjectRoot(candidate))
    .filter(Boolean);

  const seen = new Set();
  const deduped = knownCandidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  const withUsers = deduped.find((candidate) => hasUsers(candidate));
  return withUsers || primaryPath;
}

export function validateDbEnv(env = process.env) {
  const configuredPath = resolveConfiguredDbPath(env);
  if (!configuredPath || !String(configuredPath).trim()) {
    throw new Error('Missing SQLite path. Set SQLITE_PATH (or MYSQLITE_PATH).');
  }
}

export function createPool(env = process.env) {
  validateDbEnv(env);

  const dbPath = findBestExistingDbPath(resolveConfiguredDbPath(env));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  return {
    async query(sql, params = []) {
      const normalizedSql = String(sql).trim();
      const statement = db.prepare(normalizedSql);
      const firstToken = normalizedSql.split(/\s+/)[0]?.toUpperCase() || '';

      if (firstToken === 'SELECT' || firstToken === 'PRAGMA' || firstToken === 'WITH') {
        return [statement.all(...params)];
      }

      statement.run(...params);
      return [[]];
    },
  };
}
