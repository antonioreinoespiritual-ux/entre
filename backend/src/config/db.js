import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const requiredVars = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];

export function validateDbEnv(env = process.env) {
  const missing = requiredVars.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing MySQL env vars: ${missing.join(', ')}`);
  }
}

function escapeValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseMysqlOutput(stdout) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');

  return lines.slice(1).map((line) => {
    const values = line.split('\t');
    return headers.reduce((acc, header, index) => {
      const value = values[index];
      if (value === undefined || value === 'NULL') {
        acc[header] = null;
      } else if (value === '1' || value === '0') {
        acc[header] = value === '1';
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        acc[header] = Number(value);
      } else {
        acc[header] = value;
      }
      return acc;
    }, {});
  });
}

export function createPool(env = process.env) {
  validateDbEnv(env);

  return {
    async query(sql, params = []) {
      const escapedParams = params.map(escapeValue);
      let paramIndex = 0;
      const finalSql = sql.replace(/\?/g, () => escapedParams[paramIndex++] ?? 'NULL');

      const args = [
        '-h', env.MYSQL_HOST,
        '-P', String(env.MYSQL_PORT),
        '-u', env.MYSQL_USER,
        `-p${env.MYSQL_PASSWORD}`,
        '-D', env.MYSQL_DATABASE,
        '-B',
        '--raw',
        '-e',
        `${finalSql.replace(/;?$/, ';')}`,
      ];

      const { stdout } = await execFileAsync('mysql', args, { maxBuffer: 1024 * 1024 * 6 });
      return [parseMysqlOutput(stdout)];
    },
  };
}
