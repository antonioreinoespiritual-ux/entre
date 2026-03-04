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

async function createSession(baseUrl) {
  const email = `links-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret123' }),
  });
  assert.equal(signupRes.status, 200);
  const signupJson = await signupRes.json();
  return signupJson?.session?.access_token;
}

async function dbQuery(baseUrl, token, body) {
  const res = await fetch(`${baseUrl}/api/db/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error || `db query failed ${res.status}`);
  return payload.data;
}

async function cloudOverview(baseUrl, token, projectId) {
  const res = await fetch(`${baseUrl}/api/cloud/projects/${projectId}/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error || `overview failed ${res.status}`);
  return payload;
}

async function setupEntities(baseUrl, token) {
  const project = await dbQuery(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'Proyecto Test', description: '' } });
  const campaign = await dbQuery(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'Campaña Test', description: '' } });
  const audience = await dbQuery(baseUrl, token, { table: 'audiences', operation: 'insert', payload: { campaign_id: campaign[0].id, name: 'Audiencia Test', description: '' } });
  const hypothesis = await dbQuery(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'Hipótesis Test', condition: '', audience_id: audience[0].id } });
  const video = await dbQuery(baseUrl, token, {
    table: 'videos',
    operation: 'insert',
    payload: { project_id: project[0].id, campaign_id: campaign[0].id, video_type: 'paid', title: 'Video Canonical', views: 120, clicks: 12 },
  });
  return { projectId: project[0].id, hypothesisId: hypothesis[0].id, videoId: video[0].id, audienceId: audience[0].id };
}

test('link creates DB relation and cloud edge without copying canonical folder', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-links-link-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4110;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, hypothesisId, videoId } = await setupEntities(baseUrl, token);

    const linkRes = await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });
    assert.equal(linkRes.status, 200);

    const relations = await dbQuery(baseUrl, token, { table: 'hypothesis_videos', operation: 'select', filters: [{ field: 'hypothesis_id', value: hypothesisId }, { field: 'video_id', value: videoId }] });
    assert.equal(relations.length, 1);

    const overview = await cloudOverview(baseUrl, token, projectId);
    const canonical = (overview.videos || []).find((node) => String(node.target_id) === String(videoId));
    assert.ok(canonical, 'canonical folder should exist once in videos_root');

    const hypothesisEntry = (overview.hypotheses || [])[0];
    const linked = (hypothesisEntry?.links || []).find((edge) => String(edge.child_id) === String(canonical.id));
    assert.ok(linked, 'hypothesis should contain edge link to canonical folder');
  } finally {
    server.kill('SIGTERM');
  }
});

test('unlink removes DB relation and cloud edge but keeps canonical folder', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-links-unlink-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4111;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, hypothesisId, videoId } = await setupEntities(baseUrl, token);

    await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });

    const unlinkRes = await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/unlink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });
    assert.equal(unlinkRes.status, 200);

    const relations = await dbQuery(baseUrl, token, { table: 'hypothesis_videos', operation: 'select', filters: [{ field: 'hypothesis_id', value: hypothesisId }, { field: 'video_id', value: videoId }] });
    assert.equal(relations.length, 0);

    const overview = await cloudOverview(baseUrl, token, projectId);
    const canonical = (overview.videos || []).find((node) => String(node.target_id) === String(videoId));
    assert.ok(canonical, 'canonical should remain');
    const links = (overview.hypotheses || []).flatMap((entry) => entry.links || []).filter((edge) => String(edge.child_id) === String(canonical.id));
    assert.equal(links.length, 0, 'no hypothesis links should remain');
  } finally {
    server.kill('SIGTERM');
  }
});
