import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const CHAT_PROJECT_WORKFLOW_PROFILE_ID = 'rezanory/chat-project:ph7-ph10.5:v1';
const CHAT_PROJECT_PROFILE_URL = new URL(
  '../../../control/v1_3/workflows/REZANORY_CHAT_PROJECT_PH7_PH10_5_V1.json',
  import.meta.url
);

export async function loadCanonicalWorkflowProfile(profileId) {
  if (profileId !== CHAT_PROJECT_WORKFLOW_PROFILE_ID) {
    throw new Error('workflow-profile-unsupported');
  }
  return JSON.parse(await fs.readFile(CHAT_PROJECT_PROFILE_URL, 'utf8'));
}

export async function compileCanonicalRoadmap(repoPath, contract, options = {}) {
  validateContract(contract);
  const identity = options.repositoryIdentity || await readRepositoryIdentity(repoPath);
  if (normalizeRepository(identity) !== normalizeRepository(contract.repository)) {
    throw new Error('workflow-repository-mismatch');
  }
  const readJson = options.readJsonAtRef || readJsonAtRef;
  const stages = [];
  const phaseSummaries = [];
  let firstBaseline = cleanSha(options.initialBaselineSha || contract.initialBaselineSha);
  for (const phase of contract.phases) {
    const [plan, registry, dag] = await Promise.all([
      readJson(repoPath, phase.sourceRef, phase.packPlanPath),
      readJson(repoPath, phase.sourceRef, phase.componentRegistryPath),
      readJson(repoPath, phase.sourceRef, phase.dependencyDagPath)
    ]);
    validatePhaseSources(phase, plan, registry, dag);
    const components = registry.components.map(component => ({ ...component }));
    const waves = topologicalWaves(components);
    const byId = new Map(components.map(component => [component.component_id, component]));
    const packById = new Map(plan.packs.map(pack => [pack.pack_id, pack]));
    if (Number(phase.expectedPacks) !== plan.packs.length) throw new Error('workflow-phase-pack-total-mismatch');
    if (Number(phase.expectedComponents) !== components.length) throw new Error('workflow-phase-component-total-mismatch');
    if (Number(phase.expectedWaves) !== waves.length) throw new Error('workflow-phase-wave-total-mismatch');

    waves.forEach((componentIds, waveIndex) => {
      const waveNumber = waveIndex + 1;
      const stageId = `${stagePhaseToken(phase.phase)}-W${pad(waveNumber)}`;
      const baseline = stages.length === 0 ? (firstBaseline || phase.sourceRef) : '';
      const lanes = componentIds.map(componentId => buildComponentLane({
        component: byId.get(componentId),
        pack: packById.get(byId.get(componentId)?.pack_id),
        phase,
        waveNumber,
        baselineSha: baseline
      }));
      stages.push({
        stageId,
        label: `${phase.phase} topological wave ${waveNumber}`,
        phase: phase.phase,
        waveNumber,
        baselineMode: stages.length === 0 ? 'EXPLICIT_INITIAL_BASELINE' : 'PREVIOUS_STAGE_INTEGRATION_HEAD',
        sourceRef: phase.sourceRef,
        lanes,
        integrationLane: buildIntegrationLane(phase, stageId, waveNumber, lanes, baseline)
      });
    });
    phaseSummaries.push({
      phase: phase.phase,
      sourceRef: phase.sourceRef,
      packs: plan.packs.length,
      components: components.length,
      waves: waves.length,
      maxWaveWidth: Math.max(...waves.map(wave => wave.length))
    });
  }

  const totals = phaseSummaries.reduce((acc, row) => ({
    packs: acc.packs + row.packs, components: acc.components + row.components, waves: acc.waves + row.waves
  }), { packs: 0, components: 0, waves: 0 });
  if (Number(contract.expectedTotals?.packs) !== totals.packs) throw new Error('workflow-total-pack-mismatch');
  if (Number(contract.expectedTotals?.components) !== totals.components) throw new Error('workflow-total-component-mismatch');
  if (Number(contract.expectedTotals?.waves) !== totals.waves) throw new Error('workflow-total-wave-mismatch');
  const terminalPhase = contract.goal?.terminalPhase;
  const terminalStages = stages.filter(stage => stage.phase === terminalPhase);
  if (!terminalStages.length) throw new Error('workflow-terminal-phase-missing');
  const terminalStageId = terminalStages.at(-1).stageId;
  return {
    enabled: true,
    valid: true,
    profileId: contract.workflowId,
    goal: contract.goal,
    terminalStageId,
    maxParallelLanes: Math.max(1, Math.min(8, Number(contract.maxParallelLanes || 2))),
    plannerLane: contract.plannerLane,
    stageBaselines: {},
    stages,
    canonicalSources: phaseSummaries,
    canonicalTotals: totals,
    derivedFromCanonicalRoadmap: true
  };
}

