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
  const email = `comment-mode-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

async function setupEntities(baseUrl, token) {
  const project = await dbQuery(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'Proyecto Comments', description: '' } });
  const campaign = await dbQuery(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'Campaña Comments', description: '' } });
  return { projectId: project[0].id, campaignId: campaign[0].id };
}

test('comment mode state persists structurally in backend and lists workspace-scoped stores', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-comment-mode-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4113;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, campaignId } = await setupEntities(baseUrl, token);

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Workspace A', description: '', status: 'active' }),
    });
    assert.equal(workspaceRes.status, 200);
    const workspaceJson = await workspaceRes.json();
    const workspaceId = workspaceJson?.data?.id;
    assert.ok(workspaceId);

    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;
    const payload = {
      hypotheses: [
        {
          id: 'comment-h-1',
          title: 'Hipótesis Comments',
          parent_hypothesis_id: '',
          validation_status: 'validada',
          linked_profile_ids: ['profile-a', 'profile-b'],
        },
        {
          id: 'comment-h-2',
          title: 'Hipótesis hija',
          parent_hypothesis_id: 'comment-h-1',
          validation_status: 'inconclusa',
          linked_profile_ids: ['profile-b'],
        },
      ],
      hypothesisEvolutionLinks: [
        {
          id: 'link-1',
          source_hypothesis_id: 'comment-h-1',
          destination_mode: 'video',
          destination_hypothesis_id: 'video-h-1',
        },
      ],
      hypothesisCrossModeIdentities: [
        {
          identity_id: 'lineage-1',
          nodes: [
            { mode: 'comments', hypothesis_id: 'comment-h-1' },
            { mode: 'video', hypothesis_id: 'video-h-1' },
          ],
        },
      ],
    };

    const saveRes = await fetch(`${baseUrl}/api/comment-mode/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageKey, payload }),
    });
    assert.equal(saveRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/comment-mode/state?${new URLSearchParams({ storageKey }).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson?.data?.payload?.hypotheses?.length, 2);
    assert.equal(getJson?.data?.payload?.hypothesisEvolutionLinks?.length, 1);

    const listRes = await fetch(`${baseUrl}/api/comment-mode/states?${new URLSearchParams({ projectId, campaignId }).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson?.data?.items?.length, 1);
    assert.equal(listJson?.data?.items?.[0]?.storage_key, storageKey);

    const hypothesesRows = await dbQuery(baseUrl, token, {
      table: 'comment_mode_hypotheses',
      operation: 'select',
      filters: [{ field: 'workspace_id', value: workspaceId }],
    });
    assert.equal(hypothesesRows.length, 2);
    const rootRow = hypothesesRows.find((row) => String(row.hypothesis_id) === 'comment-h-1');
    assert.equal(rootRow?.lineage_id, 'lineage-1');
    assert.equal(rootRow?.validation_status, 'validada');

    const profileRows = await dbQuery(baseUrl, token, {
      table: 'comment_mode_hypothesis_profiles',
      operation: 'select',
      filters: [{ field: 'workspace_id', value: workspaceId }],
    });
    assert.equal(profileRows.length, 3);

    const evolutionRows = await dbQuery(baseUrl, token, {
      table: 'comment_mode_evolution_links',
      operation: 'select',
      filters: [{ field: 'workspace_id', value: workspaceId }],
    });
    assert.equal(evolutionRows.length, 1);
    assert.equal(evolutionRows[0]?.destination_mode, 'video');
  } finally {
    server.kill('SIGTERM');
  }
});
