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
