const MODULE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const LIFECYCLES = new Set(['always_on', 'lazy', 'on_demand']);

export class ModuleRegistry {
  #modules = new Map();
  #desired = new Map();

  register(descriptor) {
    const normalized = normalizeModuleDescriptor(descriptor);
    if (this.#modules.has(normalized.moduleId)) {
      throw moduleError('MODULE_DUPLICATE', normalized.moduleId);
    }
    this.#modules.set(normalized.moduleId, normalized);
    return normalized;
  }

  registerMany(descriptors = []) {
    if (!Array.isArray(descriptors)) throw moduleError('MODULE_LIST_INVALID');
    const normalized = descriptors.map(descriptor => normalizeModuleDescriptor(descriptor));
    const batchIds = new Set();
    for (const module of normalized) {
      if (batchIds.has(module.moduleId) || this.#modules.has(module.moduleId)) {
        throw moduleError('MODULE_DUPLICATE', module.moduleId);
      }
      batchIds.add(module.moduleId);
    }
    for (const module of normalized) this.#modules.set(module.moduleId, module);
    return normalized;
  }

  has(moduleId) {
    return this.#modules.has(String(moduleId || '').trim());
  }

  get(moduleId) {
    return this.#modules.get(String(moduleId || '').trim()) || null;
  }