export function bindStageBaseline(stage, baselineSha) {
  const baseline = cleanSha(baselineSha);
  if (!stage || !baseline) return stage;
  return {
    ...stage,
    baselineSha: baseline,
    lanes: (stage.lanes || []).map(lane => ({ ...lane, baselineSha: baseline })),
    integrationLane: stage.integrationLane ? { ...stage.integrationLane, baselineSha: baseline } : null
  };
}
function buildComponentLane({ component, pack, phase, waveNumber, baselineSha }) {
  if (!component || !pack) throw new Error('workflow-component-pack-link-missing');
  const componentToken = component.component_id.split('-').at(-1).toLowerCase();
  const packToken = String(component.pack_id || '').toLowerCase();
  const branch = `feat/${phase.branchPrefix}-${packToken}-${componentToken}-${component.slug}-v1`;
  const contractPath = `${phase.contractRoot}/${component.slug}.contract.json`;
  const riskPath = `${phase.contractRoot}/${component.slug}.risk.json`;
  return {
    laneId: component.component_id,
    laneName: `${component.component_id} ${component.title}`,
    branch,
    baselineSha,
    baselineMode: baselineSha ? 'STAGE_BASELINE' : 'PREVIOUS_STAGE_INTEGRATION_HEAD',
    role: 'implementation',
    required: true,
    phase: phase.phase,
    packId: component.pack_id,
    waveNumber,
    slug: component.slug,
    predecessorComponents: [...(component.predecessor_components || [])],
    contractPath,
    riskPath,
    prompt: componentPrompt({ component, pack, phase, branch, contractPath, riskPath })
  };
}

function buildIntegrationLane(phase, stageId, waveNumber, lanes, baselineSha) {
  const branch = `integration/chatsentinel-${phase.branchPrefix}-wave-${pad(waveNumber)}-v1`;
  const laneIds = lanes.map(lane => lane.laneId);
  return {
    laneId: `${stageId}-INTEGRATION`,
    laneName: `${stageId} green-spine integration`,
    branch,
    baselineSha,
    baselineMode: baselineSha ? 'STAGE_BASELINE' : 'PREVIOUS_STAGE_INTEGRATION_HEAD',
    role: 'integration',
    required: true,
    prompt: integrationPrompt(phase, stageId, branch, lanes, laneIds)
  };
}
function componentPrompt({ component, pack, phase, branch, contractPath, riskPath }) {
  const predecessors = (component.predecessor_components || []).join(', ') || 'none';
  return [
    'CHATSENTINEL FULL PROJECT MODE',
    `${phase.phase} ${component.component_id} ONLY Ã¢â‚¬â€ ${component.title}.`,
    `Canonical pack: ${component.pack_id} ${pack.title}.`,
    `Objective: ${component.objective}`,
    `Exact governance source ref: ${phase.sourceRef}.`,
    `Sources: ${phase.packPlanPath}; ${phase.componentRegistryPath}; ${phase.dependencyDagPath}.`,
    `Frozen component evidence: ${contractPath}; ${riskPath}.`,
    `Canonical predecessors: ${predecessors}.`,
    `Work only on deterministic lane branch ${branch} from the stage baseline supplied by ChatSentinel.`,
    'Reconcile repository state and exact predecessor evidence first. Preserve component-first, tenant/authority and contract boundaries.',
    'Run focused plus relevant regression/governance gates without fail-fast; fix-forward only in scope; push an exact green candidate and handoff.',
    'Do not skip ahead, merge main, mutate stable/production, or invent missing roadmap work.'
  ].join('\n');
}

