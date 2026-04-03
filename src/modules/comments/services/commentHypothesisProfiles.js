const toArray = (value) => (Array.isArray(value) ? value : []);

export const normalizeCommentHypothesisLinkedProfileIds = (hypothesis = {}) => [...new Set([
  ...toArray(hypothesis?.linked_profile_ids),
  ...toArray(hypothesis?.profile_ids),
  hypothesis?.linked_profile_id,
  hypothesis?.profile_id,
].map((profileId) => String(profileId || '').trim()).filter(Boolean))];

export const listAvailableCommentHypothesisProfiles = (profilesByScope = {}, activeScopeKey = '') => {
  const aggregated = new Map();
  const prioritizedScopeKeys = [...new Set([
    String(activeScopeKey || '').trim(),
    '__all__',
    ...Object.keys(profilesByScope || {}),
  ].filter(Boolean))];

  prioritizedScopeKeys.forEach((scopeKey) => {
    const scopeData = profilesByScope?.[scopeKey];
    const profiles = Array.isArray(scopeData?.profiles) ? scopeData.profiles : [];
    const assignments = scopeData?.assignments && typeof scopeData.assignments === 'object' ? scopeData.assignments : {};
    const assignmentCountByProfile = Object.values(assignments).reduce((acc, profileId) => {
      const normalizedProfileId = String(profileId || '').trim();
      if (!normalizedProfileId) return acc;
      acc.set(normalizedProfileId, (acc.get(normalizedProfileId) || 0) + 1);
      return acc;
    }, new Map());

    profiles.forEach((profile) => {
      const id = String(profile?.id || '').trim();
      if (!id) return;
      const previous = aggregated.get(id);
      const nextAssignmentCount = Number(assignmentCountByProfile.get(id) || 0);
      aggregated.set(id, {
        id,
        name: String(profile?.name || previous?.name || 'Perfil estratégico').trim() || 'Perfil estratégico',
        description: String(profile?.description || previous?.description || '').trim(),
        assignmentCount: Number(previous?.assignmentCount || 0) + nextAssignmentCount,
      });
    });
  });

  return Array.from(aggregated.values()).sort((left, right) => left.name.localeCompare(right.name, 'es'));
};
