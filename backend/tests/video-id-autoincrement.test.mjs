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
    assert.ok(token, 'token should be returned');

    const project = await api(baseUrl, token, {
      table: 'projects',
      operation: 'insert',
      payload: { name: 'P', description: 'D' },
    });
    const projectId = project[0].id;

    const campaign = await api(baseUrl, token, {
      table: 'campaigns',
      operation: 'insert',
      payload: { project_id: projectId, name: 'C', description: 'D' },
    });
    const campaignId = campaign[0].id;

    const hypothesis = await api(baseUrl, token, {
      table: 'hypotheses',
      operation: 'insert',
      payload: { campaign_id: campaignId, type: 'test', condition: 'views > 0' },
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
    assert.equal(autoCreated[0].external_id, 'session-6');

    const autoPaid = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesisId, video_type: 'paid', title: 'Auto-paid' },
    });
    assert.equal(autoPaid[0].external_id, `ad-${autoPaid[0].video_id}`);

    const autoLive = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesisId, video_type: 'live', title: 'Auto-live' },
    });
    assert.equal(autoLive[0].external_id, `live-${autoLive[0].video_id}`);
  } finally {
    server.kill('SIGTERM');
  }
});


test('bulk update resolves by videos.video_id values', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-bulk-video-id-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4106;
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

    const email = `bulkvideoid-${Date.now()}@example.com`;
    const password = 'secret123';

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(signupRes.status, 200);
    const signupJson = await signupRes.json();
    const token = signupJson?.session?.access_token;
    assert.ok(token);

    const project = await api(baseUrl, token, {
      table: 'projects', operation: 'insert', payload: { name: 'P', description: 'D' },
    });
    const campaign = await api(baseUrl, token, {
      table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: 'D' },
    });
    const hypothesis = await api(baseUrl, token, {
      table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'test', condition: 'views > 0' },
    });

    const video = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: {
        hypothesis_id: hypothesis[0].id,
        video_type: 'organic',
        title: 'Bulk target',
        external_id: 's-001',
        video_id: 1341,
      },
    });

    const bulkRes = await fetch(`${baseUrl}/api/videos/bulk-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        updates: [
          { video_id: '1341', fields: { views: 1234, clicks: 77 } },
        ],
      }),
    });
    assert.equal(bulkRes.status, 200);
    const bulkJson = await bulkRes.json();
    assert.equal(bulkJson.applicable, 1);
    assert.equal(bulkJson.results?.[0]?.status, 'updated');
    assert.equal(String(bulkJson.results?.[0]?.matchedVideoId), String(video[0].id));

    const selected = await api(baseUrl, token, {
      table: 'videos',
      operation: 'select',
      filters: [{ field: 'id', value: video[0].id }],
    });
    assert.equal(selected[0].views, 1234);
    assert.equal(selected[0].clicks, 77);
  } finally {
    server.kill('SIGTERM');
  }
});


test('analysis-data endpoint returns per-audience cumplimiento breakdown', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-hyp-breakdown-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4107;
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

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `breakdown-${Date.now()}@example.com`, password: 'secret123' }),
    });
    assert.equal(signupRes.status, 200);
    const signupJson = await signupRes.json();
    const token = signupJson?.session?.access_token;
    assert.ok(token);

    const project = await api(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: 'D' } });
    const campaign = await api(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: 'D' } });

    const audienceA = await api(baseUrl, token, { table: 'audiences', operation: 'insert', payload: { campaign_id: campaign[0].id, name: 'A', description: '' } });
    const audienceB = await api(baseUrl, token, { table: 'audiences', operation: 'insert', payload: { campaign_id: campaign[0].id, name: 'B', description: '' } });

    const hypothesis = await api(baseUrl, token, {
      table: 'hypotheses',
      operation: 'insert',
      payload: {
        campaign_id: campaign[0].id,
        type: 'Problema',
        metrica_objetivo_y: 'clicks',
        umbral_operador: '>=',
        umbral_valor: 30,
        condition: 'clicks >= 30',
      },
    });

    await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesis[0].id, audience_id: audienceA[0].id, video_type: 'organic', title: 'VA', clicks: 45, views: 500 },
    });
    await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesis[0].id, audience_id: audienceB[0].id, video_type: 'organic', title: 'VB', clicks: 10, views: 500 },
    });

    const resp = await fetch(`${baseUrl}/api/hypotheses/${hypothesis[0].id}/analysis-data?primary_metric=clicks&threshold_operator=%3E%3D&threshold_value=30`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    const byAudience = new Map((json.audience_breakdown || []).map((row) => [row.audience_name, row]));
    assert.equal(byAudience.get('A')?.status, 'pass');
    assert.equal(byAudience.get('B')?.status, 'fail');
  } finally {
    server.kill('SIGTERM');
  }
});

test('create video auto-inserts hypothesis_videos link row', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-link-row-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4108;
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

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `linkrow-${Date.now()}@example.com`, password: 'secret123' }),
    });
    assert.equal(signupRes.status, 200);
    const token = (await signupRes.json())?.session?.access_token;
    assert.ok(token);

    const project = await api(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: 'D' } });
    const campaign = await api(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: 'D' } });
    const hypothesis = await api(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'test', condition: 'views > 0' } });

    const video = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: hypothesis[0].id, video_type: 'organic', title: 'Linked-on-create' },
    });

    const links = await api(baseUrl, token, {
      table: 'hypothesis_videos',
      operation: 'select',
      filters: [
        { field: 'hypothesis_id', value: hypothesis[0].id },
        { field: 'video_id', value: video[0].id },
      ],
    });
    assert.equal(links.length, 1);
  } finally {
    server.kill('SIGTERM');
  }
});


test('hypothesis videos endpoint includes linked videos without duplicates', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-linked-videos-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4109;
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

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `linkedvideos-${Date.now()}@example.com`, password: 'secret123' }),
    });
    assert.equal(signupRes.status, 200);
    const token = (await signupRes.json())?.session?.access_token;
    assert.ok(token);

    const project = await api(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: 'D' } });
    const campaign = await api(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: 'D' } });
    const sourceHyp = await api(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'source', condition: 'views > 0' } });
    const targetHyp = await api(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'target', condition: 'views > 0' } });

    const video = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: sourceHyp[0].id, video_type: 'organic', title: 'Reusable', external_id: 'session-777' },
    });

    const linkRes = await fetch(`${baseUrl}/api/hypotheses/${targetHyp[0].id}/videos/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ video_ids: [video[0].id] }),
    });
    assert.equal(linkRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/hypotheses/${targetHyp[0].id}/videos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const ids = (listJson.data || []).map((row) => row.id);
    assert.equal(ids.filter((id) => id === video[0].id).length, 1);
    const reused = (listJson.data || []).find((row) => row.id === video[0].id);
    assert.equal(reused?.is_reused_for_hypothesis, 1);
  } finally {
    server.kill('SIGTERM');
  }
});

