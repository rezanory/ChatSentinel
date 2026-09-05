import { buildSetupPlan } from './install-plan.js';
import { windowsAdapter } from './platform-adapters/windows.js';
import { macosAdapter } from './platform-adapters/macos.js';

export function buildMaintenancePlan(report, options = {}) {
  const action = options.action || 'repair';
  const platform = report?.profile?.platform;
  const adapter = options.adapter || adapterFor(platform);
  if (!adapter) return { ok: false, error: `unsupported-platform:${platform || 'unknown'}`, steps: [] };
  const root = options.root || process.cwd();
  if (action === 'repair') {
    const plan = buildSetupPlan(report, {
      adapter,
      root,
      includeRecommended: options.includeRecommended !== false,
      includeWatchdogService: true
    });
    return { ...plan, action: 'repair', notes: ['Re-check prerequisites and reconfigure the ChatSentinel Watchdog service.'] };
  }
  if (action === 'uninstall') {
    return {
      ok: true,
      action: 'uninstall',
      platform,
      steps: adapter.removeWatchdogServiceSteps(root),
      requiresApproval: true,
      notes: [
        'Only ChatSentinel-owned service configuration is removed.',
        'Shared prerequisites such as Node.js, Git, Chrome and GitHub CLI are intentionally retained.'
      ],
      generatedAt: new Date().toISOString()
    };
  }
  return { ok: false, error: `unsupported-maintenance-action:${action}`, steps: [] };
}
function adapterFor(platform) {
  if (platform === 'win32') return windowsAdapter;
  if (platform === 'darwin') return macosAdapter;
  return null;
}
