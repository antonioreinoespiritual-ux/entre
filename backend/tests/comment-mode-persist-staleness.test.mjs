import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommentsModeStorePayloads, createEmptyCommentsStore } from '../../src/modules/comments/services/commentsModeStore.js';

// This exercises the exact composition sequence used by persist() in
// CommentsModePage.jsx: mergeCommentsModeStorePayloads(storeRef.current, next).
// Before the fix, storeRef.current was only synced via a `useEffect` that
// runs after paint, so two persist() calls fired before that flush both read
// the SAME base and the second call's setStore() silently discarded whatever
// the first call had added. The fix updates storeRef.current synchronously
// inside persist() itself - modeled here as `simulatedPersist`.

const T0 = '2026-09-01T08:22:08.000Z';

function seedCodes() {
  return [
    { slug: 'code-a', name: 'Código A', parent_slug: null, created_at: T0, updated_at: T0 },
    { slug: 'code-b', name: 'Código B', parent_slug: null, created_at: T0, updated_at: T0 },
    { slug: 'code-c', name: 'Código C', parent_slug: null, created_at: T0, updated_at: T0 },
    { slug: 'code-d', name: 'Código D', parent_slug: null, created_at: T0, updated_at: T0 },
  ];
}

function setParent(codes, slug, parentSlug) {
  return codes.map((code) => (code.slug === slug ? { ...code, parent_slug: parentSlug, updated_at: new Date().toISOString() } : code));
}

test('persist() with synchronous storeRef update preserves both connections made back-to-back', () => {
  const store0 = { ...createEmptyCommentsStore(), codes: seedCodes() };

  // storeRef modeled as a plain mutable box, updated synchronously by
  // simulatedPersist - this is the fixed behavior.
  const storeRef = { current: store0 };
  function simulatedPersist(next) {
    const normalizedNext = mergeCommentsModeStorePayloads(storeRef.current, next);
    storeRef.current = normalizedNext; // <- the fix: synchronous, not via useEffect
    return normalizedNext;
  }

  // Two persist() calls fired back-to-back, both derived from store0's codes
  // array (as a component render closure would capture at click time).
  simulatedPersist({ ...store0, codes: setParent(store0.codes, 'code-a', 'code-b') });
  const afterSecond = simulatedPersist({ ...store0, codes: setParent(store0.codes, 'code-c', 'code-d') });

  const codeA = afterSecond.codes.find((c) => c.slug === 'code-a');
  const codeC = afterSecond.codes.find((c) => c.slug === 'code-c');

  assert.equal(codeA.parent_slug, 'code-b', 'first connection must survive a second persist() call fired right after it');
  assert.equal(codeC.parent_slug, 'code-d', 'second connection must also be present');
});

test('sanity check: without the synchronous storeRef update, the first connection is lost (documents the original bug)', () => {
  const store0 = { ...createEmptyCommentsStore(), codes: seedCodes() };

  // storeRef only updates asynchronously (e.g. via useEffect after paint) -
  // both calls below see the SAME stale base, reproducing the original bug.
  const staleStoreRef = { current: store0 };
  function buggyPersist(next) {
    return mergeCommentsModeStorePayloads(staleStoreRef.current, next);
  }

  buggyPersist({ ...store0, codes: setParent(store0.codes, 'code-a', 'code-b') });
  const afterSecond = buggyPersist({ ...store0, codes: setParent(store0.codes, 'code-c', 'code-d') });

  const codeA = afterSecond.codes.find((c) => c.slug === 'code-a');
  assert.equal(codeA.parent_slug, null, 'documents that the pre-fix pattern loses the first connection');
});
