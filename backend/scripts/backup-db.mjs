#!/usr/bin/env node
// Respaldo del único archivo SQLite que contiene todos los datos de todos los
// usuarios (backend/data/app.sqlite). No hay ningún otro mecanismo de backup
// en el proyecto -- ver auditoría F-05. Usa el comando `.backup` de sqlite3,
// que es seguro contra un proceso escribiendo en modo WAL al mismo tiempo
// (no requiere detener el backend).
//
// Uso:
//   node backend/scripts/backup-db.mjs [--out-dir backend/backups] [--keep 14]
//
// Para automatizarlo, agrega esto al cron/launchd del sistema TÚ MISMO
// (este script no se auto-programa):
//   0 * * * * cd /ruta/al/repo && /usr/bin/env node backend/scripts/backup-db.mjs --keep 168

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const dbPath = path.resolve(String(args['db-path'] || process.env.SQLITE_PATH || 'backend/data/app.sqlite'));
  const outDir = path.resolve(String(args['out-dir'] || 'backend/backups'));
  const keep = Number(args.keep || 14);

  if (!fs.existsSync(dbPath)) {
    console.error(`No existe la base de datos en ${dbPath}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `app-${stamp}.sqlite`);

  // `sqlite3 <db> ".backup <out>"` usa la Online Backup API de SQLite:
  // produce una copia consistente incluso con escrituras concurrentes en WAL.
  execFileSync('sqlite3', [dbPath, `.backup ${outPath}`], { stdio: 'inherit' });

  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(1);
  console.log(`Backup creado: ${outPath} (${sizeMb} MB)`);

  const existing = fs.readdirSync(outDir)
    .filter((name) => name.startsWith('app-') && name.endsWith('.sqlite'))
    .map((name) => ({ name, full: path.join(outDir, name), mtime: fs.statSync(path.join(outDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = existing.slice(keep);
  for (const file of toDelete) {
    fs.unlinkSync(file.full);
    console.log(`Backup antiguo eliminado (retención=${keep}): ${file.name}`);
  }
}

main();
