import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultDbPath = path.join(backendRoot, 'data', 'app.sqlite');

function resolveConfiguredDbPath(env = process.env) {
  const configuredPath = env.SQLITE_PATH || env.MYSQLITE_PATH || defaultDbPath;
  if (!configuredPath || !String(configuredPath).trim()) {
    return '';
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  // Resolver rutas relativas siempre desde /backend para evitar apuntar a otra
  // DB cuando el proceso se ejecuta desde un cwd distinto.
  return path.resolve(backendRoot, '..', configuredPath);
}

export function validateDbEnv(env = process.env) {
  const configuredPath = resolveConfiguredDbPath(env);
  if (!configuredPath || !String(configuredPath).trim()) {
    throw new Error('Missing SQLite path. Set SQLITE_PATH (or MYSQLITE_PATH).');
  }
}

export function createPool(env = process.env) {
  validateDbEnv(env);

  const dbPath = resolveConfiguredDbPath(env);
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
