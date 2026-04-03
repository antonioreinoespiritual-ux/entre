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

test('comment mode state absorbs legacy payload aliases and reconstructs explicit compatibility records', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-comment-mode-legacy-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4114;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, campaignId } = await setupEntities(baseUrl, token);

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Legacy Workspace', description: '', status: 'active' }),
    });
    assert.equal(workspaceRes.status, 200);
    const workspaceJson = await workspaceRes.json();
    const workspaceId = workspaceJson?.data?.id;
    assert.ok(workspaceId);

    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;
    const payload = {
      hypotheses: [
        {
          id: 'legacy-comment-root',
          state: 'señal fuerte',
          linkedProfiles: ['profile-a'],
        },
        {
          id: 'legacy-comment-child',
          status: 'pending',
          parentHypothesisId: 'legacy-comment-root',
          profile_ids: ['profile-b'],
        },
      ],
      evolutionLinks: [
        {
          linkId: 'legacy-link-1',
          sourceHypothesisId: 'legacy-comment-root',
          targetMode: 'video',
          targetId: 'legacy-video-root',
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
    const normalizedPayload = getJson?.data?.payload;
    assert.equal(normalizedPayload?.hypotheses?.[0]?.validation_status, 'validada');
    assert.equal(normalizedPayload?.hypotheses?.[1]?.parent_hypothesis_id, 'legacy-comment-root');
    assert.equal(normalizedPayload?.hypothesisEvolutionLinks?.[0]?.destination_mode, 'video');
    assert.equal(normalizedPayload?.hypothesisCrossModeIdentities?.[0]?.origin_node?.hypothesis_id, 'legacy-comment-root');
    assert.equal(normalizedPayload?.hypothesisTopology?.[0]?.parent?.hypothesis_id, 'legacy-comment-root');

    const hypothesisRows = await dbQuery(baseUrl, token, {
      table: 'comment_mode_hypotheses',
      operation: 'select',
      filters: [{ field: 'workspace_id', value: workspaceId }],
    });
    const rootRow = hypothesisRows.find((row) => String(row.hypothesis_id) === 'legacy-comment-root');
    const childRow = hypothesisRows.find((row) => String(row.hypothesis_id) === 'legacy-comment-child');
    assert.equal(rootRow?.validation_status, 'validada');
    assert.equal(childRow?.parent_hypothesis_id, 'legacy-comment-root');
    assert.match(String(rootRow?.lineage_id || ''), /legacy_identity:legacy-comment-root/);

    const evolutionRows = await dbQuery(baseUrl, token, {
      table: 'comment_mode_evolution_links',
      operation: 'select',
      filters: [{ field: 'workspace_id', value: workspaceId }],
    });
    assert.equal(evolutionRows[0]?.destination_mode, 'video');
    assert.equal(evolutionRows[0]?.link_id, 'legacy-link-1');
  } finally {
    server.kill('SIGTERM');
  }
});

