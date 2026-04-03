import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  const email = `comment-dataset-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

test('legacy comment dataset uniqueness is migrated to workspace-scoped uniqueness', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-comment-dataset-migration-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE comment_dataset_comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      audience_id TEXT,
      hypothesis_id TEXT,
      source TEXT NOT NULL,
      source_comment_id TEXT NOT NULL,
      parent_comment_id TEXT,
      video_id TEXT,
      channel_id TEXT,
      author_name TEXT,
      author_channel_id TEXT,
      text TEXT NOT NULL,
      published_at TEXT,
      like_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      source_job TEXT,
      source_run_id TEXT,
      source_query_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id, campaign_id, source, source_comment_id)
    );
  `);
  db.close();

  const port = 4116;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const project = await dbQuery(baseUrl, token, {
      table: 'projects',
      operation: 'insert',
      payload: { name: 'Proyecto migration', description: '' },
    });
    const projectId = project[0].id;
    const userId = project[0].user_id;
    const campaign = await dbQuery(baseUrl, token, {
      table: 'campaigns',
      operation: 'insert',
      payload: { project_id: projectId, name: 'Campaña migration', description: '' },
    });
    const campaignId = campaign[0].id;

    const workspaceOneRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Workspace 1', description: '', status: 'active' }),
    });
    assert.equal(workspaceOneRes.status, 200);
    const workspaceOneId = (await workspaceOneRes.json())?.data?.id;
    assert.ok(workspaceOneId);

    const workspaceTwoRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Workspace 2', description: '', status: 'active' }),
    });
    assert.equal(workspaceTwoRes.status, 200);
    const workspaceTwoId = (await workspaceTwoRes.json())?.data?.id;
    assert.ok(workspaceTwoId);

    const runtimeDb = new DatabaseSync(dbPath);
    runtimeDb.exec('PRAGMA foreign_keys = ON;');
    const insertStatement = runtimeDb.prepare(`
      INSERT INTO comment_dataset_comments (
        id, user_id, project_id, campaign_id, workspace_id, source, source_comment_id, text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    insertStatement.run('comment-a', userId, projectId, campaignId, workspaceOneId, 'youtube', 'same-comment', 'Comentario A');
    insertStatement.run('comment-b', userId, projectId, campaignId, workspaceTwoId, 'youtube', 'same-comment', 'Comentario B');

    const rows = runtimeDb.prepare(`
      SELECT workspace_id, source_comment_id
      FROM comment_dataset_comments
      WHERE project_id = ? AND campaign_id = ?
      ORDER BY workspace_id ASC
    `).all(projectId, campaignId);
    runtimeDb.close();

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => String(row.workspace_id)), [String(workspaceOneId), String(workspaceTwoId)].sort());
    assert.equal(new Set(rows.map((row) => String(row.source_comment_id))).size, 1);
  } finally {
    server.kill('SIGTERM');
  }
});
