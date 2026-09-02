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
  db.exec('PRAGMA busy_timeout = 5000;');

  function runStatement(sql, params) {
    const normalizedSql = String(sql).trim();
    const statement = db.prepare(normalizedSql);
    const firstToken = normalizedSql.split(/\s+/)[0]?.toUpperCase() || '';

    if (firstToken === 'SELECT' || firstToken === 'PRAGMA' || firstToken === 'WITH') {
      return [statement.all(...params)];
    }

    statement.run(...params);
    return [[]];
  }

  // Todas las requests HTTP comparten esta única conexión síncrona (DatabaseSync).
  // `queue` serializa el acceso a `db` por turnos: una llamada normal a query()
  // toma el turno para un solo statement, pero una transacción abierta con
  // withTransaction() retiene el turno durante TODA su duración (desde BEGIN
  // hasta el COMMIT/ROLLBACK), de modo que ninguna otra request puede ejecutar
  // ninguna query -ni dentro ni fuera de una transacción propia- mientras esa
  // transacción sigue abierta. Sin esto, un ROLLBACK podía deshacer
  // silenciosamente escrituras de otra request que se hubiera intercalado en
  // el mismo proceso mientras la transacción seguía abierta.
  let queue = Promise.resolve();

  function nextTurn() {
    let release;
    const waitFor = queue;
    queue = new Promise((resolve) => { release = resolve; });
    return waitFor.then(() => release);
  }

  return {
    async query(sql, params = []) {
      const release = await nextTurn();
      try {
        return runStatement(sql, params);
      } finally {
        release();
      }
    },

    // Ejecuta `fn` dentro de una transacción, reteniendo el turno hasta que
    // termine. `fn` recibe un `query(sql, params)` propio de la transacción
    // (no usar pool.query dentro de fn: volvería a pedir turno y bloquearía
    // contra sí mismo).
    async withTransaction(fn) {
      const release = await nextTurn();
      try {
        runStatement('BEGIN IMMEDIATE', []);
        const txQuery = async (sql, params = []) => runStatement(sql, params);
        let result;
        try {
          result = await fn(txQuery);
        } catch (error) {
          runStatement('ROLLBACK', []);
          throw error;
        }
        runStatement('COMMIT', []);
        return result;
      } finally {
        release();
      }
    },
  };
}
