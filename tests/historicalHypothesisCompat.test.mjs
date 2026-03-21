import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLegacyIdentityRecords,
  buildLegacyTopologyRecords,
  collectLegacyEvolutionLinks,
  normalizeLegacyCommentHypothesis,
  readLegacyParentHypothesisId,
} from '../shared/hypothesisLegacyCompat.js';

test('normalizes historical aliases for comments hypotheses and legacy evolution links', () => {
  const hypothesis = normalizeLegacyCommentHypothesis({
    id: 'comment-1',
    state: 'No validada',
    linkedProfiles: ['profile-a', 'profile-a', 'profile-b'],
    parentHypothesisId: 'comment-root',
  });
  const links = collectLegacyEvolutionLinks({
    evolutionLinks: [
      {
        linkId: 'legacy-link',
        sourceHypothesisId: 'comment-1',
        targetMode: 'interview',
        targetId: 'interview-1',
      },
    ],
  }, { storageKey: 'comments-mode:p:c' });

  assert.equal(hypothesis?.validation_status, 'invalidada');
  assert.deepEqual(hypothesis?.linked_profile_ids, ['profile-a', 'profile-b']);
  assert.equal(links[0]?.destination_mode, 'interviews');
  assert.equal(links[0]?.destination_hypothesis_id, 'interview-1');
  assert.equal(links[0]?.storage_key, 'comments-mode:p:c');
});

test('extracts legacy parent relationships from embedded blob metadata and derives fallback identity/topology records', () => {
  const videoParent = readLegacyParentHypothesisId('video', {
    id: 'video-child',
    contexto_cualitativo: '[hypothesis_hierarchy]{"parentHypothesisId":"video-root"}[/hypothesis_hierarchy]',
  });
  const interviewParent = readLegacyParentHypothesisId('interviews', {
    id: 'interview-child',
    observations: '{"hierarchy":{"parent_hypothesis_id":"interview-root"}}',
  });
  const identityRecords = buildLegacyIdentityRecords({
    storageKey: 'comments-mode:p:c',
    evolutionLinks: [{ source_hypothesis_id: 'comment-root', destination_mode: 'video', destination_hypothesis_id: 'video-root' }],
  });
  const topologyRecords = buildLegacyTopologyRecords({
    storageKey: 'comments-mode:p:c',
    hypotheses: [{ id: 'comment-child', parent_hypothesis_id: 'comment-root' }],
    videoRows: [{ id: 'video-child', contexto_cualitativo: '[hypothesis_hierarchy]{"parentHypothesisId":"video-root"}[/hypothesis_hierarchy]' }],
    interviewRows: [{ id: 'interview-child', observations: '{"hierarchy":{"parent_hypothesis_id":"interview-root"}}' }],
  });

  assert.equal(videoParent, 'video-root');
  assert.equal(interviewParent, 'interview-root');
  assert.equal(identityRecords[0]?.nodes?.length, 2);
  assert.deepEqual(
    topologyRecords.map((record) => `${record.parent.mode}:${record.parent.hypothesis_id}->${record.child.mode}:${record.child.hypothesis_id}`),
    [
      'comments:comment-root->comments:comment-child',
      'video:video-root->video:video-child',
      'interviews:interview-root->interviews:interview-child',
    ],
  );
});