function integrationPrompt(phase, stageId, branch, lanes, laneIds) {
  return [
    'CHATSENTINEL FULL PROJECT MODE',
    `${stageId} INTEGRATION ONLY for ${phase.phase}.`,
    `Integrate exact green candidates for: ${laneIds.join(', ')}.`,
    `Integration branch: ${branch}.`,
    `Component branches: ${lanes.map(lane => lane.branch).join(', ')}.`,
    'Start from the exact stage baseline, verify each candidate identity/evidence, serialize merges, collect all gate failures, and fix-forward integration-only defects.',
    'Do not add roadmap scope, bypass failed gates, merge main, mutate production/stable runtime, or mark the project complete.',
    'Push the exact green integration head and canonical handoff; that head becomes the baseline for the next topological wave.'
  ].join('\n');
}
function topologicalWaves(components) {
  const ids = new Set(components.map(component => component.component_id));
  const remaining = new Map(components.map(component => [
    component.component_id,
    (component.predecessor_components || []).filter(id => ids.has(id))
  ]));
  const completed = new Set();
  const waves = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, predecessors]) => predecessors.every(id => completed.has(id)))
      .map(([id]) => id)
      .sort(componentOrder);
    if (!ready.length) throw new Error('workflow-dependency-cycle');
    waves.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      completed.add(id);
    }
  }
  return waves;
}

function validateContract(contract) {
  if (!contract || contract.schemaVersion !== 1) throw new Error('workflow-contract-schema-invalid');
  if (!contract.repository || !Array.isArray(contract.phases) || !contract.phases.length) {
    throw new Error('workflow-contract-incomplete');
  }
  if (contract.stagePolicy !== 'TOPOLOGICAL_WAVES') throw new Error('workflow-stage-policy-unsupported');
  if (contract.baselinePolicy !== 'PREVIOUS_GREEN_INTEGRATION_HEAD') throw new Error('workflow-baseline-policy-unsupported');
  if (contract.laneBranchPolicy !== 'DETERMINISTIC_COMPONENT_BRANCH_V1') throw new Error('workflow-lane-branch-policy-unsupported');
  if (contract.integrationBranchPolicy !== 'DETERMINISTIC_WAVE_INTEGRATION_V1') throw new Error('workflow-integration-branch-policy-unsupported');
  for (const phase of contract.phases) validatePhaseDescriptor(phase);
}
function validatePhaseDescriptor(phase) {
  if (!phase?.phase || !phase.branchPrefix || !cleanSha(phase.sourceRef)) {
    throw new Error('workflow-phase-descriptor-invalid');
  }
  for (const key of ['packPlanPath', 'componentRegistryPath', 'dependencyDagPath', 'contractRoot']) {
    const value = String(phase[key] || '');
    if (!value.startsWith('control/') || value.includes('..')) throw new Error('workflow-source-path-invalid');
  }
}

