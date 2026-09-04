(() => {
  const ID_PATTERNS = [
    /\/c\/([^/?#]+)/i,
    /\/conversation\/([^/?#]+)/i,
    /\/conversations\/([^/?#]+)/i
  ];

  function resolve() {
    const fixture = fixtureIdentity();
    if (fixture) return fixture;

    const fromUrl = extractFromUrl(location.href);
    if (fromUrl) return { id: fromUrl, source: 'url' };

    const activeLink = document.querySelector('a[aria-current="page"][href*="/c/"], a[data-active="true"][href*="/c/"]');
    const fromLink = extractFromUrl(activeLink?.href || '');
    if (fromLink) return { id: fromLink, source: 'active-link' };

    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    const fromCanonical = extractFromUrl(canonical);
    if (fromCanonical) return { id: fromCanonical, source: 'canonical' };

    const fromHistory = findNamedConversationId(history.state);
    if (fromHistory) return { id: fromHistory, source: 'history-state' };

    const resources = performance.getEntriesByType('resource');
    const floor = Math.max(0, resources.length - 250);
    for (let i = resources.length - 1; i >= floor; i -= 1) {
      const name = resources[i]?.name || '';
      const fromResource = extractConversationResource(name);
      if (fromResource) return { id: fromResource, source: 'resource' };
    }

    return null;
  }

  function extractFromUrl(value) {
    if (!value) return null;
    for (const pattern of ID_PATTERNS) {
      const match = String(value).match(pattern);
      if (match?.[1] && validId(match[1])) return decodeURIComponent(match[1]);
    }
    try {
      const url = new URL(value, location.origin);
      for (const key of ['conversation_id', 'conversationId', 'conversation']) {
        const id = url.searchParams.get(key);
        if (validId(id)) return id;
      }
    } catch {}
    return null;
  }

  function extractConversationResource(value) {
    try {
      const url = new URL(value, location.origin);
      const path = url.pathname;
      const patterns = [
        /\/backend-api\/conversation\/([^/?#]+)/i,
        /\/backend-api\/conversations\/([^/?#]+)/i,
        /\/conversation\/([^/?#]+)/i,
        /\/conversations\/([^/?#]+)/i
      ];
      for (const pattern of patterns) {
        const match = path.match(pattern);
        if (validId(match?.[1])) return decodeURIComponent(match[1]);
      }
      for (const key of ['conversation_id', 'conversationId']) {
        const id = url.searchParams.get(key);
        if (validId(id)) return id;
      }
    } catch {}
    return null;
  }

  function findNamedConversationId(value, depth = 0, seen = new Set()) {
    if (!value || depth > 5 || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (/^(conversation_?id|conversationId)$/i.test(key) && validId(item)) return String(item);
    }
    for (const item of Object.values(value)) {
      const nested = findNamedConversationId(item, depth + 1, seen);
      if (nested) return nested;
    }
    return null;
  }

  function validId(value) {
    if (typeof value !== 'string') return false;
    const id = value.trim();
    return id.length >= 8 && id.length <= 200 && !/[\s<>]/.test(id);
  }

  function fixtureIdentity() {
    if (location.hostname !== '127.0.0.1' || location.port !== '4320') return null;
    const explicit = document.documentElement.dataset.chatsentinelConversationId;
    return validId(explicit) ? { id: explicit, source: 'fixture' } : null;
  }

  window.ChatSentinelIdentity = Object.freeze({ resolve, extractFromUrl });
})();
