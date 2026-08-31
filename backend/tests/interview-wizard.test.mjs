import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error('server not ready');
}

async function authed(baseUrl) {
  const email = `iv-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123' }),
  });
  const payload = await signup.json();
  return payload.session.access_token;
}

async function db(baseUrl, token, body) {
  const res = await fetch(`${baseUrl}/api/db/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'db error');
  return json.data;
}

async function setup(baseUrl, token) {
  const project = await db(baseUrl, token, { table: 'projects', operation: 'insert', payload: { name: 'P', description: '' } });
  const campaign = await db(baseUrl, token, { table: 'campaigns', operation: 'insert', payload: { project_id: project[0].id, name: 'C', description: '' } });
  const audience = await db(baseUrl, token, { table: 'audiences', operation: 'insert', payload: { campaign_id: campaign[0].id, name: 'A', description: '' } });
  return { projectId: project[0].id, campaignId: campaign[0].id, audienceId: audience[0].id };
}

async function createClient(baseUrl, token, projectId, campaignId, audienceId) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Cliente', audience_id: audienceId }),
  });
  const json = await res.json();
  return json.data;
}

async function createForm(baseUrl, token, projectId, campaignId) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/forms`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Form', questions: [{ id: 'q1', type: 'short_text', title: 'Nombre', required: true }] }),
  });
  const json = await res.json();
  return json.data;
}

test('completed session requires required answers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-1-'));
  const baseUrl = 'http://127.0.0.1:4120';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4120', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'completed', responses: {} }),
    });
    assert.equal(res.status, 400);
  } finally { server.kill('SIGTERM'); }
});

test('draft session can be created and updated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-2-'));
  const baseUrl = 'http://127.0.0.1:4121';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4121', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const createRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'draft', responses: {} }),
    });
    const created = (await createRes.json()).data;
    const updateRes = await fetch(`${baseUrl}/api/interview-sessions/${created.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'draft', responses: { q1: 'ok' } }),
    });
    const updated = (await updateRes.json()).data;
    assert.equal(updated.status, 'draft');
    assert.equal(updated.responses_json.q1, 'ok');
  } finally { server.kill('SIGTERM'); }
});

test('saved session stores form snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-3-'));
  const baseUrl = 'http://127.0.0.1:4122';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4122', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'completed', responses: { q1: 'valor' } }),
    });
    const data = (await res.json()).data;
    assert.ok(data.form_snapshot_json);
    assert.equal(data.form_snapshot_json.questions[0].title, 'Nombre');
  } finally { server.kill('SIGTERM'); }
});


test('db query allows interview_hypotheses with user scoping intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-4-'));
  const baseUrl = 'http://127.0.0.1:4123';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4123', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const tokenA = await authed(baseUrl);
    const tokenB = await authed(baseUrl);
    const { projectId: projectA, campaignId: campaignA } = await setup(baseUrl, tokenA);
    const { projectId: projectB, campaignId: campaignB } = await setup(baseUrl, tokenB);

    const inserted = await db(baseUrl, tokenA, {
      table: 'interview_hypotheses',
      operation: 'insert',
      payload: {
        project_id: projectA,
        campaign_id: campaignA,
        type: 'insight',
        title: 'Hipótesis entrevista',
        description: 'Detalle',
        validation_result: 'pendiente',
        observations: 'obs',
      },
    });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].campaign_id, campaignA);
    assert.ok(inserted[0].user_id);
    assert.equal(inserted[0].validation_result, 'inconclusa');

    const selectedByOwner = await db(baseUrl, tokenA, {
      table: 'interview_hypotheses',
      operation: 'select',
      filters: [{ field: 'id', value: inserted[0].id }],
    });
    assert.equal(selectedByOwner.length, 1);

    const selectedByOtherUser = await db(baseUrl, tokenB, {
      table: 'interview_hypotheses',
      operation: 'select',
      filters: [{ field: 'id', value: inserted[0].id }, { field: 'campaign_id', value: campaignB }, { field: 'project_id', value: projectB }],
    });
    assert.equal(selectedByOtherUser.length, 0);
  } finally { server.kill('SIGTERM'); }
});

test('creating an interview client returns the created record (regression: INSERT column/placeholder mismatch)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-5-'));
  const baseUrl = 'http://127.0.0.1:4124';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4124', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cliente Nuevo', contact: 'cliente@example.com', audience_id: audienceId }),
    });
    assert.equal(res.status, 200);
    const client = (await res.json()).data;
    assert.ok(client && client.id, 'la respuesta debe incluir el cliente creado con id');
    assert.equal(client.name, 'Cliente Nuevo');
    assert.equal(client.contact, 'cliente@example.com');
    assert.equal(client.status, 'active');
  } finally { server.kill('SIGTERM'); }
});

