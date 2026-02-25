import process from "node:process";
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

export function createPool(env = process.env) {
  validateDbEnv(env);

  return {
    async query(sql, params = []) {
      const escapedParams = params.map((value) => {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'number') return String(value);
        return `'${String(value).replaceAll("'", "''")}'`;
      });

      let paramIndex = 0;
      const finalSql = sql.replace(/\?/g, () => escapedParams[paramIndex++] ?? 'NULL');

      const args = [
        '-h', env.MYSQL_HOST,
        '-P', String(env.MYSQL_PORT),
        '-u', env.MYSQL_USER,
        `-p${env.MYSQL_PASSWORD}`,
        '-D', env.MYSQL_DATABASE,
        '-N',
        '-e',
        `${finalSql.replace(/;?$/, ';')}`,
      ];

      const { stdout } = await execFileAsync('mysql', args, { maxBuffer: 1024 * 1024 * 4 });

      const rows = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split('\t'));

      return [rows];
    },
  };
}
