import { supabase } from '../../../../lib/customSupabaseClient.js';
import { MODE_INTERVIEWS, normalizeId } from '../crossModeGraphCore.js';
import { buildModeStatePatch, readHypothesisStateForMode } from '../../../../../shared/hypothesisState.js';

export const createInterviewsHypothesisAdapter = ({ client = supabase } = {}) => ({
  mode: MODE_INTERVIEWS,

  async listNodes({ campaignId = '' } = {}) {
    const { data, error } = await client
      .from('interview_hypotheses')
      .select('id, campaign_id, observations, validation_result')
      .eq('campaign_id', campaignId);
    if (error) throw error;
    return (data || []).map((row) => ({
      id: normalizeId(row?.id),
      mode: MODE_INTERVIEWS,
      record: row,
      validationState: readHypothesisStateForMode(MODE_INTERVIEWS, row),
    })).filter((node) => node.id);
  },

  async updateCanonicalState({ hypothesisIds = [], nextState = '' } = {}) {
    const targetIds = [...new Set((hypothesisIds || []).map(normalizeId).filter(Boolean))];
    if (!targetIds.length) return [];
    const timestamp = new Date().toISOString();
    await Promise.all(targetIds.map(async (id) => {
      const { error } = await client
        .from('interview_hypotheses')
        .update(buildModeStatePatch(MODE_INTERVIEWS, nextState, { updated_at: timestamp }))
        .eq('id', id);
      if (error) throw error;
    }));
    return targetIds;
  },
});

export const interviewsHypothesisAdapter = createInterviewsHypothesisAdapter();
