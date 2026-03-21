import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCrossModeIdentityRegistry,
  resolveConceptualHypothesisIdentity,
  listIdentityNodes,
  areHypothesesConceptuallyEquivalent,
} from '../src/modules/hypotheses/services/crossModeIdentity.js';

const createModeNodeRefs = () => ({
  comments: [
    { mode: 'comments', id: 'comment-root', storageKey: 'comments-mode:project:campaign' },
    { mode: 'comments', id: 'comment-child', storageKey: 'comments-mode:project:campaign' },
  ],
  video: [
    { mode: 'video', id: 'video-root' },
    { mode: 'video', id: 'video-standalone' },
  ],
  interviews: [
    { mode: 'interviews', id: 'interview-root' },
  ],
});

test('creates a central conceptual identity that groups cross-mode equivalents and keeps standalone nodes as their own identity', () => {
  const registry = createCrossModeIdentityRegistry({
    modeNodeRefs: createModeNodeRefs(),
    legacyLinks: [
      { source_hypothesis_id: 'comment-root', destination_mode: 'video', destination_hypothesis_id: 'video-root' },
      { source_hypothesis_id: 'comment-root', destination_mode: 'interviews', destination_hypothesis_id: 'interview-root' },
    ],
  });

  const sharedIdentity = resolveConceptualHypothesisIdentity(registry, { mode: 'video', hypothesisId: 'video-root' });
  const standaloneIdentity = resolveConceptualHypothesisIdentity(registry, { mode: 'video', hypothesisId: 'video-standalone' });

  assert.ok(sharedIdentity);
  assert.ok(standaloneIdentity);
  assert.notEqual(sharedIdentity.identityId, standaloneIdentity.identityId);
  assert.deepEqual(
    new Set(listIdentityNodes(registry, sharedIdentity.identityId).map((node) => `${node.mode}:${node.hypothesisId}`)),
    new Set(['comments:comment-root', 'video:video-root', 'interviews:interview-root']),
  );
});

test('prefers explicit central identity records and resolves equivalence directly from the identity layer', () => {
  const registry = createCrossModeIdentityRegistry({
    modeNodeRefs: createModeNodeRefs(),
    explicitIdentityRecords: [
      {
        identity_id: 'lineage-main',
        origin_node: { mode: 'comments', hypothesis_id: 'comment-root', storage_key: 'comments-mode:project:campaign' },
        nodes: [
          { mode: 'comments', hypothesis_id: 'comment-root', storage_key: 'comments-mode:project:campaign', origin: true },
          { mode: 'video', hypothesis_id: 'video-root' },
          { mode: 'interviews', hypothesis_id: 'interview-root' },
        ],
      },
    ],
    legacyLinks: [
      { source_hypothesis_id: 'comment-root', destination_mode: 'video', destination_hypothesis_id: 'video-root' },
    ],
  });

  const commentIdentity = resolveConceptualHypothesisIdentity(registry, { mode: 'comments', hypothesisId: 'comment-root' });
  const interviewIdentity = resolveConceptualHypothesisIdentity(registry, { mode: 'interviews', hypothesisId: 'interview-root' });

  assert.equal(commentIdentity?.identityId, 'lineage-main');
  assert.equal(interviewIdentity?.identityId, 'lineage-main');
  assert.equal(
    areHypothesesConceptuallyEquivalent(
      registry,
      { mode: 'comments', hypothesisId: 'comment-root' },
      { mode: 'interviews', hypothesisId: 'interview-root' },
    ),
    true,
  );
  assert.equal(
    areHypothesesConceptuallyEquivalent(
      registry,
      { mode: 'comments', hypothesisId: 'comment-child' },
      { mode: 'video', hypothesisId: 'video-root' },
    ),
    false,
  );
});
