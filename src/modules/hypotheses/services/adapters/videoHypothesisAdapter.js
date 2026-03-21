import { supabase } from '../../../../lib/customSupabaseClient.js';
import { MODE_VIDEO, normalizeId } from '../crossModeGraphCore.js';
import { buildModeStatePatch, readHypothesisStateForMode } from '../../../../../shared/hypothesisState.js';

export const createVideoHypothesisAdapter = ({ client = supabase } = {}) => ({
  mode: MODE_VIDEO,

  async listNodes({ campaignId = '' } = {}) {
    const { data, error } = await client
      .from('hypotheses')
      .select('id, campaign_id, contexto_cualitativo, validation_status')
      .eq('campaign_id', campaignId);
    if (error) throw error;
    return (data || []).map((row) => ({
      id: normalizeId(row?.id),
      mode: MODE_VIDEO,
      record: row,
      validationState: readHypothesisStateForMode(MODE_VIDEO, row),
    })).filter((node) => node.id);
  },

  async updateCanonicalState({ hypothesisIds = [], nextState = '' } = {}) {
    const targetIds = [...new Set((hypothesisIds || []).map(normalizeId).filter(Boolean))];
    if (!targetIds.length) return [];
    const timestamp = new Date().toISOString();
    await Promise.all(targetIds.map(async (id) => {
      const { error } = await client
        .from('hypotheses')
        .update(buildModeStatePatch(MODE_VIDEO, nextState, { updated_at: timestamp }))
        .eq('id', id);
      if (error) throw error;
    }));
    return targetIds;
  },
});

export const videoHypothesisAdapter = createVideoHypothesisAdapter();
