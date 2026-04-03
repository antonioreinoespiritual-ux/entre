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

async function signup(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret123' }),
  });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.ok(json?.session?.access_token);
  return json.session.access_token;
}

async function dbQuery(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/api/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'db query failed');
  return json.data;
}

async function createVideoFixture(baseUrl, token) {
  const project = await dbQuery(baseUrl, token, {
    table: 'projects',
    operation: 'insert',
    payload: { name: 'Proyecto score', description: 'D' },
  });
  const campaign = await dbQuery(baseUrl, token, {
    table: 'campaigns',
    operation: 'insert',
    payload: { project_id: project[0].id, name: 'Campaña score', description: 'D' },
  });
  const hypothesisA = await dbQuery(baseUrl, token, {
    table: 'hypotheses',
    operation: 'insert',
    payload: { campaign_id: campaign[0].id, type: 'A', condition: 'views > 0' },
  });
  const hypothesisB = await dbQuery(baseUrl, token, {
    table: 'hypotheses',
    operation: 'insert',
    payload: { campaign_id: campaign[0].id, type: 'B', condition: 'views > 0' },
  });
  return {
    projectId: project[0].id,
    campaignId: campaign[0].id,
    hypothesisAId: hypothesisA[0].id,
    hypothesisBId: hypothesisB[0].id,
  };
}

async function createVideo(baseUrl, token, payload) {
  const rows = await dbQuery(baseUrl, token, {
    table: 'videos',
    operation: 'insert',
    payload,
  });
  return rows[0];
}

async function readVideo(baseUrl, token, videoId) {
  const response = await fetch(`${baseUrl}/api/videos/${videoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  assert.equal(response.status, 200);
  return json.video;
}

async function readHypothesis(baseUrl, token, hypothesisId) {
  const rows = await dbQuery(baseUrl, token, {
    table: 'hypotheses',
    operation: 'select',
    filters: [{ field: 'id', value: hypothesisId }],
  });
  return rows[0];
}

async function linkVideoToHypothesis(baseUrl, token, videoId, hypothesisId) {
  const response = await fetch(`${baseUrl}/api/videos/${videoId}/link-hypotheses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hypothesis_ids: [hypothesisId] }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, json.error || 'link failed');
  return json;
}

test('video score favors balanced performance over vanity reach', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-video-score-'));
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
    const token = await signup(baseUrl, `videoscore-${Date.now()}@example.com`);
    const fixture = await createVideoFixture(baseUrl, token);

    const balanced = await createVideo(baseUrl, token, {
      hypothesis_id: fixture.hypothesisAId,
      video_type: 'organic',
      title: 'Balanced',
      funnel: 'Consideracion',
      views: 4200,
      clicks: 230,
      likes: 180,
      comments: 42,
      shares: 28,
      saves: 31,
      view_content: 130,
      initiate_checkouts: 24,
      formulario_lead: 16,
      purchase: 11,
      cpc: 1.1,
    });
    const vanity = await createVideo(baseUrl, token, {
      hypothesis_id: fixture.hypothesisAId,
      video_type: 'organic',
      title: 'Vanity',
      funnel: 'Reconocimiento',
      views: 30000,
      clicks: 85,
      likes: 14,
      comments: 3,
      shares: 1,
      saves: 0,
      purchase: 0,
      cpc: 4.8,
    });

    const balancedRow = await readVideo(baseUrl, token, balanced.id);
    const vanityRow = await readVideo(baseUrl, token, vanity.id);
    assert.ok(Number.isFinite(Number(balancedRow.video_score)));
    assert.ok(Number.isFinite(Number(vanityRow.video_score)));
    assert.ok(Number(balancedRow.video_score) > Number(vanityRow.video_score));
  } finally {
    server.kill('SIGTERM');
  }
});

