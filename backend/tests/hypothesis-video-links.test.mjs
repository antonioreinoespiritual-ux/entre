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
  const token = signupJson?.session?.access_token;
  assert.ok(token, 'token should be returned');
  return token;
}

async function dbQuery(baseUrl, token, body) {
  const res = await fetch(`${baseUrl}/api/db/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error || `db query failed with ${res.status}`);
  return payload.data;
}

async function cloudTree(baseUrl, token, parentId = null) {
  const params = new URLSearchParams();
  if (parentId) params.set('parentId', parentId);
  params.set('limit', '500');
  const res = await fetch(`${baseUrl}/api/cloud/tree?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error || `cloud tree failed with ${res.status}`);
  return payload.data || [];
}

async function findFolderByPath(baseUrl, token, names) {
  let parentId = null;
  for (const name of names) {
    const children = await cloudTree(baseUrl, token, parentId);
    const match = children.find((row) => row.type === 'folder' && row.name === name);
    assert.ok(match, `Folder not found in cloud path: ${name}`);
    parentId = match.id;
  }
  return parentId;
}

async function setupEntities(baseUrl, token) {
  const project = await dbQuery(baseUrl, token, {
    table: 'projects',
    operation: 'insert',
    payload: { name: 'Proyecto Test', description: '' },
  });
  const campaign = await dbQuery(baseUrl, token, {
    table: 'campaigns',
    operation: 'insert',
    payload: { project_id: project[0].id, name: 'Campaña Test', description: '' },
  });
  const hypothesis = await dbQuery(baseUrl, token, {
    table: 'hypotheses',
    operation: 'insert',
    payload: { campaign_id: campaign[0].id, type: 'Hipótesis Test', condition: '' },
  });
  const video = await dbQuery(baseUrl, token, {
    table: 'videos',
    operation: 'insert',
    payload: {
      project_id: project[0].id,
      campaign_id: campaign[0].id,
      video_type: 'paid',
      title: 'Video Canonical',
    },
  });

  return {
    projectId: project[0].id,
    campaignId: campaign[0].id,
    hypothesisId: hypothesis[0].id,
    videoId: video[0].id,
  };
}

test('link endpoint creates DB relation and cloud linked folder inside hypothesis videos folder', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-links-link-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4110;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath, CORS_ORIGIN: 'http://localhost:3000' },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { hypothesisId, videoId } = await setupEntities(baseUrl, token);

    const linkRes = await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });
    assert.equal(linkRes.status, 200);

    const relations = await dbQuery(baseUrl, token, {
      table: 'hypothesis_videos',
      operation: 'select',
      filters: [
        { field: 'hypothesis_id', value: hypothesisId },
        { field: 'video_id', value: videoId },
      ],
    });
    assert.equal(relations.length, 1);

    const videosFolderId = await findFolderByPath(baseUrl, token, [
      'Cloud',
      'Proyectos',
      'Proyecto Test',
      'Campañas',
      'Campaña Test',
      'Hipótesis',
      'Hipótesis Test',
      'Videos',
    ]);
    const hypothesisVideoChildren = await cloudTree(baseUrl, token, videosFolderId);
    const linkedVideoFolder = hypothesisVideoChildren.find((node) => node.target_type === 'video' && String(node.target_id) === String(videoId));
    assert.ok(linkedVideoFolder, 'linked canonical video folder should be visible in hypothesis videos folder');

    const campaignVideosFolderId = await findFolderByPath(baseUrl, token, ['Cloud', 'Proyectos', 'Proyecto Test', 'Videos']);
    const projectVideoChildren = await cloudTree(baseUrl, token, campaignVideosFolderId);
    const canonicalFolder = projectVideoChildren.find((node) => node.target_type === 'video' && String(node.target_id) === String(videoId));
    assert.ok(canonicalFolder, 'canonical video folder should stay under project videos root');
    assert.equal(canonicalFolder.parent_id, campaignVideosFolderId);
    assert.equal(String(relations[0].hypothesis_id), String(hypothesisId));
  } finally {
    server.kill('SIGTERM');
  }
});

test('unlink endpoint deletes DB relation and removes cloud linked folder from hypothesis without deleting canonical folder', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-links-unlink-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4111;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath, CORS_ORIGIN: 'http://localhost:3000' },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { hypothesisId, videoId } = await setupEntities(baseUrl, token);

    const linkRes = await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });
    assert.equal(linkRes.status, 200);

    const unlinkRes = await fetch(`${baseUrl}/api/hypotheses/${hypothesisId}/videos/unlink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: [videoId] }),
    });
    assert.equal(unlinkRes.status, 200);

    const relations = await dbQuery(baseUrl, token, {
      table: 'hypothesis_videos',
      operation: 'select',
      filters: [
        { field: 'hypothesis_id', value: hypothesisId },
        { field: 'video_id', value: videoId },
      ],
    });
    assert.equal(relations.length, 0);

    const videosFolderId = await findFolderByPath(baseUrl, token, [
      'Cloud',
      'Proyectos',
      'Proyecto Test',
      'Campañas',
      'Campaña Test',
      'Hipótesis',
      'Hipótesis Test',
      'Videos',
    ]);
    const hypothesisVideoChildren = await cloudTree(baseUrl, token, videosFolderId);
    const linkedVideoFolder = hypothesisVideoChildren.find((node) => node.target_type === 'video' && String(node.target_id) === String(videoId));
    assert.equal(linkedVideoFolder, undefined);

    const projectVideosFolderId = await findFolderByPath(baseUrl, token, ['Cloud', 'Proyectos', 'Proyecto Test', 'Videos']);
    const projectVideoChildren = await cloudTree(baseUrl, token, projectVideosFolderId);
    const canonicalFolder = projectVideoChildren.find((node) => node.target_type === 'video' && String(node.target_id) === String(videoId));
    assert.ok(canonicalFolder, 'canonical folder must remain after unlink');
  } finally {
    server.kill('SIGTERM');
  }
});
