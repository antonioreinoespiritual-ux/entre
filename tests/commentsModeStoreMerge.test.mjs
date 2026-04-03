import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommentsModeStorePayloads } from '../src/modules/comments/services/commentsModeStore.js';

test('mergeCommentsModeStorePayloads preserves entities created in different tabs', () => {
  const tabA = {
    hypotheses: [
      { id: 'hyp-a', title: 'Hipótesis A', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    codes: [
      { id: 'code-a', slug: 'code-a', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  };
  const tabB = {
    hypotheses: [
      { id: 'hyp-b', title: 'Hipótesis B', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
    codeProposals: [
      { id: 'proposal-b', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
  };

  const merged = mergeCommentsModeStorePayloads(tabA, tabB);
  assert.deepEqual(merged.hypotheses.map((item) => item.id).sort(), ['hyp-a', 'hyp-b']);
  assert.equal(merged.codes.length, 1);
  assert.equal(merged.codeProposals.length, 1);
});

test('mergeCommentsModeStorePayloads uses latest updated_at when the same entity is edited in two tabs', () => {
  const base = {
    hypotheses: [
      { id: 'hyp-a', title: 'Versión vieja', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
  };
  const incoming = {
    hypotheses: [
      { id: 'hyp-a', title: 'Versión nueva', updated_at: '2026-01-03T00:00:00.000Z' },
    ],
  };

  const merged = mergeCommentsModeStorePayloads(base, incoming);
  assert.equal(merged.hypotheses.length, 1);
  assert.equal(merged.hypotheses[0].title, 'Versión nueva');
});
