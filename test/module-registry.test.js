import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleRegistry, normalizeModuleDescriptor } from '../src/core/modules/registry.js';

function descriptor(moduleId, overrides = {}) {
  return {
    moduleId,
    version: '1.0.0',
    lifecycle: 'lazy',
    dependencies: [],
    conflicts: [],
    authorityScope: [],
    sideEffects: [],
    healthChecks: [],
    resourceBudget: {},
    ...overrides
  };
}

test('descriptor normalization is deterministic and deeply immutable', () => {
  const value = normalizeModuleDescriptor(descriptor('core.alpha', {
    mandatoryForProfiles: ['automation_platform', 'automation_platform'],
    authorityScope: ['read_project', 'read_project'],
    resourceBudget: { memory_mb: 128, cpu: 'low' }
  }));
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(value.mandatoryForProfiles, ['automation_platform']);
  assert.deepEqual(value.authorityScope, ['read_project']);

  assert.deepEqual(value.resourceBudget, { cpu: 'low', memory_mb: 128 });
  assert.throws(() => value.dependencies.push('x'), TypeError);
});

test('enabled module deterministically activates transitive dependencies', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([
    descriptor('core.base'),
    descriptor('core.mid', { dependencies: ['core.base'] }),
    descriptor('core.top', { dependencies: ['core.mid'], defaultEnabled: true })
  ]);
  const result = registry.resolve();
  assert.equal(result.ok, true);
  assert.deepEqual(result.enabledModules, ['core.base', 'core.mid', 'core.top']);
  assert.deepEqual(result.disabledModules, []);
});

test('explicitly disabled dependency fails closed instead of being silently enabled', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([
    descriptor('core.base'),
    descriptor('core.top', { dependencies: ['core.base'], defaultEnabled: true })
  ]);
  registry.setDesired('core.base', false);
  const result = registry.resolve();
  assert.equal(result.ok, false);
  assert.equal(result.enabledModules.length, 0);
  assert.equal(result.errors.some(error => error.code === 'DEPENDENCY_EXPLICITLY_DISABLED'), true);
});

test('profile mandatory module cannot be disabled', () => {
  const registry = new ModuleRegistry();
  registry.register(descriptor('core.required', {
    mandatoryForProfiles: ['automation_platform']
  }));
  registry.setDesired('core.required', false);
  const result = registry.resolve({ profileId: 'automation_platform' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.code === 'PROFILE_REQUIRED_DISABLED'), true);
});

test('missing dependency is explicit evidence', () => {
  const registry = new ModuleRegistry();
  registry.register(descriptor('core.top', {
    dependencies: ['core.missing'],
    defaultEnabled: true
  }));
  const result = registry.resolve();
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.code === 'DEPENDENCY_MISSING'), true);
});

test('dependency cycle is rejected deterministically', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([
    descriptor('core.a', { dependencies: ['core.b'], defaultEnabled: true }),
    descriptor('core.b', { dependencies: ['core.a'] })
  ]);
  const result = registry.resolve();
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.code === 'DEPENDENCY_CYCLE'), true);
});

test('active conflicts fail closed with one canonical pair', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([
    descriptor('core.a', { conflicts: ['core.b'], defaultEnabled: true }),
    descriptor('core.b', { conflicts: ['core.a'], defaultEnabled: true })
  ]);
  const result = registry.resolve();
  assert.equal(result.ok, false);
  const conflicts = result.errors.filter(error => error.code === 'CONFLICT_ACTIVE');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, 'core.a::core.b');
});

test('requiredModules activates a disabled-by-default closure', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([
    descriptor('core.base'),
    descriptor('core.feature', { dependencies: ['core.base'] })
  ]);
  const result = registry.resolve({ requiredModules: ['core.feature'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.enabledModules, ['core.base', 'core.feature']);
});

test('canonical snake_case descriptor fields are accepted without weakening the internal contract', () => {
  const value = normalizeModuleDescriptor({
    module_id: 'core.snake',
    version: '1.2.3',
    lifecycle: 'always_on',
    enabled: true,
    mandatory_for_profiles: ['automation_platform'],
    dependencies: [],
    conflicts: [],
    authority_scope: ['read_project'],
    side_effects: ['none'],
    health_checks: ['self_test'],
    resource_budget: { memory_mb: 64 }
  });
  assert.equal(value.moduleId, 'core.snake');
  assert.equal(value.defaultEnabled, true);
  assert.deepEqual(value.mandatoryForProfiles, ['automation_platform']);
  assert.deepEqual(value.authorityScope, ['read_project']);
  assert.deepEqual(value.healthChecks, ['self_test']);
  assert.deepEqual(value.resourceBudget, { memory_mb: 64 });
});

test('registerMany is atomic when any descriptor or duplicate is invalid', () => {
  const registry = new ModuleRegistry();
  registry.register(descriptor('core.existing'));
  assert.throws(() => registry.registerMany([
    descriptor('core.new'),
    descriptor('core.existing')
  ]), /MODULE_DUPLICATE/);
  assert.equal(registry.has('core.new'), false);
  assert.equal(registry.has('core.existing'), true);

  assert.throws(() => registry.registerMany([
    descriptor('core.valid'),
    { moduleId: 'INVALID ID', version: '1.0.0' }
  ]));
  assert.equal(registry.has('core.valid'), false);
});

test('snapshot ordering is canonical and independent of registration order', () => {
  const registry = new ModuleRegistry();
  registry.registerMany([descriptor('core.z'), descriptor('core.a')]);
  registry.setDesired('core.z', false);
  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.modules.map(module => module.moduleId), ['core.a', 'core.z']);
  assert.deepEqual(snapshot.desired, { 'core.z': false });
  assert.equal(Object.isFrozen(snapshot), true);
});
