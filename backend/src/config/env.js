import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseEnvContent(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) return acc;

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      acc[key] = value;
      return acc;
    }, {});
}

export function loadEnvFile(filePath, env = process.env) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return { loaded: false, path: absolutePath };
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf8');
  const parsed = parseEnvContent(fileContent);

  Object.entries(parsed).forEach(([key, value]) => {
    if (env[key] === undefined) {
      env[key] = value;
    }
  });

  return { loaded: true, path: absolutePath };
}

export function loadBackendEnv(env = process.env) {
  // Orden de prioridad: variables ya exportadas > .env local > .env.example
  const fromEnv = loadEnvFile('.env', env);
  if (fromEnv.loaded) return fromEnv;
  return loadEnvFile('.env.example', env);
}