test('hypothesis score rewards robust sets of strong videos over a single outlier', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-hyp-score-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4112;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath, CORS_ORIGIN: 'http://localhost:3000' },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);
    const token = await signup(baseUrl, `hypscore-${Date.now()}@example.com`);
    const fixture = await createVideoFixture(baseUrl, token);

    const robustMetrics = [
      { views: 5200, clicks: 240, likes: 170, comments: 38, shares: 26, saves: 30, view_content: 135, initiate_checkouts: 27, purchase: 11, cpc: 1.2 },
      { views: 4700, clicks: 210, likes: 160, comments: 33, shares: 24, saves: 26, view_content: 122, initiate_checkouts: 23, purchase: 10, cpc: 1.15 },
      { views: 5600, clicks: 255, likes: 185, comments: 40, shares: 29, saves: 34, view_content: 144, initiate_checkouts: 29, purchase: 12, cpc: 1.05 },
    ];

    for (const [index, metrics] of robustMetrics.entries()) {
      const video = await createVideo(baseUrl, token, {
        hypothesis_id: fixture.hypothesisAId,
        video_type: 'paid',
        title: `Robust ${index + 1}`,
        funnel: 'Decisión',
        ...metrics,
      });
      await linkVideoToHypothesis(baseUrl, token, video.id, fixture.hypothesisAId);
    }

    const outlier = await createVideo(baseUrl, token, {
      hypothesis_id: fixture.hypothesisBId,
      video_type: 'paid',
      title: 'Outlier',
      funnel: 'Decisión',
      views: 1800,
      clicks: 180,
      likes: 40,
      comments: 9,
      shares: 7,
      saves: 8,
      view_content: 90,
      initiate_checkouts: 19,
      purchase: 10,
      cpc: 0.9,
    });
    await linkVideoToHypothesis(baseUrl, token, outlier.id, fixture.hypothesisBId);

    const robustHypothesis = await readHypothesis(baseUrl, token, fixture.hypothesisAId);
    const outlierHypothesis = await readHypothesis(baseUrl, token, fixture.hypothesisBId);
    assert.ok(Number.isFinite(Number(robustHypothesis.hypothesis_score)));
    assert.ok(Number.isFinite(Number(outlierHypothesis.hypothesis_score)));
    assert.ok(Number(robustHypothesis.hypothesis_score) > Number(outlierHypothesis.hypothesis_score));
  } finally {
    server.kill('SIGTERM');
  }
});

test('updating or unlinking videos recalculates persisted video and hypothesis scores', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-score-recalc-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4113;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath, CORS_ORIGIN: 'http://localhost:3000' },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);
    const token = await signup(baseUrl, `recalcscore-${Date.now()}@example.com`);
    const fixture = await createVideoFixture(baseUrl, token);

    const video = await createVideo(baseUrl, token, {
      hypothesis_id: fixture.hypothesisAId,
      video_type: 'organic',
      title: 'Mutable score',
      funnel: 'Consideracion',
      views: 1200,
      clicks: 24,
      likes: 8,
      comments: 1,
      shares: 0,
      saves: 1,
      purchase: 0,
      cpc: 3.6,
    });
    await linkVideoToHypothesis(baseUrl, token, video.id, fixture.hypothesisAId);

    const beforeVideo = await readVideo(baseUrl, token, video.id);
    const beforeHypothesis = await readHypothesis(baseUrl, token, fixture.hypothesisAId);

    const patchRes = await fetch(`${baseUrl}/api/videos/${video.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        views: 5200,
        clicks: 230,
        likes: 160,
        comments: 28,
        shares: 18,
        saves: 24,
        view_content: 118,
        initiate_checkouts: 22,
        purchase: 9,
        cpc: 1.2,
      }),
    });
    assert.equal(patchRes.status, 200);

    const afterVideo = await readVideo(baseUrl, token, video.id);
    const afterHypothesis = await readHypothesis(baseUrl, token, fixture.hypothesisAId);
    assert.ok(Number(afterVideo.video_score) > Number(beforeVideo.video_score));
    assert.ok(Number(afterHypothesis.hypothesis_score) > Number(beforeHypothesis.hypothesis_score));

    const unlinkRes = await fetch(`${baseUrl}/api/hypotheses/${fixture.hypothesisAId}/videos/unlink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ video_ids: [video.id] }),
    });
    assert.equal(unlinkRes.status, 200);

    const afterUnlinkHypothesis = await readHypothesis(baseUrl, token, fixture.hypothesisAId);
    assert.equal(afterUnlinkHypothesis.hypothesis_score, null);
  } finally {
    server.kill('SIGTERM');
  }
});
