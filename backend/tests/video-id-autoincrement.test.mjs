import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error('Backend did not become healthy in time');
}

async function api(baseUrl, token, body) {
  const res = await fetch(`${baseUrl}/api/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

test('assigns next video_id as max+1 when creating video without video_id', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-video-id-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4105;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BACKEND_PORT: String(port),
      SQLITE_PATH: dbPath,
      CORS_ORIGIN: 'http://localhost:3000',
    },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);

    const email = `videoid-${Date.now()}@example.com`;
    const password = 'secret123';

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(signupRes.status, 200);
    const signupJson = await signupRes.json();
    const token = signupJson?.session?.access_token;
    const userId = signupJson?.user?.id;
    assert.ok(token, 'token should be returned');
    assert.ok(userId, 'user id should be returned');

    const project = await api(baseUrl, token, {
      table: 'projects',
      operation: 'insert',
      payload: { name: 'P', description: 'D' },
    });
    const projectId = project[0].id;

    const campaign = await api(baseUrl, token, {
      table: 'campaigns',
      operation: 'insert',
      payload: { project_id: projectId, user_id: userId, name: 'C', description: 'D' },
    });
    const campaignId = campaign[0].id;

    const hypothesis = await api(baseUrl, token, {
      table: 'hypotheses',
      operation: 'insert',
      payload: { campaign_id: campaignId, user_id: userId, type: 'test', condition: 'views > 0' },
    });
    const hypothesisId = hypothesis[0].id;

    for (const n of [1, 3, 4, 5]) {
      const created = await api(baseUrl, token, {
        table: 'videos',
        operation: 'insert',
        payload: { hypothesis_id: hypothesisId, video_type: 'organic', title: `V-${n}`, video_id: n },
      });
      assert.equal(created[0].video_id, n);
    }

    const autoCreated = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesisId, video_type: 'organic', title: 'Auto-next' },
    });

    assert.equal(autoCreated[0].video_id, 6);
  } finally {
    server.kill('SIGTERM');
  }
});
