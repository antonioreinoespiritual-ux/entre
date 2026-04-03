import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeKey } from '../src/modules/hypotheses/services/crossModeGraphCore.js';
import {
  buildStateTransitionPlan,
  createResolverContext,
  STATE_TRANSITION_ACTIONS,
  resolveCanonicalStateForAction,
} from '../src/modules/hypotheses/services/crossModeStateTransitionEngine.js';

function createTransitionFixture() {
  const identities = new Map([
    ['lineage-root', {
      identityId: 'lineage-root',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-root', nodeKey: buildNodeKey('comments', 'comment-root') },
        { mode: 'video', hypothesisId: 'video-root', nodeKey: buildNodeKey('video', 'video-root') },
        { mode: 'interviews', hypothesisId: 'interview-root', nodeKey: buildNodeKey('interviews', 'interview-root') },
      ],
    }],
    ['lineage-mid', {
      identityId: 'lineage-mid',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-mid', nodeKey: buildNodeKey('comments', 'comment-mid') },
        { mode: 'video', hypothesisId: 'video-mid', nodeKey: buildNodeKey('video', 'video-mid') },
        { mode: 'interviews', hypothesisId: 'interview-mid', nodeKey: buildNodeKey('interviews', 'interview-mid') },
      ],
    }],
    ['lineage-leaf', {
      identityId: 'lineage-leaf',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-leaf', nodeKey: buildNodeKey('comments', 'comment-leaf') },
        { mode: 'video', hypothesisId: 'video-leaf', nodeKey: buildNodeKey('video', 'video-leaf') },
        { mode: 'interviews', hypothesisId: 'interview-leaf', nodeKey: buildNodeKey('interviews', 'interview-leaf') },
      ],
    }],
    ['lineage-sibling', {
      identityId: 'lineage-sibling',
      nodes: [
        { mode: 'comments', hypothesisId: 'comment-sibling', nodeKey: buildNodeKey('comments', 'comment-sibling') },
        { mode: 'video', hypothesisId: 'video-sibling', nodeKey: buildNodeKey('video', 'video-sibling') },
      ],
    }],
  ]);

  const nodeToIdentity = new Map();
  identities.forEach((identity, identityId) => {
    identity.nodes.forEach((node) => nodeToIdentity.set(node.nodeKey, identityId));
  });

  const childrenByNodeKey = new Map([
    [buildNodeKey('comments', 'comment-root'), [{ mode: 'comments', hypothesisId: 'comment-mid', nodeKey: buildNodeKey('comments', 'comment-mid') }, { mode: 'comments', hypothesisId: 'comment-sibling', nodeKey: buildNodeKey('comments', 'comment-sibling') }]],
    [buildNodeKey('video', 'video-root'), [{ mode: 'video', hypothesisId: 'video-mid', nodeKey: buildNodeKey('video', 'video-mid') }, { mode: 'video', hypothesisId: 'video-sibling', nodeKey: buildNodeKey('video', 'video-sibling') }]],
    [buildNodeKey('interviews', 'interview-root'), [{ mode: 'interviews', hypothesisId: 'interview-mid', nodeKey: buildNodeKey('interviews', 'interview-mid') }]],
    [buildNodeKey('comments', 'comment-mid'), [{ mode: 'comments', hypothesisId: 'comment-leaf', nodeKey: buildNodeKey('comments', 'comment-leaf') }]],
    [buildNodeKey('video', 'video-mid'), [{ mode: 'video', hypothesisId: 'video-leaf', nodeKey: buildNodeKey('video', 'video-leaf') }]],
    [buildNodeKey('interviews', 'interview-mid'), [{ mode: 'interviews', hypothesisId: 'interview-leaf', nodeKey: buildNodeKey('interviews', 'interview-leaf') }]],
  ]);

  return createResolverContext({ identities, nodeToIdentity, childrenByNodeKey });
}

test('validate root affects only direct equivalents and uses canonical validated state', () => {
  const context = createTransitionFixture();
  const plan = buildStateTransitionPlan(context, { mode: 'video', hypothesisId: 'video-root', action: STATE_TRANSITION_ACTIONS.VALIDATE });

  assert.equal(plan.targetState, 'validada');
  assert.deepEqual(new Set(plan.affectedNodeKeys), new Set(['video:video-root', 'comments:comment-root', 'interviews:interview-root']));
});

test('invalidate root affects direct equivalents and the whole descendant branch in all modes', () => {
  const context = createTransitionFixture();
  const plan = buildStateTransitionPlan(context, { mode: 'video', hypothesisId: 'video-root', action: STATE_TRANSITION_ACTIONS.INVALIDATE });

  assert.equal(plan.targetState, 'invalidada');
  assert.deepEqual(new Set(plan.affectedNodeKeys), new Set([
    'video:video-root',
    'comments:comment-root',
    'interviews:interview-root',
    'video:video-mid',
    'comments:comment-mid',
    'interviews:interview-mid',
    'video:video-leaf',
    'comments:comment-leaf',
    'interviews:interview-leaf',
    'video:video-sibling',
    'comments:comment-sibling',
  ]));
});

test('validate intermediate node does not affect descendants, ancestors or siblings', () => {
  const context = createTransitionFixture();
  const plan = buildStateTransitionPlan(context, { mode: 'video', hypothesisId: 'video-mid', action: STATE_TRANSITION_ACTIONS.VALIDATE });

  assert.deepEqual(new Set(plan.affectedNodeKeys), new Set(['video:video-mid', 'comments:comment-mid', 'interviews:interview-mid']));
});

test('invalidate intermediate node affects only its branch and not ancestors or sibling branches', () => {
  const context = createTransitionFixture();
  const plan = buildStateTransitionPlan(context, { mode: 'video', hypothesisId: 'video-mid', action: STATE_TRANSITION_ACTIONS.INVALIDATE });

  assert.deepEqual(new Set(plan.affectedNodeKeys), new Set([
    'video:video-mid',
    'comments:comment-mid',
    'interviews:interview-mid',
    'video:video-leaf',
    'comments:comment-leaf',
    'interviews:interview-leaf',
  ]));
  assert.equal(plan.affectedNodeKeys.includes('video:video-root'), false);
  assert.equal(plan.affectedNodeKeys.includes('video:video-sibling'), false);
});

test('canonical state resolution uses only the canonical grammar', () => {
  assert.equal(resolveCanonicalStateForAction(STATE_TRANSITION_ACTIONS.VALIDATE), 'validada');
  assert.equal(resolveCanonicalStateForAction(STATE_TRANSITION_ACTIONS.INVALIDATE), 'invalidada');
  assert.equal(resolveCanonicalStateForAction('unknown'), 'inconclusa');
});
