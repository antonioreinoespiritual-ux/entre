import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HYPOTHESIS_MODES, HYPOTHESIS_STATE, buildModeStatePatch, normalizeHypothesisState, readHypothesisStateForMode } from '../shared/hypothesisState.js';

function loadGraphUtils() {
  const source = fs.readFileSync(new URL('../src/modules/hypotheses/services/crossModeValidationSync.js', import.meta.url), 'utf8');
  const start = source.indexOf("const VALIDATION_STATE_VALID =");
  const end = source.indexOf("const rebuildCommentsStatusFromVideo = async");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not locate graph utility block in crossModeValidationSync.js');
  }

  const utilityBlock = source.slice(start, end);
  const factory = new Function('HYPOTHESIS_MODES', 'HYPOTHESIS_STATE', 'buildModeStatePatch', 'normalizeHypothesisState', 'readHypothesisStateForMode', `${utilityBlock}\nreturn { buildNodeKey, createUnifiedGraph, addEquivalentEdge, addChildEdge, getEquivalentClosureAcrossModes, getDescendantsAcrossUnifiedGraph, groupAffectedIdsByMode, normalizeValidationState, toCommentsValidationState, toVideoValidationState, toInterviewValidationState, getValidationStateFromNode, shouldSyncVideoStateTransition, buildCommentsStateRebuildPlanFromVideoGraph };`);
  return factory(HYPOTHESIS_MODES, HYPOTHESIS_STATE, buildModeStatePatch, normalizeHypothesisState, readHypothesisStateForMode);
}

const {
  buildNodeKey,
  createUnifiedGraph,
  addEquivalentEdge,
  addChildEdge,
  getEquivalentClosureAcrossModes,
  getDescendantsAcrossUnifiedGraph,
  groupAffectedIdsByMode,
  normalizeValidationState,
  toCommentsValidationState,
  toVideoValidationState,
  toInterviewValidationState,
  getValidationStateFromNode,
  shouldSyncVideoStateTransition,
  buildCommentsStateRebuildPlanFromVideoGraph,
} = loadGraphUtils();

function createGraphFixture() {
  const graph = createUnifiedGraph();

  const commentRoot = buildNodeKey('comments', 'comment-root');
  const videoRoot = buildNodeKey('video', 'video-root');
  const interviewRoot = buildNodeKey('interviews', 'interview-root');
  const commentChild = buildNodeKey('comments', 'comment-child');
  const videoChild = buildNodeKey('video', 'video-child');
  const interviewChild = buildNodeKey('interviews', 'interview-child');

  [commentRoot, videoRoot, interviewRoot, commentChild, videoChild, interviewChild].forEach((key) => {
    graph.nodes.set(key, { key });
  });

  addEquivalentEdge(graph, commentRoot, videoRoot);
  addEquivalentEdge(graph, commentRoot, interviewRoot);
  addEquivalentEdge(graph, commentChild, videoChild);
  addEquivalentEdge(graph, commentChild, interviewChild);

  addChildEdge(graph, commentRoot, commentChild);
  addChildEdge(graph, videoRoot, videoChild);
  addChildEdge(graph, interviewRoot, interviewChild);

  return { graph, commentRoot, videoRoot, interviewRoot, commentChild, videoChild, interviewChild };
}

test('equivalent closure reaches all transitively linked cross-mode nodes for validation root set', () => {
  const { graph, commentRoot, videoRoot, interviewRoot, commentChild, videoChild, interviewChild } = createGraphFixture();

  const rootClosure = getEquivalentClosureAcrossModes(graph, 'video-root', 'video');
  assert.deepEqual(rootClosure, new Set([videoRoot, commentRoot, interviewRoot]));
  assert.equal(rootClosure.has(commentChild), false);
  assert.equal(rootClosure.has(videoChild), false);
  assert.equal(rootClosure.has(interviewChild), false);
});

test('invalidating a video root covers the full descendant branch across all modes', () => {
  const { graph, commentRoot, videoRoot, interviewRoot, commentChild, videoChild, interviewChild } = createGraphFixture();

  const rootClosure = getEquivalentClosureAcrossModes(graph, 'video-root', 'video');
  const affected = getDescendantsAcrossUnifiedGraph(graph, [...rootClosure]);

  assert.deepEqual(affected, new Set([
    videoRoot,
    commentRoot,
    interviewRoot,
    videoChild,
    commentChild,
    interviewChild,
  ]));
});

