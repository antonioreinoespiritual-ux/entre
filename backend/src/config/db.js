import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const defaultDbPath = path.resolve('backend/data/app.sqlite');

export function validateDbEnv(env = process.env) {
  const configuredPath = env.SQLITE_PATH || env.MYSQLITE_PATH || defaultDbPath;
  if (!configuredPath || !String(configuredPath).trim()) {
    throw new Error('Missing SQLite path. Set SQLITE_PATH (or MYSQLITE_PATH).');
  }
}

export function createPool(env = process.env) {
  validateDbEnv(env);

  const dbPath = path.resolve(env.SQLITE_PATH || env.MYSQLITE_PATH || defaultDbPath);
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
