import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeKey } from '../src/modules/hypotheses/services/crossModeGraphCore.js';
import {
  createResolverContext,
  resolveEquivalentNodes,
  resolveDescendants,
  resolveCrossModeBranch,
} from '../src/modules/hypotheses/services/crossModeBranchResolver.js';

function createResolverFixture() {
  const identities = new Map([
    ['lineage-root', {
      identityId: 'lineage-root',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-root', nodeKey: buildNodeKey('comments', 'comment-root') },
        { mode: 'video', hypothesisId: 'video-root', nodeKey: buildNodeKey('video', 'video-root') },
        { mode: 'interviews', hypothesisId: 'interview-root', nodeKey: buildNodeKey('interviews', 'interview-root') },
      ],
    }],
    ['lineage-child', {
      identityId: 'lineage-child',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-child', nodeKey: buildNodeKey('comments', 'comment-child') },
        { mode: 'video', hypothesisId: 'video-child', nodeKey: buildNodeKey('video', 'video-child') },
        { mode: 'interviews', hypothesisId: 'interview-child', nodeKey: buildNodeKey('interviews', 'interview-child') },
      ],
    }],
  ]);

  const nodeToIdentity = new Map([
    [buildNodeKey('comments', 'comment-root'), 'lineage-root'],
    [buildNodeKey('video', 'video-root'), 'lineage-root'],
    [buildNodeKey('interviews', 'interview-root'), 'lineage-root'],
    [buildNodeKey('comments', 'comment-child'), 'lineage-child'],
    [buildNodeKey('video', 'video-child'), 'lineage-child'],
    [buildNodeKey('interviews', 'interview-child'), 'lineage-child'],
  ]);

  const childrenByNodeKey = new Map([
    [buildNodeKey('comments', 'comment-root'), [{ mode: 'comments', hypothesisId: 'comment-child', nodeKey: buildNodeKey('comments', 'comment-child') }]],
    [buildNodeKey('video', 'video-root'), [{ mode: 'video', hypothesisId: 'video-child', nodeKey: buildNodeKey('video', 'video-child') }]],
    [buildNodeKey('interviews', 'interview-root'), [{ mode: 'interviews', hypothesisId: 'interview-child', nodeKey: buildNodeKey('interviews', 'interview-child') }]],
  ]);

  return createResolverContext({ identities, nodeToIdentity, childrenByNodeKey });
}

test('resolveEquivalentNodes returns only direct conceptual equivalents across modes', () => {
  const context = createResolverFixture();
  const equivalents = resolveEquivalentNodes(context, { mode: 'video', hypothesisId: 'video-root' }, { includeSelf: false });

  assert.deepEqual(
    new Set(equivalents.map((node) => node.nodeKey)),
    new Set(['comments:comment-root', 'interviews:interview-root']),
  );
});

test('resolveDescendants returns only hierarchical descendants for the requested node', () => {
  const context = createResolverFixture();
  const descendants = resolveDescendants(context, { mode: 'video', hypothesisId: 'video-root' });

  assert.deepEqual(descendants.map((node) => node.nodeKey), ['video:video-child']);
});

test('resolveCrossModeBranch returns the full multi-mode branch without writes or mutations', () => {
  const context = createResolverFixture();
  const branch = resolveCrossModeBranch(context, { mode: 'video', hypothesisId: 'video-root' }, { includeRoot: true });

  assert.deepEqual(
    new Set(branch.map((node) => node.nodeKey)),
    new Set([
      'video:video-root',
      'comments:comment-root',
      'interviews:interview-root',
      'video:video-child',
      'comments:comment-child',
      'interviews:interview-child',
    ]),
  );
});
