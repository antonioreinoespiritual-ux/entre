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
  const email = `codemap-race-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

async function getCommentModeState(baseUrl, token, storageKey) {
  const res = await fetch(`${baseUrl}/api/comment-mode/state?${new URLSearchParams({ storageKey })}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.data.payload;
}

async function postCommentModeState(baseUrl, token, storageKey, payload) {
  const res = await fetch(`${baseUrl}/api/comment-mode/state`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageKey, payload }),
  });
  return res.json();
}

function setParent(codes, slug, parentSlug) {
  return codes.map((code) => (code.slug === slug ? { ...code, parent_slug: parentSlug, updated_at: new Date().toISOString() } : code));
}

test('two concurrent code-map connections do not overwrite each other (regression for CM-01)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-codemap-race-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4118;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);

    const project = await dbQuery(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: '' } });
    const campaign = await dbQuery(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: '' } });
    const projectId = project[0].id;
    const campaignId = campaign[0].id;

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'WS', description: '', status: 'active' }),
    });
    const workspaceJson = await workspaceRes.json();
    const workspaceId = workspaceJson?.data?.id;
    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;

    const now = new Date().toISOString();
    const seedCodes = ['code-a', 'code-b', 'code-c', 'code-d'].map((slug) => ({
      slug, name: slug, description: '', tags: [], parent_slug: null, created_at: now, updated_at: now,
    }));
    await postCommentModeState(baseUrl, token, storageKey, { codes: seedCodes });

    const base = await getCommentModeState(baseUrl, token, storageKey);
    const payload1 = { ...base, codes: setParent(base.codes, 'code-a', 'code-b') };
    const payload2 = { ...base, codes: setParent(base.codes, 'code-c', 'code-d') };

    // Both requests are built from the SAME base snapshot and fired truly
    // concurrently - exactly what happens when a user connects two pairs of
    // codes back-to-back, faster than one full round trip.
    await Promise.all([
      postCommentModeState(baseUrl, token, storageKey, payload1),
      postCommentModeState(baseUrl, token, storageKey, payload2),
    ]);

    const final = await getCommentModeState(baseUrl, token, storageKey);
    const codeA = final.codes.find((c) => c.slug === 'code-a');
    const codeC = final.codes.find((c) => c.slug === 'code-c');

    assert.equal(codeA?.parent_slug, 'code-b', 'connection made by request 1 must survive a concurrent, unrelated save');
    assert.equal(codeC?.parent_slug, 'code-d', 'connection made by request 2 must survive a concurrent, unrelated save');
  } finally {
    server.kill('SIGTERM');
  }
});

test('a connection racing against an unrelated concurrent save is not lost', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-codemap-race2-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4119;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);

    const project = await dbQuery(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: '' } });
    const campaign = await dbQuery(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: '' } });
    const projectId = project[0].id;
    const campaignId = campaign[0].id;

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'WS', description: '', status: 'active' }),
    });
    const workspaceJson = await workspaceRes.json();
    const workspaceId = workspaceJson?.data?.id;
    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;

    const now = new Date().toISOString();
    const seedCodes = ['code-x', 'code-y'].map((slug) => ({
      slug, name: slug, description: '', tags: [], parent_slug: null, created_at: now, updated_at: now,
    }));
    await postCommentModeState(baseUrl, token, storageKey, { codes: seedCodes });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const base = await getCommentModeState(baseUrl, token, storageKey);
      const connectPayload = { ...base, codes: setParent(base.codes, 'code-x', 'code-y') };
      // p2 mimics any other unrelated save fired around the same time
      // (dragging a node, editing a fragment, etc.) - it carries no new
      // information, built from the same base snapshot.
      const unrelatedPayload = { ...base };

      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        postCommentModeState(baseUrl, token, storageKey, connectPayload),
        postCommentModeState(baseUrl, token, storageKey, unrelatedPayload),
      ]);

      // eslint-disable-next-line no-await-in-loop
      const final = await getCommentModeState(baseUrl, token, storageKey);
      const codeX = final.codes.find((c) => c.slug === 'code-x');
      assert.equal(codeX?.parent_slug, 'code-y', `attempt ${attempt}: connection must survive a concurrent unrelated save`);

      // reset for next attempt
      // eslint-disable-next-line no-await-in-loop
      await postCommentModeState(baseUrl, token, storageKey, { ...final, codes: setParent(final.codes, 'code-x', null) });
    }
  } finally {
    server.kill('SIGTERM');
  }
});