test('manual comment-mode state changes are blocked by active evolutions in the descendant branch and allowed when only deleted links remain', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-comment-mode-manual-state-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4115;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, campaignId } = await setupEntities(baseUrl, token);

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Manual State Workspace', description: '', status: 'active' }),
    });
    const workspaceJson = await workspaceRes.json();
    const workspaceId = workspaceJson?.data?.id;
    assert.ok(workspaceId);

    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;
    const initialPayload = {
      hypotheses: [
        { id: 'root', title: 'Raíz', validation_status: 'inconclusa' },
        { id: 'child', title: 'Hija', parent_hypothesis_id: 'root', validation_status: 'inconclusa' },
      ],
      hypothesisEvolutionLinks: [
        { id: 'active-link', source_hypothesis_id: 'child', destination_mode: 'video', destination_hypothesis_id: 'video-child' },
      ],
    };

    const saveRes = await fetch(`${baseUrl}/api/comment-mode/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageKey, payload: initialPayload }),
    });
    assert.equal(saveRes.status, 200);

    const blockedRes = await fetch(`${baseUrl}/api/comment-mode/hypotheses/manual-state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageKey, hypothesisId: 'root', nextState: 'validada' }),
    });
    assert.equal(blockedRes.status, 409);
    const blockedJson = await blockedRes.json();
    assert.match(String(blockedJson?.error || ''), /rama/i);

    const saveDeletedLinkRes = await fetch(`${baseUrl}/api/comment-mode/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageKey,
        payload: {
          ...initialPayload,
          hypothesisEvolutionLinks: [
            { id: 'deleted-link', source_hypothesis_id: 'child', destination_mode: 'video', destination_hypothesis_id: 'video-child', deleted_at: new Date().toISOString() },
          ],
        },
      }),
    });
    assert.equal(saveDeletedLinkRes.status, 200);

    const allowedRes = await fetch(`${baseUrl}/api/comment-mode/hypotheses/manual-state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageKey, hypothesisId: 'root', nextState: 'validada' }),
    });
    assert.equal(allowedRes.status, 200);
    const allowedJson = await allowedRes.json();
    assert.equal(allowedJson?.data?.payload?.hypotheses?.find((item) => item.id === 'root')?.validation_status, 'validada');
    assert.equal(allowedJson?.data?.payload?.hypotheses?.find((item) => item.id === 'child')?.validation_status, 'inconclusa');
  } finally {
    server.kill('SIGTERM');
  }
});

test('comment mode state persistence merges concurrent partial saves instead of overwriting entities from another tab', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-comment-mode-merge-safe-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const port = 4117;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: dbPath }, stdio: 'pipe' });

  try {
    await waitForHealth(baseUrl);
    const token = await createSession(baseUrl);
    const { projectId, campaignId } = await setupEntities(baseUrl, token);

    const workspaceRes = await fetch(`${baseUrl}/api/comment-base/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, campaign_id: campaignId, name: 'Merge-safe Workspace', description: '', status: 'active' }),
    });
    assert.equal(workspaceRes.status, 200);
    const workspaceId = (await workspaceRes.json())?.data?.id;
    assert.ok(workspaceId);

    const storageKey = `comments-mode:${projectId}:${campaignId}:workspace:${workspaceId}`;

    const saveFromTabA = await fetch(`${baseUrl}/api/comment-mode/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageKey,
        payload: {
          hypotheses: [
            { id: 'hyp-a', title: 'Hipótesis A', validation_status: 'inconclusa', updated_at: '2026-01-01T00:00:00.000Z' },
          ],
          codes: [
            { id: 'code-a', slug: 'code-a', label: 'Código A', updated_at: '2026-01-01T00:00:00.000Z' },
          ],
        },
      }),
    });
    assert.equal(saveFromTabA.status, 200);

    const saveFromTabB = await fetch(`${baseUrl}/api/comment-mode/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageKey,
        payload: {
          hypotheses: [
            { id: 'hyp-b', title: 'Hipótesis B', validation_status: 'validada', updated_at: '2026-01-02T00:00:00.000Z' },
          ],
          codeProposals: [
            { id: 'proposal-b', updated_at: '2026-01-02T00:00:00.000Z', name: 'Propuesta B' },
          ],
        },
      }),
    });
    assert.equal(saveFromTabB.status, 200);
    const saveFromTabBJson = await saveFromTabB.json();
    assert.equal(saveFromTabBJson?.data?.payload?.hypotheses?.length, 2);
    assert.equal(saveFromTabBJson?.data?.payload?.codes?.length, 1);
    assert.equal(saveFromTabBJson?.data?.payload?.codeProposals?.length, 1);

    const getRes = await fetch(`${baseUrl}/api/comment-mode/state?${new URLSearchParams({ storageKey }).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    const hypotheses = Array.isArray(getJson?.data?.payload?.hypotheses) ? getJson.data.payload.hypotheses : [];
    assert.deepEqual(hypotheses.map((item) => String(item.id)).sort(), ['hyp-a', 'hyp-b']);
    assert.equal(getJson?.data?.payload?.codes?.length, 1);
    assert.equal(getJson?.data?.payload?.codeProposals?.length, 1);
  } finally {
    server.kill('SIGTERM');
  }
});