test('invalidating an intermediate video node does not affect ancestors', () => {
  const graph = createUnifiedGraph();
  const commentRoot = buildNodeKey('comments', 'comment-root');
  const videoRoot = buildNodeKey('video', 'video-root');
  const interviewRoot = buildNodeKey('interviews', 'interview-root');
  const commentMid = buildNodeKey('comments', 'comment-mid');
  const videoMid = buildNodeKey('video', 'video-mid');
  const interviewMid = buildNodeKey('interviews', 'interview-mid');
  const commentLeaf = buildNodeKey('comments', 'comment-leaf');
  const videoLeaf = buildNodeKey('video', 'video-leaf');
  const interviewLeaf = buildNodeKey('interviews', 'interview-leaf');

  [commentRoot, videoRoot, interviewRoot, commentMid, videoMid, interviewMid, commentLeaf, videoLeaf, interviewLeaf].forEach((key) => {
    graph.nodes.set(key, { key });
  });

  addEquivalentEdge(graph, commentRoot, videoRoot);
  addEquivalentEdge(graph, commentRoot, interviewRoot);
  addEquivalentEdge(graph, commentMid, videoMid);
  addEquivalentEdge(graph, commentMid, interviewMid);
  addEquivalentEdge(graph, commentLeaf, videoLeaf);
  addEquivalentEdge(graph, commentLeaf, interviewLeaf);

  addChildEdge(graph, commentRoot, commentMid);
  addChildEdge(graph, videoRoot, videoMid);
  addChildEdge(graph, interviewRoot, interviewMid);
  addChildEdge(graph, commentMid, commentLeaf);
  addChildEdge(graph, videoMid, videoLeaf);
  addChildEdge(graph, interviewMid, interviewLeaf);

  const midClosure = getEquivalentClosureAcrossModes(graph, 'video-mid', 'video');
  const affected = getDescendantsAcrossUnifiedGraph(graph, [...midClosure]);
  const grouped = groupAffectedIdsByMode([...affected]);

  assert.deepEqual(midClosure, new Set([videoMid, commentMid, interviewMid]));
  assert.equal(affected.has(videoRoot), false);
  assert.equal(affected.has(commentRoot), false);
  assert.equal(affected.has(interviewRoot), false);
  assert.deepEqual(grouped.video, new Set(['video-mid', 'video-leaf']));
  assert.deepEqual(grouped.comments, new Set(['comment-mid', 'comment-leaf']));
  assert.deepEqual(grouped.interviews, new Set(['interview-mid', 'interview-leaf']));
});


test('validating an intermediate video node syncs only its cross-mode equivalents, not its descendants', () => {
  const graph = createUnifiedGraph();
  const commentRoot = buildNodeKey('comments', 'comment-root');
  const videoRoot = buildNodeKey('video', 'video-root');
  const interviewRoot = buildNodeKey('interviews', 'interview-root');
  const commentMid = buildNodeKey('comments', 'comment-mid');
  const videoMid = buildNodeKey('video', 'video-mid');
  const interviewMid = buildNodeKey('interviews', 'interview-mid');
  const commentLeaf = buildNodeKey('comments', 'comment-leaf');
  const videoLeaf = buildNodeKey('video', 'video-leaf');
  const interviewLeaf = buildNodeKey('interviews', 'interview-leaf');

  [commentRoot, videoRoot, interviewRoot, commentMid, videoMid, interviewMid, commentLeaf, videoLeaf, interviewLeaf].forEach((key) => {
    graph.nodes.set(key, { key });
  });

  addEquivalentEdge(graph, commentRoot, videoRoot);
  addEquivalentEdge(graph, commentRoot, interviewRoot);
  addEquivalentEdge(graph, commentMid, videoMid);
  addEquivalentEdge(graph, commentMid, interviewMid);
  addEquivalentEdge(graph, commentLeaf, videoLeaf);
  addEquivalentEdge(graph, commentLeaf, interviewLeaf);

  addChildEdge(graph, commentRoot, commentMid);
  addChildEdge(graph, videoRoot, videoMid);
  addChildEdge(graph, interviewRoot, interviewMid);
  addChildEdge(graph, commentMid, commentLeaf);
  addChildEdge(graph, videoMid, videoLeaf);
  addChildEdge(graph, interviewMid, interviewLeaf);

  // VALIDATION uses only the equivalent closure (rootSet), not descendants
  const midClosure = getEquivalentClosureAcrossModes(graph, 'video-mid', 'video');
  const grouped = groupAffectedIdsByMode([...midClosure]);

  assert.deepEqual(midClosure, new Set([videoMid, commentMid, interviewMid]));
  assert.equal(midClosure.has(videoRoot), false, 'ancestors must not be included');
  assert.equal(midClosure.has(commentRoot), false, 'ancestors must not be included');
  assert.equal(midClosure.has(interviewRoot), false, 'ancestors must not be included');
  assert.equal(midClosure.has(videoLeaf), false, 'descendants must not be included for validation');
  assert.equal(midClosure.has(commentLeaf), false, 'descendants must not be included for validation');
  assert.equal(midClosure.has(interviewLeaf), false, 'descendants must not be included for validation');
  assert.deepEqual(grouped.video, new Set(['video-mid']));
  assert.deepEqual(grouped.comments, new Set(['comment-mid']));
  assert.deepEqual(grouped.interviews, new Set(['interview-mid']));
});

