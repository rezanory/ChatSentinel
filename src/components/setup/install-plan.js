import { spawn } from 'node:child_process';
import { versionAtLeast } from './prerequisite-detector.js';
import { windowsAdapter } from './platform-adapters/windows.js';
import { macosAdapter } from './platform-adapters/macos.js';

const MINIMUMS = Object.freeze({ node: '20.0.0', git: '2.40.0' });

export function buildSetupPlan(report, options = {}) {
  const platform = report?.profile?.platform;
  const adapter = options.adapter || adapterFor(platform);
  if (!adapter) return { ok: false, error: `unsupported-platform:${platform || 'unknown'}`, steps: [] };
  const includeRecommended = options.includeRecommended !== false;
  const root = options.root || process.cwd();
  const steps = [];
  const prerequisites = report.prerequisites || {};
  for (const id of ['node', 'git', 'chrome']) {
    const action = requirementAction(id, prerequisites[id]);
    const next = action === 'install' ? adapter.installStep(id) : action === 'update' ? adapter.updateStep?.(id) : null;
    if (next) steps.push(next);
  }
  if (includeRecommended) {
    const action = requirementAction('gh', prerequisites.gh);
    const next = action === 'install' ? adapter.installStep('gh') : action === 'update' ? adapter.updateStep?.('gh') : null;
    if (next) steps.push(next);
  }
  const packageActionPlanned = steps.some(step => ['install-package', 'update-package'].includes(step.kind));
  if (packageActionPlanned && prerequisites.packageManager?.installed === false) {
    const managerStep = adapter.packageManagerStep?.(root);
    if (managerStep) steps.unshift(managerStep);
  }
  if (options.includeWatchdogService) steps.push(...adapter.watchdogServiceSteps(root));
  return {
    ok: true,
    platform,
    bootstrapHint: adapter.bootstrapHint(),
    steps,
    requiresApproval: steps.length > 0,
    generatedAt: new Date().toISOString()
  };
}

export function requirementAction(id, row = {}) {
  if (!row?.installed) return 'install';
  if (MINIMUMS[id] && !versionAtLeast(row.version, MINIMUMS[id])) return 'update';
  return 'none';
}

export function needsInstall(id, row = {}) {
  return requirementAction(id, row) !== 'none';
}
export async function applySetupPlan(plan, options = {}) {
  if (!plan?.ok) return { ok: false, error: plan?.error || 'invalid-plan', results: [] };
  const approved = new Set(options.approvedStepIds || []);
  const results = [];
  for (const step of plan.steps || []) {
    if (!approved.has(step.id)) {
      results.push({ id: step.id, status: 'skipped', reason: 'not-approved' });
      continue;
    }
    const result = await runStep(step, options);
    results.push({ id: step.id, ...result });
  }
  return { ok: results.every(row => row.status !== 'failed'), results };
}

async function runStep(step, options) {
  if (step.manual) return { status: 'manual-required', instruction: step.instruction || 'Manual action required.' };
  if (options.dryRun !== false) return { status: 'planned', command: displayCommand(step) };
  const spawnImpl = options.spawn || spawn;
  return await new Promise(resolve => {
    const child = spawnImpl(step.command, step.args || [], {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: options.stdio || 'inherit'
    });
    child.on('error', error => resolve({ status: 'failed', error: String(error) }));
    child.on('exit', code => resolve(code === 0 ? { status: 'succeeded' } : { status: 'failed', exitCode: code }));
  });
}

export function displayCommand(step) {
  return [step.command, ...(step.args || [])].map(quote).join(' ');
}
function adapterFor(platform) {
  if (platform === 'win32') return windowsAdapter;
  if (platform === 'darwin') return macosAdapter;
  return null;
}

function quote(value) {
  const text = String(value);
  return /[\s"']/u.test(text) ? JSON.stringify(text) : text;
}
