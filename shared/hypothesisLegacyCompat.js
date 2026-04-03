import { HYPOTHESIS_MODES, HYPOTHESIS_STATE, normalizeHypothesisState } from './hypothesisState.js';

const toArray = (value) => (Array.isArray(value) ? value : []);
const toRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const normalizeText = (value = '') => String(value || '').trim();
const normalizeLowerText = (value = '') => normalizeText(value).toLowerCase();

const LEGACY_MODE_ALIASES = new Map([
  ['comments', HYPOTHESIS_MODES.COMMENTS],
  ['comment', HYPOTHESIS_MODES.COMMENTS],
  ['comment_mode', HYPOTHESIS_MODES.COMMENTS],
  ['video', HYPOTHESIS_MODES.VIDEO],
  ['videos', HYPOTHESIS_MODES.VIDEO],
  ['hypotheses', HYPOTHESIS_MODES.VIDEO],
  ['interviews', HYPOTHESIS_MODES.INTERVIEWS],
  ['interview', HYPOTHESIS_MODES.INTERVIEWS],
  ['interview_hypotheses', HYPOTHESIS_MODES.INTERVIEWS],
]);

const LEGACY_METADATA_TAGS = Object.freeze({
  [HYPOTHESIS_MODES.VIDEO]: ['hierarchy_meta', 'hypothesis_hierarchy', 'legacy_hierarchy_meta'],
  [HYPOTHESIS_MODES.INTERVIEWS]: ['interview_hierarchy', 'hypothesis_hierarchy', 'legacy_hierarchy_meta'],
});

function parseJsonCandidate(value = '') {
  const source = normalizeText(value);
  if (!source) return {};
  try {
    const parsed = JSON.parse(source);
    return toRecord(parsed);
  } catch {
    return {};
  }
}

export function normalizeLegacyMode(mode = '') {
  return LEGACY_MODE_ALIASES.get(normalizeLowerText(mode)) || normalizeText(mode);
}

export function normalizeLegacyHypothesisId(value = '') {
  return normalizeText(value);
}

export function extractTaggedJsonMetadata(value = '', tags = []) {
  const source = String(value || '');
  for (const tag of toArray(tags).map((item) => normalizeText(item)).filter(Boolean)) {
    const match = source.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i'));
    if (!match) continue;
    const parsed = parseJsonCandidate(match[1]);
    if (Object.keys(parsed).length) return parsed;
  }
  return {};
}

export function readLegacyParentHypothesisId(mode = '', record = {}) {
  const safeRecord = toRecord(record);
  const directParent = normalizeLegacyHypothesisId(
    safeRecord.parent_hypothesis_id
    ?? safeRecord.parentHypothesisId
    ?? safeRecord.parent_id
    ?? safeRecord.parentId
    ?? safeRecord.metadata?.parent_hypothesis_id
    ?? safeRecord.metadata?.parentHypothesisId,
  );
  if (directParent) return directParent;

  const normalizedMode = normalizeLegacyMode(mode);
  if (normalizedMode === HYPOTHESIS_MODES.COMMENTS) return '';

  const blobField = normalizedMode === HYPOTHESIS_MODES.INTERVIEWS
    ? safeRecord.observations ?? safeRecord.description ?? ''
    : safeRecord.contexto_cualitativo ?? safeRecord.context ?? safeRecord.description ?? '';

  const taggedMetadata = extractTaggedJsonMetadata(blobField, LEGACY_METADATA_TAGS[normalizedMode] || []);
  const taggedParent = normalizeLegacyHypothesisId(
    taggedMetadata.parent_hypothesis_id
    ?? taggedMetadata.parentHypothesisId
    ?? taggedMetadata.parent_id
    ?? taggedMetadata.parentId,
  );
  if (taggedParent) return taggedParent;

  const parsedBlob = parseJsonCandidate(blobField);
  return normalizeLegacyHypothesisId(
    parsedBlob.parent_hypothesis_id
    ?? parsedBlob.parentHypothesisId
    ?? parsedBlob.parent_id
    ?? parsedBlob.parentId
    ?? parsedBlob.hierarchy?.parent_hypothesis_id
    ?? parsedBlob.hierarchy?.parentHypothesisId,
  );
}