  setDesired(moduleId, enabled) {
    const id = normalizeModuleId(moduleId);
    if (!this.#modules.has(id)) throw moduleError('MODULE_UNKNOWN', id);
    if (typeof enabled !== 'boolean') throw moduleError('MODULE_DESIRED_INVALID', id);
    this.#desired.set(id, enabled);
    return this;
  }

  clearDesired(moduleId) {
    const id = normalizeModuleId(moduleId);
    this.#desired.delete(id);
    return this;
  }

  desiredState(moduleId) {
    const id = normalizeModuleId(moduleId);
    return this.#desired.has(id) ? this.#desired.get(id) : null;
  }

  resolve({ profileId = '', requiredModules = [] } = {}) {
    const normalizedProfileId = String(profileId || '').trim();
    const errors = [];
    const required = new Set();
    for (const moduleId of requiredModules || []) {
      try {
        required.add(normalizeModuleId(moduleId));
      } catch (error) {
        errors.push(asResolutionError(error));
      }
    }
    for (const module of this.#modules.values()) {
      if (normalizedProfileId && module.mandatoryForProfiles.includes(normalizedProfileId)) {
        required.add(module.moduleId);
      }
    }

    for (const [moduleId] of this.#desired) {
      if (!this.#modules.has(moduleId)) errors.push(resolutionError('UNKNOWN_OVERRIDE', moduleId));
    }
    for (const moduleId of required) {
      if (!this.#modules.has(moduleId)) {
        errors.push(resolutionError('PROFILE_REQUIRED_MISSING', moduleId));
      } else if (this.#desired.get(moduleId) === false) {
        errors.push(resolutionError('PROFILE_REQUIRED_DISABLED', moduleId));
      }
    }

    const requested = new Set(required);
    for (const module of this.#modules.values()) {
      const desired = this.#desired.get(module.moduleId);
      if (desired === true || (desired == null && module.defaultEnabled)) requested.add(module.moduleId);
    }

    const closure = new Set();
    const visiting = new Set();
    const visited = new Set();

    const visit = (moduleId, path = []) => {
      if (visited.has(moduleId)) return;
      if (visiting.has(moduleId)) {
        errors.push(resolutionError('DEPENDENCY_CYCLE', moduleId, [...path, moduleId]));
        return;
      }
      const module = this.#modules.get(moduleId);
      if (!module) {
        errors.push(resolutionError('DEPENDENCY_MISSING', moduleId, path));
        return;
      }
      if (this.#desired.get(moduleId) === false && !required.has(moduleId)) {
        errors.push(resolutionError('DEPENDENCY_EXPLICITLY_DISABLED', moduleId, path));
        return;
      }
      visiting.add(moduleId);
      closure.add(moduleId);
      for (const dependency of module.dependencies) visit(dependency, [...path, moduleId]);
      visiting.delete(moduleId);
      visited.add(moduleId);
    };

    for (const moduleId of requested) visit(moduleId);

    for (const moduleId of closure) {
      const module = this.#modules.get(moduleId);
      for (const conflict of module.conflicts) {
        if (closure.has(conflict)) {
          const pair = [moduleId, conflict].sort();
          const key = pair.join('::');
          if (!errors.some(error => error.code === 'CONFLICT_ACTIVE' && error.key === key)) {
            errors.push({ code: 'CONFLICT_ACTIVE', moduleId: pair[0], related: pair[1], key });
          }
        }
      }
    }

    const order = errors.length ? [] : topologicalOrder(closure, this.#modules);
    const enabled = errors.length ? [] : order;
    const disabled = [...this.#modules.keys()].filter(moduleId => !closure.has(moduleId)).sort();

    return deepFreeze({
      ok: errors.length === 0,
      profileId: normalizedProfileId,
      requiredModules: [...required].sort(),
      requestedModules: [...requested].sort(),
      enabledModules: enabled,
      disabledModules: disabled,
      errors: errors.map(error => ({ ...error }))
    });
  }

  snapshot() {
    return deepFreeze({
      modules: [...this.#modules.values()]
        .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
        .map(module => structuredClone(module)),
      desired: Object.fromEntries([...this.#desired.entries()].sort(([a], [b]) => a.localeCompare(b)))
    });
  }
}

export function normalizeModuleDescriptor(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw moduleError('MODULE_DESCRIPTOR_INVALID');
  }
  const moduleId = normalizeModuleId(input.moduleId ?? input.module_id);
  const version = String(input.version || '').trim();
  if (!VERSION_RE.test(version)) throw moduleError('MODULE_VERSION_INVALID', moduleId);
  const lifecycle = String(input.lifecycle || 'lazy').trim();
  if (!LIFECYCLES.has(lifecycle)) throw moduleError('MODULE_LIFECYCLE_INVALID', moduleId);

  const dependencies = normalizeIdList(input.dependencies, moduleId, 'MODULE_DEPENDENCY_INVALID');
  const conflicts = normalizeIdList(input.conflicts, moduleId, 'MODULE_CONFLICT_INVALID');
  if (dependencies.includes(moduleId)) throw moduleError('MODULE_SELF_DEPENDENCY', moduleId);
  if (conflicts.includes(moduleId)) throw moduleError('MODULE_SELF_CONFLICT', moduleId);

  return deepFreeze({
    moduleId,
    version,
    lifecycle,
    defaultEnabled: (input.defaultEnabled ?? input.default_enabled ?? input.enabled) === true,
    mandatoryForProfiles: normalizeStringList(input.mandatoryForProfiles ?? input.mandatory_for_profiles),
    dependencies,
    conflicts,
    authorityScope: normalizeStringList(input.authorityScope ?? input.authority_scope),
    sideEffects: normalizeStringList(input.sideEffects ?? input.side_effects),
    healthChecks: normalizeStringList(input.healthChecks ?? input.health_checks),
    resourceBudget: normalizeBudget(input.resourceBudget ?? input.resource_budget)
  });
}

function normalizeModuleId(value) {
  const id = String(value || '').trim();
  if (!MODULE_ID_RE.test(id)) throw moduleError('MODULE_ID_INVALID', id);
  return id;
}

function normalizeIdList(value, ownerId, code) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw moduleError(code, ownerId);
  const ids = value.map(item => normalizeModuleId(item));
  return [...new Set(ids)].sort();
}

function normalizeStringList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw moduleError('MODULE_STRING_LIST_INVALID');
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort();
}

function normalizeBudget(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw moduleError('MODULE_RESOURCE_BUDGET_INVALID');
  }
  const budget = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (!['string', 'number', 'boolean'].includes(typeof raw) && raw != null) {
      throw moduleError('MODULE_RESOURCE_BUDGET_INVALID', name);
    }
    budget[name] = raw;
  }
  return Object.fromEntries(Object.entries(budget).sort(([a], [b]) => a.localeCompare(b)));
}

function topologicalOrder(enabled, modules) {
  const indegree = new Map();
  const outgoing = new Map();
  for (const moduleId of enabled) {
    indegree.set(moduleId, 0);
    outgoing.set(moduleId, []);
  }
  for (const moduleId of enabled) {
    const module = modules.get(moduleId);
    for (const dependency of module.dependencies) {
      if (!enabled.has(dependency)) continue;
      indegree.set(moduleId, indegree.get(moduleId) + 1);
      outgoing.get(dependency).push(moduleId);
    }
  }
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([moduleId]) => moduleId)
    .sort();
  const order = [];
  while (ready.length) {
    const current = ready.shift();
    order.push(current);
    for (const next of outgoing.get(current).sort()) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) insertSorted(ready, next);
    }
  }
  if (order.length !== enabled.size) throw moduleError('DEPENDENCY_CYCLE');
  return order;
}

function insertSorted(values, value) {
  const index = values.findIndex(item => item.localeCompare(value) > 0);
  if (index === -1) values.push(value);
  else values.splice(index, 0, value);
}

function moduleError(code, moduleId = '') {
  const error = new Error(moduleId ? `${code}:${moduleId}` : code);
  error.code = code;
  error.moduleId = moduleId;
  return error;
}

function resolutionError(code, moduleId = '', path = []) {
  return { code, moduleId, path: [...path] };
}

function asResolutionError(error) {
  return resolutionError(error?.code || 'MODULE_RESOLUTION_ERROR', error?.moduleId || '');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
