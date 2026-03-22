import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listAvailableCommentHypothesisProfiles,
  normalizeCommentHypothesisLinkedProfileIds,
} from '../src/modules/comments/services/commentHypothesisProfiles.js';

test('lists every available comment hypothesis profile in the active workspace context without collapsing to a single profile', () => {
  const profiles = listAvailableCommentHypothesisProfiles({
    __all__: {
      profiles: [
        { id: 'profile-1', name: 'Perfil 1' },
        { id: 'profile-2', name: 'Perfil 2' },
      ],
      assignments: { a: 'profile-1' },
    },
    'hypothesis:child': {
      profiles: [
        { id: 'profile-3', name: 'Perfil 3' },
      ],
      assignments: { b: 'profile-3', c: 'profile-3' },
    },
  }, 'hypothesis:child');

  assert.deepEqual(profiles.map((profile) => profile.id), ['profile-1', 'profile-2', 'profile-3']);
  assert.equal(profiles.find((profile) => profile.id === 'profile-3')?.assignmentCount, 2);
});

test('normalizes single-profile legacy payloads into a real multi-profile collection for editing and persistence', () => {
  assert.deepEqual(
    normalizeCommentHypothesisLinkedProfileIds({
      linked_profile_id: 'profile-1',
      profile_id: 'profile-2',
      linked_profile_ids: ['profile-2', 'profile-3'],
    }),
    ['profile-2', 'profile-3', 'profile-1'],
  );
});