export function normalizeLegacyEvolutionLink(link = {}, fallback = {}) {
  const safeLink = { ...toRecord(link) };
  const sourceHypothesisId = normalizeLegacyHypothesisId(
    safeLink.source_hypothesis_id
    ?? safeLink.sourceHypothesisId
    ?? safeLink.origin_hypothesis_id
    ?? safeLink.originHypothesisId
    ?? safeLink.hypothesis_id
    ?? safeLink.hypothesisId
    ?? fallback.source_hypothesis_id,
  );
  const destinationMode = normalizeLegacyMode(
    safeLink.destination_mode
    ?? safeLink.destinationMode
    ?? safeLink.target_mode
    ?? safeLink.targetMode
    ?? safeLink.mode
    ?? fallback.destination_mode,
  );
  const destinationHypothesisId = normalizeLegacyHypothesisId(
    safeLink.destination_hypothesis_id
    ?? safeLink.destinationHypothesisId
    ?? safeLink.target_hypothesis_id
    ?? safeLink.targetHypothesisId
    ?? safeLink.target_id
    ?? safeLink.targetId
    ?? safeLink.evolved_hypothesis_id
    ?? safeLink.evolvedHypothesisId
    ?? fallback.destination_hypothesis_id,
  );
  if (!sourceHypothesisId || !destinationMode || !destinationHypothesisId) return null;

  const deletedAt = normalizeText(
    safeLink.deleted_at
    ?? safeLink.deletedAt
    ?? ((safeLink.is_deleted || safeLink.deleted) ? new Date(0).toISOString() : ''),
  ) || undefined;

  return {
    ...safeLink,
    id: normalizeText(safeLink.id || safeLink.link_id || safeLink.linkId || `${sourceHypothesisId}:${destinationMode}:${destinationHypothesisId}`),
    source_hypothesis_id: sourceHypothesisId,
    destination_mode: destinationMode,
    destination_hypothesis_id: destinationHypothesisId,
    storage_key: normalizeText(safeLink.storage_key ?? safeLink.storageKey ?? fallback.storage_key) || undefined,
    deleted_at: deletedAt,
  };
}

export function collectLegacyEvolutionLinks(store = {}, { storageKey = '' } = {}) {
  const safeStore = toRecord(store);
  const fallback = { storage_key: storageKey };
  const rawLinks = [
    ...toArray(safeStore.hypothesisEvolutionLinks),
    ...toArray(safeStore.evolutionLinks),
    ...toArray(safeStore.evolution_links),
    ...toArray(safeStore.legacyEvolutionLinks),
  ];
  return rawLinks.map((link) => normalizeLegacyEvolutionLink(link, fallback)).filter(Boolean);
}

export function normalizeLegacyCommentHypothesis(hypothesis = {}) {
  const safeHypothesis = { ...toRecord(hypothesis) };
  const id = normalizeLegacyHypothesisId(safeHypothesis.id || safeHypothesis.hypothesis_id || safeHypothesis.hypothesisId);
  if (!id) return null;
  const linkedProfileIds = [
    ...toArray(safeHypothesis.linked_profile_ids),
    ...toArray(safeHypothesis.linkedProfiles),
    ...toArray(safeHypothesis.profile_ids),
    ...toArray(safeHypothesis.profileIds),
    safeHypothesis.linked_profile_id,
    safeHypothesis.linkedProfileId,
    safeHypothesis.profile_id,
    safeHypothesis.profileId,
  ].map((value) => normalizeText(value)).filter(Boolean);

  return {
    ...safeHypothesis,
    id,
    parent_hypothesis_id: readLegacyParentHypothesisId(HYPOTHESIS_MODES.COMMENTS, safeHypothesis) || '',
    validation_status: normalizeHypothesisState(
      safeHypothesis.validation_status
      ?? safeHypothesis.validationStatus
      ?? safeHypothesis.hypothesis_state
      ?? safeHypothesis.state
      ?? safeHypothesis.status
      ?? safeHypothesis.outcome
      ?? HYPOTHESIS_STATE.INCONCLUSIVE,
    ),
    linked_profile_ids: [...new Set(linkedProfileIds)],
  };
}

