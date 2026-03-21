import { supabase } from '@/lib/customSupabaseClient';
import { listEvolutionLinksByDestination, persistEvolutionStoreByKey } from '@/modules/comments/services/hypothesisEvolutionService';

const COMMENT_VALID = 'validada';
const COMMENT_INVALID = 'invalidada';
const VIDEO_VALID = 'Validada';
const VIDEO_INVALID = 'No validada';
const INTERVIEW_VALID = 'validada';
const INTERVIEW_INVALID = 'invalidada';

const extractVideoParentHypothesisId = (hypothesis = {}) => {
  const match = String(hypothesis?.contexto_cualitativo || '').match(/\[hierarchy_meta\]([\s\S]*?)\[\/hierarchy_meta\]/);
  if (!match) return '';
  try {
    return String(JSON.parse(match[1])?.parent_hypothesis_id || '').trim();
  } catch {
    return '';
  }
};

const extractInterviewParentHypothesisId = (hypothesis = {}) => {
  const match = String(hypothesis?.observations || '').match(/\[interview_hierarchy\]([\s\S]*?)\[\/interview_hierarchy\]/);
  if (!match) return '';
  try {
    return String(JSON.parse(match[1])?.parent_hypothesis_id || '').trim();
  } catch {
    return '';
  }
};

