import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_PROJECT_WORKFLOW_PROFILE_ID,
  loadCanonicalWorkflowProfile,
  compileCanonicalRoadmap
} from '../src/components/workflow-continuation/canonical-roadmap.js';

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function phase(phaseId, prefix, sha, expectedComponents, expectedWaves) {
  const token = phaseId.replace(/[^0-9]/g, '_');
  return {
    phase: phaseId,
    branchPrefix: prefix,
    sourceRef: sha,
    packPlanPath: `control/${token}/packs.json`,
    componentRegistryPath: `control/${token}/components.json`,
    dependencyDagPath: `control/${token}/dag.json`,
    contractRoot: `control/${token}/contracts`,
    expectedPacks: 1,
    expectedComponents,
    expectedWaves
  };
}
function component(id, packId, slug, predecessors = []) {
  return {
    component_id: id,
    pack_id: packId,
    slug,
    title: slug,
    objective: `implement ${slug}`,
    predecessor_components: predecessors
  };
}

function sourcesFor(phaseDescriptor, components) {
  const packId = 'P01';
  return {
    [phaseDescriptor.packPlanPath]: {
      phase: phaseDescriptor.phase,
      pack_denominator: 1,
      component_denominator: components.length,
      packs: [{ pack_id: packId, title: 'Pack 1', components: components.map(row => row.component_id) }]
    },
    [phaseDescriptor.componentRegistryPath]: {
      phase: phaseDescriptor.phase,
      component_denominator: components.length,
      components
    },
    [phaseDescriptor.dependencyDagPath]: {
      phase: phaseDescriptor.phase,
      nodes: components.map(row => row.component_id),
      edges: components.flatMap(row => row.predecessor_components.map(from => ({ from, to: row.component_id })))
    }
  };
}
function fixture() {
  const ph7 = phase('PH-7', 'ph7', SHA_A, 3, 2);
  const ph105 = phase('PH-10.5', 'ph10-5', SHA_B, 2, 2);
  const ph7Components = [
    component('PH07-C01', 'P01', 'first'),
    component('PH07-C02', 'P01', 'second', ['PH07-C01']),
    component('PH07-C03', 'P01', 'third', ['PH07-C01'])
  ];
  const ph105Components = [
    component('PH105-C01', 'P01', 'final-a'),
    component('PH105-C02', 'P01', 'final-b', ['PH105-C01'])
  ];
  const sources = {
    [SHA_A]: sourcesFor(ph7, ph7Components),
    [SHA_B]: sourcesFor(ph105, ph105Components)
  };
  const contract = {
    schemaVersion: 1,
    workflowId: 'fixture:v1',
    repository: 'rezanory/chat-project',
    goal: { id: 'fixture', label: 'fixture', terminalPhase: 'PH-10.5' },
    stagePolicy: 'TOPOLOGICAL_WAVES',
    baselinePolicy: 'PREVIOUS_GREEN_INTEGRATION_HEAD',
    laneBranchPolicy: 'DETERMINISTIC_COMPONENT_BRANCH_V1',
    integrationBranchPolicy: 'DETERMINISTIC_WAVE_INTEGRATION_V1',
    maxParallelLanes: 8,
    expectedTotals: { packs: 2, components: 5, waves: 4 },
    phases: [ph7, ph105]
  };
  return { contract, sources };
}
test('canonical chat-project profile freezes the exact PH7 through PH10.5 denominator', async () => {
  const profile = await loadCanonicalWorkflowProfile(CHAT_PROJECT_WORKFLOW_PROFILE_ID);
  assert.deepEqual(profile.expectedTotals, { packs: 49, components: 162, waves: 76 });
  assert.equal(profile.maxParallelLanes, 8);
  assert.deepEqual(profile.phases.map(row => row.expectedComponents), [24, 24, 18, 42, 54]);
  assert.deepEqual(profile.phases.map(row => row.expectedWaves), [13, 13, 15, 13, 22]);
});

test('compiler creates deterministic DAG waves and never guesses a future stage baseline', async () => {
  const { contract, sources } = fixture();
  const workflow = await compileCanonicalRoadmap('ignored', contract, {
    repositoryIdentity: 'git@github.com:rezanory/chat-project.git',
    readJsonAtRef: async (_repo, ref, filePath) => structuredClone(sources[ref][filePath])
  });
  assert.deepEqual(workflow.canonicalTotals, { packs: 2, components: 5, waves: 4 });
  assert.equal(workflow.terminalStageId, 'PH10.5-W02');
  assert.deepEqual(workflow.stages.map(row => row.stageId), ['PH7-W01', 'PH7-W02', 'PH10.5-W01', 'PH10.5-W02']);
  assert.deepEqual(workflow.stages[0].lanes.map(row => row.laneId), ['PH07-C01']);
  assert.deepEqual(workflow.stages[1].lanes.map(row => row.laneId), ['PH07-C02', 'PH07-C03']);
  assert.equal(workflow.stages[0].lanes[0].branch, 'feat/ph7-p01-c01-first-v1');
  assert.equal(workflow.stages[0].lanes[0].baselineSha, SHA_A);
  assert.equal(workflow.stages[1].lanes[0].baselineSha, '');
});
test('compiler fails closed when DAG edges disagree with predecessor evidence', async () => {
  const { contract, sources } = fixture();
  const broken = structuredClone(sources);
  broken[SHA_A][contract.phases[0].dependencyDagPath].edges = [];
  await assert.rejects(
    compileCanonicalRoadmap('ignored', contract, {
      repositoryIdentity: 'rezanory/chat-project',
      readJsonAtRef: async (_repo, ref, filePath) => structuredClone(broken[ref][filePath])
    }),
    /workflow-dag-predecessor-mismatch/
  );
});

test('compiler rejects a repository identity that is not the governed project', async () => {
  const { contract } = fixture();
  await assert.rejects(
    compileCanonicalRoadmap('ignored', contract, { repositoryIdentity: 'someone/other-repo' }),
    /workflow-repository-mismatch/
  );
});
