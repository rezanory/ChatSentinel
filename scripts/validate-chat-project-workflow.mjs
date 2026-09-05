import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CHAT_PROJECT_WORKFLOW_PROFILE_ID,
  loadCanonicalWorkflowProfile,
  compileCanonicalRoadmap
} from '../src/components/workflow-continuation/canonical-roadmap.js';

const execFileAsync = promisify(execFile);
const repoPath = String(process.argv[2] || process.env.CHAT_PROJECT_REPO || '').trim();
if (!repoPath) {
  console.error('usage: node scripts/validate-chat-project-workflow.mjs <chat-project-repo-path>');
  process.exitCode = 2;
} else {
  await validate(repoPath);
}

async function git(repo, ...args) {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return String(stdout || '').trim();
}
async function validate(repo) {
  const beforeHead = await git(repo, 'rev-parse', 'HEAD');
  const beforeStatus = await git(repo, 'status', '--porcelain=v1', '-uno');
  const profile = await loadCanonicalWorkflowProfile(CHAT_PROJECT_WORKFLOW_PROFILE_ID);
  const workflow = await compileCanonicalRoadmap(repo, profile);
  const afterHead = await git(repo, 'rev-parse', 'HEAD');
  const afterStatus = await git(repo, 'status', '--porcelain=v1', '-uno');
  if (beforeHead !== afterHead || beforeStatus !== afterStatus) {
    throw new Error('workflow-validator-mutated-repository');
  }
  const summary = {
    ok: true,
    workflowProfileId: CHAT_PROJECT_WORKFLOW_PROFILE_ID,
    totals: workflow.canonicalTotals,
    stages: workflow.stages.length,
    terminalStageId: workflow.terminalStageId,
    maxParallelLanes: workflow.maxParallelLanes,
    phaseWaves: workflow.canonicalSources.map(row => ({
      phase: row.phase,
      waves: row.waves,
      maxWaveWidth: row.maxWaveWidth,
      sourceRef: row.sourceRef
    })),
    firstStageId: workflow.stages[0]?.stageId,
    lastStageId: workflow.stages.at(-1)?.stageId,
    readOnlyPreserved: true
  };
  console.log(JSON.stringify(summary, null, 2));
}