export function buildLegacyTopologyRecords({ hypotheses = [], storageKey = '', videoRows = [], interviewRows = [] } = {}) {
  const records = [];
  toArray(hypotheses).forEach((hypothesis) => {
    const parentHypothesisId = readLegacyParentHypothesisId(HYPOTHESIS_MODES.COMMENTS, hypothesis);
    const hypothesisId = normalizeLegacyHypothesisId(hypothesis?.id);
    if (!parentHypothesisId || !hypothesisId) return;
    records.push({
      parent: { mode: HYPOTHESIS_MODES.COMMENTS, hypothesis_id: parentHypothesisId, storage_key: storageKey || undefined },
      child: { mode: HYPOTHESIS_MODES.COMMENTS, hypothesis_id: hypothesisId, storage_key: storageKey || undefined },
      source: 'legacy_comments_parent_field',
    });
  });
  toArray(videoRows).forEach((row) => {
    const parentHypothesisId = readLegacyParentHypothesisId(HYPOTHESIS_MODES.VIDEO, row);
    const hypothesisId = normalizeLegacyHypothesisId(row?.id);
    if (!parentHypothesisId || !hypothesisId) return;
    records.push({
      parent: { mode: HYPOTHESIS_MODES.VIDEO, hypothesis_id: parentHypothesisId },
      child: { mode: HYPOTHESIS_MODES.VIDEO, hypothesis_id: hypothesisId },
      source: 'legacy_video_hierarchy_metadata',
    });
  });
  toArray(interviewRows).forEach((row) => {
    const parentHypothesisId = readLegacyParentHypothesisId(HYPOTHESIS_MODES.INTERVIEWS, row);
    const hypothesisId = normalizeLegacyHypothesisId(row?.id);
    if (!parentHypothesisId || !hypothesisId) return;
    records.push({
      parent: { mode: HYPOTHESIS_MODES.INTERVIEWS, hypothesis_id: parentHypothesisId },
      child: { mode: HYPOTHESIS_MODES.INTERVIEWS, hypothesis_id: hypothesisId },
      source: 'legacy_interview_hierarchy_metadata',
    });
  });
  return records;
}

export function buildLegacyIdentityRecords({ evolutionLinks = [], storageKey = '' } = {}) {
  const groups = new Map();
  toArray(evolutionLinks).forEach((rawLink) => {
    const link = normalizeLegacyEvolutionLink(rawLink, { storage_key: storageKey });
    if (!link || link.deleted_at) return;
    const sourceId = link.source_hypothesis_id;
    if (!groups.has(sourceId)) groups.set(sourceId, []);
    groups.get(sourceId).push(link);
  });

  return [...groups.entries()].map(([sourceHypothesisId, links]) => ({
    identity_id: `legacy_identity:${sourceHypothesisId}`,
    origin_node: { mode: HYPOTHESIS_MODES.COMMENTS, hypothesis_id: sourceHypothesisId, storage_key: storageKey || undefined },
    nodes: [
      { mode: HYPOTHESIS_MODES.COMMENTS, hypothesis_id: sourceHypothesisId, storage_key: storageKey || undefined, origin: true },
      ...links.map((link) => ({ mode: link.destination_mode, hypothesis_id: link.destination_hypothesis_id })),
    ],
  }));
}