const collectDescendantIds = ({ rows = [], rootIds = [], getId, getParentId }) => {
  const pending = [...new Set((rootIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const collected = new Set();
  const childrenByParent = (rows || []).reduce((acc, row) => {
    const parentId = String(getParentId(row) || '').trim();
    if (!parentId) return acc;
    const current = acc.get(parentId) || [];
    current.push(row);
    acc.set(parentId, current);
    return acc;
  }, new Map());

  while (pending.length) {
    const currentId = pending.shift();
    if (!currentId || collected.has(currentId)) continue;
    collected.add(currentId);
    const children = childrenByParent.get(currentId) || [];
    children.forEach((child) => pending.push(String(getId(child) || '').trim()));
  }

  return collected;
};

const updateCommentsStatus = async ({ storageKey, store, rootCommentIds = [], mode }) => {
  const hypotheses = Array.isArray(store?.hypotheses) ? store.hypotheses : [];
  if (!storageKey || !hypotheses.length || !rootCommentIds.length) return [];
  const affectedIds = mode === 'invalid'
    ? collectDescendantIds({ rows: hypotheses, rootIds: rootCommentIds, getId: (item) => item?.id, getParentId: (item) => item?.parent_hypothesis_id })
    : new Set(rootCommentIds.map((value) => String(value || '').trim()).filter(Boolean));

  if (!affectedIds.size) return [];
  const timestamp = new Date().toISOString();
  const nextHypotheses = hypotheses.map((item) => {
    const itemId = String(item?.id || '').trim();
    if (!affectedIds.has(itemId)) return item;
    const rootId = rootCommentIds.find((candidate) => affectedIds.has(itemId) && (mode === 'valid' ? candidate === itemId : collectDescendantIds({ rows: hypotheses, rootIds: [candidate], getId: (row) => row?.id, getParentId: (row) => row?.parent_hypothesis_id }).has(itemId))) || itemId;
    if (mode === 'valid') {
      return {
        ...item,
        validation_status: COMMENT_VALID,
        updated_at: timestamp,
        invalidated_at: undefined,
        invalidated_from_hypothesis_id: undefined,
      };
    }
    return {
      ...item,
      validation_status: COMMENT_INVALID,
      updated_at: timestamp,
      invalidated_at: timestamp,
      invalidated_from_hypothesis_id: rootId,
    };
  }).map((item) => {
    if (item.invalidated_at === undefined) delete item.invalidated_at;
    if (item.invalidated_from_hypothesis_id === undefined) delete item.invalidated_from_hypothesis_id;
    return item;
  });

  await persistEvolutionStoreByKey(storageKey, { ...store, hypotheses: nextHypotheses });
  return [...affectedIds];
};

const updateVideoStatuses = async ({ campaignId, rootIds = [], mode }) => {
  if (!campaignId || !rootIds.length) return [];
  const { data: rows, error } = await supabase.from('hypotheses').select('id, campaign_id, contexto_cualitativo').eq('campaign_id', campaignId);
  if (error) throw error;
  const affectedIds = mode === 'invalid'
    ? collectDescendantIds({ rows, rootIds, getId: (item) => item?.id, getParentId: extractVideoParentHypothesisId })
    : new Set(rootIds.map((value) => String(value || '').trim()).filter(Boolean));
  const timestamp = new Date().toISOString();
  await Promise.all([...affectedIds].map(async (id) => {
    const { error: updateError } = await supabase.from('hypotheses').update({ validation_status: mode === 'valid' ? VIDEO_VALID : VIDEO_INVALID, updated_at: timestamp }).eq('id', id);
    if (updateError) throw updateError;
  }));
  return [...affectedIds];
};

const updateInterviewStatuses = async ({ campaignId, rootIds = [], mode }) => {
  if (!campaignId || !rootIds.length) return [];
  const { data: rows, error } = await supabase.from('interview_hypotheses').select('id, campaign_id, observations').eq('campaign_id', campaignId);
  if (error) throw error;
  const affectedIds = mode === 'invalid'
    ? collectDescendantIds({ rows, rootIds, getId: (item) => item?.id, getParentId: extractInterviewParentHypothesisId })
    : new Set(rootIds.map((value) => String(value || '').trim()).filter(Boolean));
  const timestamp = new Date().toISOString();
  await Promise.all([...affectedIds].map(async (id) => {
    const { error: updateError } = await supabase.from('interview_hypotheses').update({ validation_result: mode === 'valid' ? INTERVIEW_VALID : INTERVIEW_INVALID, updated_at: timestamp }).eq('id', id);
    if (updateError) throw updateError;
  }));
  return [...affectedIds];
};

export const syncVideoHypothesisValidationAcrossModes = async ({ projectId = '', campaignId = '', videoHypothesisId = '', nextVideoStatus = '' } = {}) => {
  const normalizedVideoId = String(videoHypothesisId || '').trim();
  const normalizedStatus = String(nextVideoStatus || '').trim().toLowerCase();
  if (!projectId || !campaignId || !normalizedVideoId) return { synced: false };

  const mode = normalizedStatus === 'validada' ? 'valid' : normalizedStatus === 'no validada' ? 'invalid' : '';
  if (!mode) return { synced: false };

  const destinationMatches = await listEvolutionLinksByDestination({
    projectId,
    campaignId,
    destinationMode: 'video',
    destinationHypothesisId: normalizedVideoId,
  });
  if (!destinationMatches.length) return { synced: false };

  const processedStorageKeys = new Set();
  const interviewRootIds = new Set();
  const videoRootIds = new Set([normalizedVideoId]);

  for (const match of destinationMatches) {
    const storageKey = String(match?.storageKey || '').trim();
    if (!storageKey || processedStorageKeys.has(storageKey)) continue;
    processedStorageKeys.add(storageKey);
    const store = match?.store || {};
    const links = Array.isArray(store?.hypothesisEvolutionLinks) ? store.hypothesisEvolutionLinks.filter((link) => !link?.deleted_at) : [];
    const commentRootIds = destinationMatches
      .filter((entry) => String(entry?.storageKey || '').trim() === storageKey)
      .map((entry) => String(entry?.link?.source_hypothesis_id || '').trim())
      .filter(Boolean);

    const affectedCommentIds = await updateCommentsStatus({ storageKey, store, rootCommentIds: commentRootIds, mode });
    const sourceIdsForDestinations = new Set(mode === 'invalid' ? affectedCommentIds : commentRootIds);
    links.forEach((link) => {
      const sourceId = String(link?.source_hypothesis_id || '').trim();
      if (!sourceIdsForDestinations.has(sourceId)) return;
      const destinationMode = String(link?.destination_mode || '').trim();
      const destinationId = String(link?.destination_hypothesis_id || '').trim();
      if (!destinationId) return;
      if (destinationMode === 'video') videoRootIds.add(destinationId);
      if (destinationMode === 'interviews') interviewRootIds.add(destinationId);
    });
  }

  const updatedVideoIds = await updateVideoStatuses({ campaignId, rootIds: [...videoRootIds], mode });
  const updatedInterviewIds = await updateInterviewStatuses({ campaignId, rootIds: [...interviewRootIds], mode });

  return {
    synced: true,
    mode,
    updatedVideoIds,
    updatedInterviewIds,
  };
};