function validatePhaseSources(phase, plan, registry, dag) {
  if (plan?.phase !== phase.phase || registry?.phase !== phase.phase || dag?.phase !== phase.phase) {
    throw new Error('workflow-phase-source-mismatch');
  }
  const packs = Array.isArray(plan.packs) ? plan.packs : [];
  const components = Array.isArray(registry.components) ? registry.components : [];
  const nodes = Array.isArray(dag.nodes) ? dag.nodes : [];
  if (Number(plan.pack_denominator) !== packs.length) throw new Error('workflow-pack-denominator-mismatch');
  if (Number(registry.component_denominator) !== components.length) throw new Error('workflow-component-denominator-mismatch');
  if (plan.component_denominator !== undefined && Number(plan.component_denominator) !== components.length) {
    throw new Error('workflow-plan-component-denominator-mismatch');
  }
  const componentIds = components.map(component => component.component_id);
  if (new Set(componentIds).size !== componentIds.length) throw new Error('workflow-component-duplicate');
  if (!sameSet(nodes, componentIds)) throw new Error('workflow-dag-node-mismatch');
  const edges = Array.isArray(dag.edges) ? dag.edges : [];
  const incoming = new Map(componentIds.map(id => [id, []]));
  for (const edge of edges) {
    if (!componentIds.includes(edge?.from) || !componentIds.includes(edge?.to)) throw new Error('workflow-dag-edge-node-missing');
    incoming.get(edge.to).push(edge.from);
  }
  const planned = packs.flatMap(pack => Array.isArray(pack.components) ? pack.components : []);
  if (!sameSet(planned, componentIds)) throw new Error('workflow-pack-component-mismatch');
  for (const component of components) {
    if (!packs.some(pack => pack.pack_id === component.pack_id)) throw new Error('workflow-component-pack-missing');
    if (!sameSet(incoming.get(component.component_id) || [], component.predecessor_components || [])) throw new Error('workflow-dag-predecessor-mismatch');
    for (const predecessor of component.predecessor_components || []) {
      if (!componentIds.includes(predecessor)) throw new Error('workflow-predecessor-missing');
    }
  }
}

function sameSet(left = [], right = []) {
  if (left.length !== right.length) return false;
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) return false;
  return [...a].every(value => b.has(value));
}

function cleanSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function stagePhaseToken(value) {
  return String(value || '').trim().toUpperCase().replace(/^PH-/, 'PH');
}

function componentOrder(left, right) {
  const a = Number(String(left || '').match(/-C(\d+)$/i)?.[1] || Number.MAX_SAFE_INTEGER);
  const b = Number(String(right || '').match(/-C(\d+)$/i)?.[1] || Number.MAX_SAFE_INTEGER);
  return a - b || String(left).localeCompare(String(right));
}

async function readRepositoryIdentity(repoPath) {
  await assertGitRepo(repoPath);
  const { stdout } = await execFileAsync(
    'git', ['-C', repoPath, 'config', '--get', 'remote.origin.url'],
    { windowsHide: true, maxBuffer: 1024 * 1024 }
  );
  const identity = String(stdout || '').trim();
  if (!identity) throw new Error('workflow-repository-origin-required');
  return identity;
}

function normalizeRepository(value) {
  let text = String(value || '').trim().replace(/\\/g, '/');
  text = text.replace(/\.git$/i, '').replace(/\/$/, '');
  text = text.replace(/^git@github\.com:/i, '').replace(/^https?:\/\/github\.com\//i, '');
  text = text.replace(/^ssh:\/\/git@github\.com\//i, '');
  return text.toLowerCase();
}

async function assertGitRepo(repoPath) {
  const candidate = String(repoPath || '').trim();
  if (!candidate) throw new Error('workflow-repo-path-required');
  const { stdout } = await execFileAsync(
    'git', ['-C', candidate, 'rev-parse', '--is-inside-work-tree'],
    { windowsHide: true, maxBuffer: 1024 * 1024 }
  );
  if (String(stdout || '').trim() !== 'true') throw new Error('workflow-repo-invalid');
}

export async function readJsonAtRef(repoPath, ref, filePath) {
  await assertGitRepo(repoPath);
  const sha = cleanSha(ref);
  if (!sha) throw new Error('workflow-source-ref-invalid');
  const sourcePath = String(filePath || '').trim().replace(/\\/g, '/');
  if (!sourcePath.startsWith('control/') || sourcePath.includes('..')) {
    throw new Error('workflow-source-path-invalid');
  }
  try {
    const { stdout } = await execFileAsync(
      'git', ['-C', repoPath, 'show', `${sha}:${sourcePath}`],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('JSON')) throw new Error('workflow-source-json-invalid');
    throw new Error('workflow-source-read-failed');
  }
}
