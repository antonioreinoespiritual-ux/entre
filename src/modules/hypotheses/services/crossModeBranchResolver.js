import { buildNodeKey, parseNodeKey } from './crossModeGraphCore.js';

const createResolverContext = ({ identities, nodeToIdentity, childrenByNodeKey } = {}) => ({
  identities: identities instanceof Map ? identities : new Map(),
  nodeToIdentity: nodeToIdentity instanceof Map ? nodeToIdentity : new Map(),
  childrenByNodeKey: childrenByNodeKey instanceof Map ? childrenByNodeKey : new Map(),
});

const createResolverContextFromGraph = (graph = {}) => createResolverContext({
  identities: graph?.identities,
  nodeToIdentity: graph?.nodeToIdentity,
  childrenByNodeKey: graph?.childrenByNodeKey,
});

const normalizeTargetNodeKey = ({ nodeKey = '', mode = '', hypothesisId = '', id = '' } = {}) => {
  const explicitNodeKey = String(nodeKey || '').trim();
  if (explicitNodeKey) return explicitNodeKey;
  return buildNodeKey(mode, hypothesisId || id);
};

const mapNodeKeysToNodes = (nodeKeys = []) => [...new Set((nodeKeys || []).map((value) => String(value || '').trim()).filter(Boolean))]
  .map((nodeKey) => ({ nodeKey, ...parseNodeKey(nodeKey) }));

const resolveEquivalentNodeKeys = (context, target = {}, { includeSelf = true } = {}) => {
  const safeContext = createResolverContext(context);
  const targetNodeKey = normalizeTargetNodeKey(target);
  const identityId = safeContext.nodeToIdentity.get(targetNodeKey);
  if (!identityId) return includeSelf && targetNodeKey ? [targetNodeKey] : [];
  const identity = safeContext.identities.get(identityId);
  const equivalentNodeKeys = (identity?.nodes || []).map((node) => String(node?.nodeKey || buildNodeKey(node?.mode, node?.hypothesisId || node?.hypothesis_id || ''))).filter(Boolean);
  if (includeSelf) return equivalentNodeKeys;
  return equivalentNodeKeys.filter((nodeKey) => nodeKey !== targetNodeKey);
};

const resolveEquivalentNodes = (context, target = {}, options = {}) => mapNodeKeysToNodes(resolveEquivalentNodeKeys(context, target, options));

const resolveDescendantNodeKeys = (context, target = {}, { includeSelf = false } = {}) => {
  const safeContext = createResolverContext(context);
  const startNodeKey = normalizeTargetNodeKey(target);
  const pending = [...(safeContext.childrenByNodeKey.get(startNodeKey) || [])];
  const descendants = includeSelf && startNodeKey ? [startNodeKey] : [];
  const visited = new Set(includeSelf && startNodeKey ? [startNodeKey] : []);

  while (pending.length) {
    const childNode = pending.shift();
    const childNodeKey = String(childNode?.nodeKey || '').trim();
    if (!childNodeKey || visited.has(childNodeKey)) continue;
    visited.add(childNodeKey);
    descendants.push(childNodeKey);
    (safeContext.childrenByNodeKey.get(childNodeKey) || []).forEach((nextNode) => pending.push(nextNode));
  }

  return descendants;
};

const resolveDescendants = (context, target = {}, options = {}) => mapNodeKeysToNodes(resolveDescendantNodeKeys(context, target, options));

const resolveCrossModeBranchNodeKeys = (context, target = {}, { includeRoot = true } = {}) => {
  const safeContext = createResolverContext(context);
  const targetNodeKey = normalizeTargetNodeKey(target);
  if (!targetNodeKey) return [];

  const branchNodeKeys = new Set(includeRoot ? [targetNodeKey] : []);
  const rootEquivalentNodeKeys = resolveEquivalentNodeKeys(safeContext, { nodeKey: targetNodeKey }, { includeSelf: true });
  rootEquivalentNodeKeys.forEach((nodeKey) => branchNodeKeys.add(nodeKey));

  const descendantQueue = [...rootEquivalentNodeKeys];
  const visitedHierarchyRoots = new Set();
  while (descendantQueue.length) {
    const hierarchyRootKey = descendantQueue.shift();
    if (!hierarchyRootKey || visitedHierarchyRoots.has(hierarchyRootKey)) continue;
    visitedHierarchyRoots.add(hierarchyRootKey);

    const descendantNodeKeys = resolveDescendantNodeKeys(safeContext, { nodeKey: hierarchyRootKey }, { includeSelf: false });
    descendantNodeKeys.forEach((descendantNodeKey) => {
      const equivalentDescendantNodeKeys = resolveEquivalentNodeKeys(safeContext, { nodeKey: descendantNodeKey }, { includeSelf: true });
      equivalentDescendantNodeKeys.forEach((equivalentNodeKey) => branchNodeKeys.add(equivalentNodeKey));
      descendantQueue.push(...equivalentDescendantNodeKeys);
    });
  }

  return [...branchNodeKeys];
};

const resolveCrossModeBranch = (context, target = {}, options = {}) => mapNodeKeysToNodes(resolveCrossModeBranchNodeKeys(context, target, options));

export {
  createResolverContext,
  createResolverContextFromGraph,
  resolveEquivalentNodeKeys,
  resolveEquivalentNodes,
  resolveDescendantNodeKeys,
  resolveDescendants,
  resolveCrossModeBranchNodeKeys,
  resolveCrossModeBranch,
};
