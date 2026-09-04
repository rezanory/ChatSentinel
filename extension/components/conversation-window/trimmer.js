(() => {
  const HIDDEN_ROLES = new Set(['system', 'tool', 'thinking']);

  function isVisibleMessage(node) {
    const role = node?.message?.author?.role;
    return Boolean(role && !HIDDEN_ROLES.has(role));
  }

  function trimConversation(data, limit = 40) {
    const mapping = data?.mapping;
    const currentNode = data?.current_node;
    if (!mapping || !currentNode || !mapping[currentNode]) return null;

    const path = [];
    const visited = new Set();
    let cursor = currentNode;
    while (cursor && mapping[cursor] && !visited.has(cursor)) {
      visited.add(cursor);
      path.push(cursor);
      cursor = mapping[cursor].parent ?? null;
    }
    path.reverse();
    if (!path.length) return null;

    const effectiveLimit = Math.max(4, Math.min(200, Number(limit) || 40));
    let turnCount = 0;
    let cutIndex = 0;
    let lastRole = null;
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const node = mapping[path[index]];
      if (!isVisibleMessage(node)) continue;
      const role = node.message?.author?.role || '';
      if (role !== lastRole) {
        turnCount += 1;
        lastRole = role;
      }
      if (turnCount > effectiveLimit) {
        cutIndex = index + 1;
        break;
      }
    }

    const keptRaw = path.slice(cutIndex);
    if (!keptRaw.some(id => isVisibleMessage(mapping[id]))) return null;

    const originalRootId = path[0];
    const originalRootNode = mapping[originalRootId];
    const hasAnchor = Boolean(originalRootNode && !isVisibleMessage(originalRootNode));
    const keptPath = hasAnchor && keptRaw[0] === originalRootId ? keptRaw.slice(1) : keptRaw;
    if (!keptPath.length) return null;

    const newMapping = {};
    if (hasAnchor) {
      newMapping[originalRootId] = {
        ...originalRootNode,
        parent: null,
        children: keptPath[0] ? [keptPath[0]] : []
      };
    }
    let visibleTotal = 0;
    let totalRole = null;
    for (const id of path) {
      const node = mapping[id];
      if (!isVisibleMessage(node)) continue;
      const role = node.message?.author?.role || '';
      if (role !== totalRole) {
        visibleTotal += 1;
        totalRole = role;
      }
    }

    let visibleKept = 0;
    let keptRole = null;
    for (let index = 0; index < keptPath.length; index += 1) {
      const id = keptPath[index];
      const original = mapping[id];
      if (!original) continue;
      const previousId = index === 0 ? (hasAnchor ? originalRootId : null) : keptPath[index - 1];
      const nextId = keptPath[index + 1] || null;
      newMapping[id] = { ...original, parent: previousId, children: nextId ? [nextId] : [] };
      if (isVisibleMessage(original)) {
        const role = original.message?.author?.role || '';
        if (role !== keptRole) {
          visibleKept += 1;
          keptRole = role;
        }
      }
    }

    const root = hasAnchor ? originalRootId : keptPath[0];
    const current_node = keptPath[keptPath.length - 1];
    if (!root || !current_node) return null;
    return {
      data: { ...data, mapping: newMapping, current_node, root },
      stats: {
        totalNodes: path.length,
        keptNodes: Object.keys(newMapping).length,
        visibleTotal,
        visibleKept,
        removedTurns: Math.max(0, visibleTotal - visibleKept),
        limit: effectiveLimit
      }
    };
  }

  globalThis.ChatSentinelConversationTrimmer = {
    trimConversation,
    isVisibleMessage,
    HIDDEN_ROLES
  };
})();
