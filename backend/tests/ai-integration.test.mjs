import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
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
  const email = `ai-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123' }),
  });
  const payload = await signup.json();
  return payload.session.access_token;
}

async function createProject(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/db/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'projects', operation: 'insert', payload: { name: 'P', description: '' } }),
  });
  const json = await res.json();
  return json.data[0].id;
}

async function saveAiSettings(baseUrl, token, settings) {
  const res = await fetch(`${baseUrl}/api/integrations/ai/settings`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
  });
  assert.equal(res.status, 200, `saving AI settings should succeed: ${await res.text()}`);
}

async function sendChatMessage(baseUrl, token, projectId, message) {
  const res = await fetch(`${baseUrl}/api/projects/chat/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, message }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function getChatHistory(baseUrl, token, projectId) {
  const res = await fetch(`${baseUrl}/api/projects/chat/history?projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.data.items;
}

function startMockAiServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function mockServerUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function withServer(portSuffix, testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `entre-ai-${portSuffix}-`));
  const port = 4200 + portSuffix;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['backend/src/server.js'], { cwd: process.cwd(), env: { ...process.env, BACKEND_PORT: String(port), SQLITE_PATH: path.join(dir, 'db.sqlite') } });
  try {
    await waitForHealth(baseUrl);
    await testFn(baseUrl);
  } finally {
    server.kill('SIGTERM');
  }
}

test('anthropic provider uses the native /messages shape, not OpenAI /chat/completions', async () => {
  let receivedPath = '';
  let receivedHeaders = {};
  let receivedBody = null;
  const mock = await startMockAiServer((req, res, body) => {
    receivedPath = req.url;
    receivedHeaders = req.headers;
    receivedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Hola desde Anthropic' }],
      usage: { input_tokens: 12, output_tokens: 4 },
    }));
  });

  try {
    await withServer(1, async (baseUrl) => {
      const token = await authed(baseUrl);
      const projectId = await createProject(baseUrl, token);
      await saveAiSettings(baseUrl, token, {
        provider: 'anthropic', model: 'claude-3-5-sonnet-latest', api_key: 'test-key', base_url: mockServerUrl(mock), organization: '',
      });

      const { status, json } = await sendChatMessage(baseUrl, token, projectId, 'Hola');
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.data.assistant_message.content, 'Hola desde Anthropic');
      assert.equal(json.data.usage.prompt_tokens, 12);
      assert.equal(json.data.usage.completion_tokens, 4);

      assert.equal(receivedPath, '/messages');
      assert.equal(receivedHeaders['x-api-key'], 'test-key');
      assert.equal(receivedHeaders['anthropic-version'], '2023-06-01');
      assert.ok(Array.isArray(receivedBody.messages));
      assert.ok(!('temperature' in receivedBody) || typeof receivedBody.temperature === 'number');
      assert.equal(typeof receivedBody.system, 'string');
    });
  } finally {
    mock.close();
  }
});

test('gemini provider uses the native generateContent shape, not OpenAI /chat/completions', async () => {
  let receivedPath = '';
  let receivedBody = null;
  const mock = await startMockAiServer((req, res, body) => {
    receivedPath = req.url;
    receivedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hola desde Gemini' }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
    }));
  });

  try {
    await withServer(2, async (baseUrl) => {
      const token = await authed(baseUrl);
      const projectId = await createProject(baseUrl, token);
      await saveAiSettings(baseUrl, token, {
        provider: 'gemini', model: 'gemini-1.5-flash', api_key: 'test-key', base_url: mockServerUrl(mock), organization: '',
      });

      const { status, json } = await sendChatMessage(baseUrl, token, projectId, 'Hola');
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.data.assistant_message.content, 'Hola desde Gemini');
      assert.equal(json.data.usage.total_tokens, 11);

      assert.ok(receivedPath.startsWith('/models/gemini-1.5-flash:generateContent'));
      assert.ok(Array.isArray(receivedBody.contents));
      assert.equal(typeof receivedBody.systemInstruction?.parts?.[0]?.text, 'string');
    });
  } finally {
    mock.close();
  }
});

test('openai-compatible providers still use the /chat/completions shape', async () => {
  let receivedPath = '';
  let receivedBody = null;
  const mock = await startMockAiServer((req, res, body) => {
    receivedPath = req.url;
    receivedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Hola desde OpenAI-compatible' } }], usage: { total_tokens: 20 } }));
  });

  try {
    await withServer(3, async (baseUrl) => {
      const token = await authed(baseUrl);
      const projectId = await createProject(baseUrl, token);
      await saveAiSettings(baseUrl, token, {
        provider: 'custom_compatible_api', model: 'any-model', api_key: 'test-key', base_url: mockServerUrl(mock), organization: '',
      });

      const { status, json } = await sendChatMessage(baseUrl, token, projectId, 'Hola');
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.data.assistant_message.content, 'Hola desde OpenAI-compatible');

      assert.equal(receivedPath, '/chat/completions');
      assert.ok(Array.isArray(receivedBody.messages));
    });
  } finally {
    mock.close();
  }
});

test('a failed AI call does not leave an orphaned user message in chat history', async () => {
  const mock = await startMockAiServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Simulated provider outage' } }));
  });

  try {
    await withServer(4, async (baseUrl) => {
      const token = await authed(baseUrl);
      const projectId = await createProject(baseUrl, token);
      await saveAiSettings(baseUrl, token, {
        provider: 'custom_compatible_api', model: 'any-model', api_key: 'test-key', base_url: mockServerUrl(mock), organization: '',
      });

      const { status } = await sendChatMessage(baseUrl, token, projectId, 'Esto va a fallar');
      assert.equal(status, 502);

      const history = await getChatHistory(baseUrl, token, projectId);
      assert.equal(history.length, 0, 'no message should be persisted when the AI call fails');
    });
  } finally {
    mock.close();
  }
});

test('/api/integrations/ai/test reports success and failure without needing the settings saved first', async () => {
  const mock = await startMockAiServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });

  try {
    await withServer(5, async (baseUrl) => {
      const token = await authed(baseUrl);

      const okRes = await fetch(`${baseUrl}/api/integrations/ai/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'custom_compatible_api', model: 'any-model', api_key: 'test-key', base_url: mockServerUrl(mock) }),
      });
      const okJson = await okRes.json();
      assert.equal(okRes.status, 200);
      assert.equal(okJson.data.ok, true);

      const failRes = await fetch(`${baseUrl}/api/integrations/ai/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', model: 'claude-3-5-sonnet-latest', api_key: '', base_url: '' }),
      });
      const failJson = await failRes.json();
      assert.equal(failRes.status, 200);
      assert.equal(failJson.data.ok, false);
      assert.match(failJson.data.error, /api key/i);
    });
  } finally {
    mock.close();
  }
});
