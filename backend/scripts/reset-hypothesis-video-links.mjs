#!/usr/bin/env node

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

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args['base-url'] || process.env.BACKEND_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const projectId = String(args['project-id'] || '').trim();
  const token = String(args.token || process.env.BACKEND_TOKEN || '').trim();

  if (!projectId) {
    console.error('Missing required --project-id');
    process.exit(1);
  }
  if (!token) {
    console.error('Missing required --token (or BACKEND_TOKEN env var)');
    process.exit(1);
  }

  const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/hypothesis-video-links/reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Reset failed:', payload?.error || res.statusText);
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
