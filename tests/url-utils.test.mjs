import test from 'node:test';
import assert from 'node:assert/strict';
import { toUrlString, toWebSocketUrl } from '../src/lib/url.js';

test('Case A: string ws url keeps ws', () => {
  assert.equal(toUrlString('ws://localhost:4000'), 'ws://localhost:4000');
  assert.equal(toWebSocketUrl('ws://localhost:4000'), 'ws://localhost:4000');
});

test('Case B: URL http converts to ws', () => {
  const url = new URL('http://localhost:4000');
  assert.equal(toUrlString(url), 'http://localhost:4000/');
  assert.equal(toWebSocketUrl(url), 'ws://localhost:4000/');
});

test('Case C: href object https converts to wss', () => {
  const hrefObj = { href: 'https://x.com' };
  assert.equal(toUrlString(hrefObj), 'https://x.com');
  assert.equal(toWebSocketUrl(hrefObj), 'wss://x.com');
});

test('Case D: undefined is safe and empty', () => {
  assert.equal(toUrlString(undefined), '');
  assert.equal(toWebSocketUrl(undefined), '');
});