test('canonical validation-state helpers normalize and adapt states per mode', () => {
  assert.equal(normalizeValidationState('Validada'), 'validada');
  assert.equal(normalizeValidationState('No validada'), 'invalidada');
  assert.equal(normalizeValidationState('no evaluada'), 'inconclusa');
  assert.equal(toCommentsValidationState('Inconclusa'), 'inconclusa');
  assert.equal(toVideoValidationState('invalidada'), 'invalidada');
  assert.equal(toInterviewValidationState('inconclusa'), 'inconclusa');
  assert.equal(getValidationStateFromNode('comments', { hypothesis: { validation_status: 'validada' } }), 'validada');
  assert.equal(getValidationStateFromNode('video', { row: { validation_status: 'No validada' } }), 'invalidada');
  assert.equal(getValidationStateFromNode('interviews', { row: { validation_result: 'no evaluada' } }), 'inconclusa');
});


test('video sync only runs when the canonical state actually changes to a syncable value', () => {
  assert.equal(shouldSyncVideoStateTransition({ previousState: 'validada', nextState: 'Validada' }), false);
  assert.equal(shouldSyncVideoStateTransition({ previousState: 'inconclusa', nextState: 'invalidada' }), true);
  assert.equal(shouldSyncVideoStateTransition({ previousState: 'No validada', nextState: 'inconclusa' }), false);
});


test('comments states are rebuilt from video states and old comment validation metadata is ignored', () => {
  const { graph, commentRoot, videoRoot, interviewRoot, commentChild, videoChild, interviewChild } = createGraphFixture();
  graph.nodes.set(videoRoot, { mode: 'video', id: 'video-root', validationState: 'validada' });
  graph.nodes.set(videoChild, { mode: 'video', id: 'video-child', validationState: 'No validada' });
  graph.nodes.set(commentRoot, { mode: 'comments', id: 'comment-root', hypothesis: { validation_status: 'refutada' } });
  graph.nodes.set(commentChild, { mode: 'comments', id: 'comment-child', hypothesis: { validation_status: 'validada' } });
  graph.nodes.set(interviewRoot, { mode: 'interviews', id: 'interview-root', row: { validation_result: 'inconclusa' } });
  graph.nodes.set(interviewChild, { mode: 'interviews', id: 'interview-child', row: { validation_result: 'inconclusa' } });
  graph.commentsStores.set('comments-mode:test', {
    store: { hypotheses: [] },
    hypotheses: new Map([
      ['comment-root', { id: 'comment-root', validation_status: 'invalidada' }],
      ['comment-child', { id: 'comment-child', validation_status: 'validada' }],
    ]),
  });

  const rebuilt = buildCommentsStateRebuildPlanFromVideoGraph(graph);
  assert.equal(rebuilt.get('comment-root'), 'validada');
  assert.equal(rebuilt.get('comment-child'), 'invalidada');
});
