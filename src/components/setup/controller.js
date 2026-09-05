import path from 'node:path';
import { detectPrerequisites } from './prerequisite-detector.js';
import { buildSetupPlan, applySetupPlan } from './install-plan.js';
import { buildRunnerPlan } from './runner-manager.js';
import { buildMaintenancePlan } from './maintenance-plan.js';

export async function inspectSetup(options = {}) {
  const report = detectPrerequisites(options);
  const health = await probeWatchdog(options.watchdogBase || 'http://127.0.0.1:4317', options.fetchImpl || fetch);
  return {
    ...report,
    watchdog: health,
    extension: {
      paired: Boolean(health?.paired),
      status: health?.paired ? 'paired' : 'not-paired-or-watchdog-offline'
    }
  };
}

export async function planSetup(options = {}) {
  const report = options.report || await inspectSetup(options);
  const root = options.root || process.cwd();
  const plan = buildSetupPlan(report, {
    root,
    includeRecommended: options.includeRecommended,
    includeWatchdogService: options.includeWatchdogService
  });
  return { ...plan, report };
}

export async function applySetup(options = {}) {
  const plan = options.plan || await planSetup(options);
  return applySetupPlan(plan, {
    approvedStepIds: options.approvedStepIds || [],
    dryRun: options.dryRun !== false,
    cwd: options.root || process.cwd(),
    env: options.env || process.env,
    spawn: options.spawn,
    stdio: options.stdio
  });
}
export async function planMaintenance(options = {}) {
  const report = options.report || await inspectSetup(options);
  return {
    ...buildMaintenancePlan(report, { action: options.action, root: options.root || process.cwd(), includeRecommended: options.includeRecommended }),
    report
  };
}

export async function applyMaintenance(options = {}) {
  const plan = options.plan || await planMaintenance(options);
  return applySetupPlan(plan, {
    approvedStepIds: options.approvedStepIds || [],
    dryRun: options.dryRun !== false,
    cwd: options.root || process.cwd(),
    env: options.env || process.env,
    spawn: options.spawn,
    stdio: options.stdio
  });
}

export async function planRunner(options = {}) {
  const report = options.report || await inspectSetup(options);
  return buildRunnerPlan({
    repo: options.repo,
    labels: options.labels,
    name: options.name,
    runnerDir: options.runnerDir || path.join(report.profile.dataDir, 'runner'),
    profile: report.profile
  });
}

async function probeWatchdog(base, fetchImpl) {
  try {
    const response = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { ok: false, online: false, statusCode: response.status };
    const json = await response.json();
    return { ...json, online: Boolean(json.ok) };
  } catch {
    return { ok: false, online: false, paired: false };
  }
}
