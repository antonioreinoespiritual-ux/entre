import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentsHypothesisAdapter } from '../src/modules/hypotheses/services/adapters/commentsHypothesisAdapter.js';
import { createVideoHypothesisAdapter } from '../src/modules/hypotheses/services/adapters/videoHypothesisAdapter.js';
import { createInterviewsHypothesisAdapter } from '../src/modules/hypotheses/services/adapters/interviewsHypothesisAdapter.js';

test('comments adapter reads and writes canonical state without leaking store details to callers', async () => {
  const persisted = [];
  const adapter = createCommentsHypothesisAdapter({
    listStores: async () => [{
      storageKey: 'comments-mode:p:c',
      store: { hypotheses: [{ id: 'comment-1', validation_status: 'No validada' }] },
    }],
    persistStore: async (storageKey, store) => persisted.push({ storageKey, store }),
  });

  const nodes = await adapter.listNodes({ projectId: 'p', campaignId: 'c' });
  assert.equal(nodes[0]?.validationState, 'invalidada');

  const graph = {
    nodes: new Map([['comments:comment-1', { storageKey: 'comments-mode:p:c' }]]),
    modeStores: new Map([['comments:comments-mode:p:c', { store: { hypotheses: [{ id: 'comment-1', validation_status: 'inconclusa' }] } }]]),
  };
  const updatedIds = await adapter.updateCanonicalState({ graph, hypothesisIds: ['comment-1'], nextState: 'validada' });

  assert.deepEqual(updatedIds, ['comment-1']);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].store.hypotheses[0].validation_status, 'validada');
});

test('video and interviews adapters translate canonical state to mode-specific persistence fields', async () => {
  const updates = [];
  const mockClient = {
    from(table) {
      return {
        select() {
          return {
            eq: async () => ({ data: table === 'hypotheses'
              ? [{ id: 'video-1', validation_status: 'Validada', contexto_cualitativo: '' }]
              : [{ id: 'interview-1', validation_result: 'No validada', observations: '' }], error: null }),
          };
        },
        update(payload) {
          return {
            eq: async (idField, idValue) => {
              updates.push({ table, payload, idField, idValue });
              return { error: null };
            },
          };
        },
      };
    },
  };

  const videoAdapter = createVideoHypothesisAdapter({ client: mockClient });
  const interviewsAdapter = createInterviewsHypothesisAdapter({ client: mockClient });

  const videoNodes = await videoAdapter.listNodes({ campaignId: 'campaign-1' });
  const interviewNodes = await interviewsAdapter.listNodes({ campaignId: 'campaign-1' });
  assert.equal(videoNodes[0]?.validationState, 'validada');
  assert.equal(interviewNodes[0]?.validationState, 'invalidada');

  await videoAdapter.updateCanonicalState({ hypothesisIds: ['video-1'], nextState: 'invalidada' });
  await interviewsAdapter.updateCanonicalState({ hypothesisIds: ['interview-1'], nextState: 'validada' });

  assert.equal(updates[0]?.table, 'hypotheses');
  assert.equal(updates[0]?.payload?.validation_status, 'invalidada');
  assert.equal(updates[1]?.table, 'interview_hypotheses');
  assert.equal(updates[1]?.payload?.validation_result, 'validada');
});
