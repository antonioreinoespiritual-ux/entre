import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCrossModeTopologyRegistry,
  resolveStructuralParent,
  listStructuralChildren,
  listStructuralDescendants,
} from '../src/modules/hypotheses/services/crossModeTopology.js';

test('keeps parent-child topology separate from cross-mode identity and resolves direct parent/children explicitly', () => {
  const registry = createCrossModeTopologyRegistry({
    explicitTopologyRecords: [
      {
        parent: { mode: 'video', hypothesis_id: 'video-root' },
        child: { mode: 'video', hypothesis_id: 'video-child' },
        source: 'explicit',
      },
    ],
    legacyTopologyRecords: [
      {
        parent: { mode: 'comments', hypothesis_id: 'comment-root', storage_key: 'comments-mode:test' },
        child: { mode: 'comments', hypothesis_id: 'comment-child', storage_key: 'comments-mode:test' },
        source: 'legacy_comments_parent_field',
      },
    ],
  });

  assert.deepEqual(resolveStructuralParent(registry, { mode: 'video', hypothesisId: 'video-child' }), {
    mode: 'video',
    hypothesisId: 'video-root',
    nodeKey: 'video:video-root',
    storageKey: undefined,
  });
  assert.deepEqual(
    listStructuralChildren(registry, { mode: 'comments', hypothesisId: 'comment-root' }).map((node) => node.nodeKey),
    ['comments:comment-child'],
  );
});

test('resolves descendant branches from the explicit topology registry without parsing text blobs', () => {
  const registry = createCrossModeTopologyRegistry({
    explicitTopologyRecords: [
      {
        parent: { mode: 'interviews', hypothesis_id: 'interview-root' },
        child: { mode: 'interviews', hypothesis_id: 'interview-child' },
        source: 'explicit',
      },
      {
        parent: { mode: 'interviews', hypothesis_id: 'interview-child' },
        child: { mode: 'interviews', hypothesis_id: 'interview-leaf' },
        source: 'explicit',
      },
    ],
  });

  assert.deepEqual(
    listStructuralDescendants(registry, { mode: 'interviews', hypothesisId: 'interview-root' }).map((node) => node.nodeKey),
    ['interviews:interview-child', 'interviews:interview-leaf'],
  );
});

test('explicit topology records override legacy fallback relations for the same child node', () => {
  const registry = createCrossModeTopologyRegistry({
    explicitTopologyRecords: [
      {
        parent: { mode: 'video', hypothesis_id: 'video-parent-new' },
        child: { mode: 'video', hypothesis_id: 'video-child' },
        source: 'explicit',
      },
    ],
    legacyTopologyRecords: [
      {
        parent: { mode: 'video', hypothesis_id: 'video-parent-legacy' },
        child: { mode: 'video', hypothesis_id: 'video-child' },
        source: 'legacy_video_hierarchy_metadata',
      },
    ],
  });

  assert.equal(resolveStructuralParent(registry, { mode: 'video', hypothesisId: 'video-child' })?.nodeKey, 'video:video-parent-new');
  assert.equal(registry.records.length, 1);
});
