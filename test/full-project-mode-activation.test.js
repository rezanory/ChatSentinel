import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateFullProjectMode,
  deterministicProjectId,
  loadFullProjectProfile
} from '../src/components/full-project-mode/activation.js';

class FakeStore {
  constructor({ projects = {}, configs = {} } = {}) {
    this.projects = structuredClone(projects);
    this.configs = structuredClone(configs);
  }
  getProject(id) { return this.projects[id] || null; }
  getConfig(id) { return this.configs[id] || {}; }
  async setProject(id, value) { this.projects[id] = structuredClone(value); }
  async setConfig(id, value) { this.configs[id] = structuredClone(value); }
  async deleteProject(id) { delete this.projects[id]; }
}

const FIXED_NOW = () => new Date('2026-09-05T10:00:00.000Z');

test('canonical Full Project Mode profile retains every required capability', async () => {
  const profile = await loadFullProjectProfile();
  assert.equal(profile.profileId, 'full');
  assert.equal(profile.command, 'CHATSENTINEL FULL PROJECT MODE');
  for (const key of [
    'autoRecovery', 'groupTabs', 'sessionSnapshots', 'selectiveRestore',
    'activeParallelChats', 'conversationDomCompaction', 'searchExportImport',
    'auditHistory', 'componentFirst', 'parallelLanes', 'canonicalHandoff',
    'antiBlocker', 'integrationController', 'runnerOnDemand', 'releaseRequiresAllGates'
  ]) assert.equal(profile[key], true, key);
});

test('activation creates and attaches a deterministic project from known project path', async () => {
  const store = new FakeStore({
    configs: {
      chatA: { projectPath: 'C:\\Work\\Alpha\\', operationClass: 'write', laneId: 'ROOT' }
    }
  });
  const result = await activateFullProjectMode(store, {
    conversationId: 'chatA', tabId: 55, title: 'Alpha Chat', url: 'https://chatgpt.com/c/a'
  }, { now: FIXED_NOW });

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.project.projectId, deterministicProjectId('c:/work/alpha'));
  assert.equal(result.project.autoRecovery, true);
  assert.equal(result.project.groupTabs, true);
  assert.equal(result.project.capabilityProfile.profileId, 'full');
  assert.equal(result.project.fullProjectMode.active, true);
  assert.equal(result.config.projectId, result.project.projectId);
  assert.equal(result.config.laneId, 'ROOT');
  assert.equal(result.config.tabId, 55);
  assert.equal(result.orchestrationActivation.configure.route, '/orchestrator/configure');
  assert.equal(result.orchestrationActivation.configure.client, 'local-process');
  assert.equal(result.orchestrationActivation.laneCommand, 'CREATE_LANE_CHAT');
  assert.equal(result.orchestrationActivation.workflowProfileParameter, 'workflowProfileId');
  assert.equal(result.orchestrationActivation.canonicalWorkflowCompilation, true);
  assert.equal(result.orchestrationActivation.stageBaselinePolicy, 'PREVIOUS_GREEN_INTEGRATION_HEAD');
  assert.deepEqual(result.orchestrationActivation.laneContract, ['laneId', 'branch', 'baselineSha', 'prompt']);
  assert.equal(result.orchestrationActivation.independentLanesOnly, true);
});

test('explicit selection activates an existing project without creating a second authority', async () => {
  const project = {
    projectId: 'project:existing', name: 'Existing', projectPath: 'C:\\Existing',
    operationClass: 'read_only', autoRecovery: false, groupTabs: false, color: 'purple'
  };
  const store = new FakeStore({ projects: { [project.projectId]: project } });
  const result = await activateFullProjectMode(store, {
    conversationId: 'chatB', selectedProjectId: project.projectId, tabId: 56
  }, { now: FIXED_NOW });

  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(Object.keys(store.projects).length, 1);
  assert.equal(result.project.projectPath, project.projectPath);
  assert.equal(result.project.autoRecovery, true);
  assert.equal(result.project.groupTabs, true);
  assert.equal(store.configs.chatB.projectId, project.projectId);
});

test('attached project wins over a conflicting selection and preserves lane metadata', async () => {
  const attached = {
    projectId: 'project:attached', name: 'Attached', projectPath: 'C:\\Attached',
    operationClass: 'write', autoRecovery: false, groupTabs: false, color: 'blue'
  };
  const other = {
    projectId: 'project:other', name: 'Other', projectPath: 'C:\\Other',
    operationClass: 'read_only', autoRecovery: false, groupTabs: true, color: 'green'
  };
  const store = new FakeStore({
    projects: { [attached.projectId]: attached, [other.projectId]: other },
    configs: { chatC: { projectId: attached.projectId, laneId: 'C7', branch: 'feat/c7' } }
  });
  const result = await activateFullProjectMode(store, {
    conversationId: 'chatC', selectedProjectId: other.projectId
  }, { now: FIXED_NOW });

  assert.equal(result.ok, true);
  assert.equal(result.project.projectId, attached.projectId);
  assert.equal(result.config.laneId, 'C7');
  assert.equal(result.config.branch, 'feat/c7');
  assert.equal(store.projects[other.projectId].autoRecovery, false);
});

test('activation fails closed when no project or project path is explicitly resolvable', async () => {
  const store = new FakeStore({
    projects: {
      one: { projectId: 'one', name: 'One', projectPath: 'C:\\One' },
      two: { projectId: 'two', name: 'Two', projectPath: 'C:\\Two' }
    }
  });
  const result = await activateFullProjectMode(store, { conversationId: 'chatD' }, { now: FIXED_NOW });
  assert.deepEqual(result, { ok: false, error: 'project-selection-required' });
  assert.equal(store.configs.chatD, undefined);
});

test('repeated activation is idempotent for project identity and first activation time', async () => {
  const store = new FakeStore({ configs: { chatE: { projectPath: 'C:\\Same' } } });
  const first = await activateFullProjectMode(store, { conversationId: 'chatE' }, { now: FIXED_NOW });
  const second = await activateFullProjectMode(store, { conversationId: 'chatE' }, {
    now: () => new Date('2026-09-05T10:05:00.000Z')
  });
  assert.equal(second.project.projectId, first.project.projectId);
  assert.equal(Object.keys(store.projects).length, 1);
  assert.equal(second.project.fullProjectMode.activatedAt, first.project.fullProjectMode.activatedAt);
  assert.equal(second.project.fullProjectMode.lastActivatedAt, '2026-09-05T10:05:00.000Z');
});