test('archiving a client persists and reactivating restores it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-6-'));
  const baseUrl = 'http://127.0.0.1:4125';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4125', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    assert.equal(client.status, 'active');

    const archiveRes = await fetch(`${baseUrl}/api/interview-clients/${client.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...client, status: 'archived' }),
    });
    const archived = (await archiveRes.json()).data;
    assert.equal(archived.status, 'archived');

    const listRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/clients`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()).data;
    assert.equal(list.find((c) => c.id === client.id).status, 'archived');

    const reactivateRes = await fetch(`${baseUrl}/api/interview-clients/${client.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...archived, status: 'active' }),
    });
    const reactivated = (await reactivateRes.json()).data;
    assert.equal(reactivated.status, 'active');
  } finally { server.kill('SIGTERM'); }
});

test('creating a semantic fragment succeeds (regression: INSERT column/placeholder mismatch)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-7-'));
  const baseUrl = 'http://127.0.0.1:4126';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4126', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const sessionRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'completed', responses: { q1: 'ok' } }),
    });
    const session = (await sessionRes.json()).data;

    const fragmentRes = await fetch(`${baseUrl}/api/interviews/fragments`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ interview_session_id: session.id, source_type: 'manual', selected_text: 'cita de prueba' }),
    });
    assert.equal(fragmentRes.status, 201);
    const fragment = (await fragmentRes.json()).data;
    assert.ok(fragment?.id, 'la respuesta debe incluir el fragmento creado con id');
    assert.equal(fragment.selected_text, 'cita de prueba');

    const listRes = await fetch(`${baseUrl}/api/interviews/fragments?documentNodeId=&projectId=${projectId}&campaignId=${campaignId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()).data || [];
    assert.ok(list.some((item) => item.id === fragment.id));
  } finally { server.kill('SIGTERM'); }
});

test('deleting a client cascades and removes its interview sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-8-'));
  const baseUrl = 'http://127.0.0.1:4127';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4127', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const sessionRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'completed', responses: { q1: 'respuesta grabada' } }),
    });
    const session = (await sessionRes.json()).data;
    assert.equal((await fetch(`${baseUrl}/api/interview-sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);

    const deleteRes = await fetch(`${baseUrl}/api/interview-clients/${client.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(deleteRes.status, 200);

    const afterRes = await fetch(`${baseUrl}/api/interview-sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(afterRes.status, 404, 'la sesion debe desaparecer en cascada al borrar el cliente (ON DELETE CASCADE documentado)');
  } finally { server.kill('SIGTERM'); }
});

test('deleting a form cascades and removes its interview sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-9-'));
  const baseUrl = 'http://127.0.0.1:4128';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4128', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const sessionRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, form_id: form.id, status: 'completed', responses: { q1: 'respuesta grabada' } }),
    });
    const session = (await sessionRes.json()).data;
    assert.equal((await fetch(`${baseUrl}/api/interview-sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);

    const deleteRes = await fetch(`${baseUrl}/api/interview-forms/${form.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(deleteRes.status, 200);

    const afterRes = await fetch(`${baseUrl}/api/interview-sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(afterRes.status, 404, 'la sesion debe desaparecer en cascada al borrar el formulario (ON DELETE CASCADE documentado)');
  } finally { server.kill('SIGTERM'); }
});

test('deleting a hypothesis does NOT cascade to interview sessions (ON DELETE SET NULL)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entre-iv-10-'));
  const baseUrl = 'http://127.0.0.1:4129';
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: '4129', SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    const token = await authed(baseUrl);
    const { projectId, campaignId, audienceId } = await setup(baseUrl, token);
    const client = await createClient(baseUrl, token, projectId, campaignId, audienceId);
    const form = await createForm(baseUrl, token, projectId, campaignId);
    const hypRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/hypotheses`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'problema', title: 'Hipotesis' }),
    });
    const hypothesis = (await hypRes.json()).data;
    const sessionRes = await fetch(`${baseUrl}/api/projects/${projectId}/campaigns/${campaignId}/interviews/sessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, form_id: form.id, interview_hypothesis_id: hypothesis.id, status: 'completed', responses: { q1: 'x' } }),
    });
    const session = (await sessionRes.json()).data;

    const deleteRes = await fetch(`${baseUrl}/api/interview-hypotheses/${hypothesis.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(deleteRes.status, 200);

    const afterRes = await fetch(`${baseUrl}/api/interview-sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(afterRes.status, 200, 'la sesion debe sobrevivir al borrar la hipotesis');
    const after = (await afterRes.json()).data;
    assert.equal(after.interview_hypothesis_id, null, 'el vinculo a la hipotesis debe quedar en null, no seguir apuntando a una hipotesis borrada');
  } finally { server.kill('SIGTERM'); }
});