test('cloud links canonical video folder into hypothesis without physical duplication', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-cloud-link-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4110;
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

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `cloudlink-${Date.now()}@example.com`, password: 'secret123' }),
    });
    assert.equal(signupRes.status, 200);
    const token = (await signupRes.json())?.session?.access_token;
    assert.ok(token);

    const project = await api(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: 'D' } });
    const campaign = await api(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: 'D' } });
    const sourceHyp = await api(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'source', condition: 'views > 0' } });
    const targetHyp = await api(baseUrl, token, { table: 'hypotheses', operation: 'insert', payload: { campaign_id: campaign[0].id, type: 'target', condition: 'views > 0' } });

    const video = await api(baseUrl, token, {
      table: 'videos',
      operation: 'insert',
      payload: { hypothesis_id: sourceHyp[0].id, video_type: 'organic', title: 'Video Cloud Canon' },
    });

    const linkRes = await fetch(`${baseUrl}/api/hypotheses/${targetHyp[0].id}/videos/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ video_ids: [video[0].id] }),
    });
    assert.equal(linkRes.status, 200);

    const locateVideoRes = await fetch(`${baseUrl}/api/cloud/locate?targetType=video&targetId=${video[0].id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(locateVideoRes.status, 200);
    const locateVideoJson = await locateVideoRes.json();
    const canonicalVideoFolderId = locateVideoJson.nodeId;
    assert.ok(canonicalVideoFolderId);

    const locateHypRes = await fetch(`${baseUrl}/api/cloud/locate?targetType=hypothesis&targetId=${targetHyp[0].id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(locateHypRes.status, 200);
    const locateHypJson = await locateHypRes.json();

    const hypothesisFolderId = locateHypJson.parentId || locateHypJson.nodeId;
    const hypChildrenRes = await fetch(`${baseUrl}/api/cloud/tree?parentId=${hypothesisFolderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(hypChildrenRes.status, 200);
    const hypChildrenJson = await hypChildrenRes.json();
    const videosFolder = (hypChildrenJson.data || []).find((node) => node.type === 'folder' && node.name === 'Videos');
    assert.ok(videosFolder, 'hypothesis should contain Videos folder');

    const linkedVideosRes = await fetch(`${baseUrl}/api/cloud/tree?parentId=${videosFolder.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(linkedVideosRes.status, 200);
    const linkedVideosJson = await linkedVideosRes.json();
    const linkedVideoFolder = (linkedVideosJson.data || []).find((node) => node.target_type === 'video' && String(node.target_id) === String(video[0].id));
    assert.ok(linkedVideoFolder, 'linked video folder should appear in hypothesis cloud');
    assert.equal(linkedVideoFolder.id, canonicalVideoFolderId, 'linked folder should be the canonical node, not a duplicate');
    assert.equal(Number(linkedVideoFolder.is_linked_from_edge || 0), 1, 'linked folder should be represented as an edge alias');
  } finally {
    server.kill('SIGTERM');
  }
});
