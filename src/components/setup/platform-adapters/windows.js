const PACKAGE_IDS = Object.freeze({
  node: 'OpenJS.NodeJS.LTS',
  git: 'Git.Git',
  chrome: 'Google.Chrome',
  gh: 'GitHub.cli'
});

export const windowsAdapter = Object.freeze({
  platform: 'win32',
  packageManagerStep() {
    return Object.freeze({ id: 'manual:winget', kind: 'manual-prerequisite', platform: 'win32', manual: true, instruction: 'Install Microsoft App Installer / winget, then refresh the ChatSentinel setup plan.' });
  },
  installStep(requirement) {
    const packageId = PACKAGE_IDS[requirement];
    if (!packageId) return null;
    return step(`install:${requirement}`, 'install-package', 'winget', [
      'install', '--id', packageId, '--exact', '--accept-source-agreements', '--accept-package-agreements'
    ], { requirement, requiresElevation: false });
  },
  updateStep(requirement) {
    const packageId = PACKAGE_IDS[requirement];
    if (!packageId) return null;
    return step(`update:${requirement}`, 'update-package', 'winget', [
      'upgrade', '--id', packageId, '--exact', '--accept-source-agreements', '--accept-package-agreements'
    ], { requirement, requiresElevation: false });
  },
  watchdogServiceSteps(root) {
    return [step('service:watchdog', 'configure-service', 'powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${root}\\scripts\\install-autostart.ps1`
    ], { requirement: 'watchdog-service', requiresElevation: false })];
  },
  removeWatchdogServiceSteps(root) {
    return [step('service:watchdog:remove', 'remove-service', 'powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${root}\\scripts\\uninstall-autostart.ps1`
    ], { requirement: 'watchdog-service', requiresElevation: false })];
  },
  bootstrapHint() {
    return 'powershell -ExecutionPolicy Bypass -File scripts\\bootstrap-windows.ps1';
  }
});

function step(id, kind, command, args, extra = {}) {
  return Object.freeze({ id, kind, command, args, platform: 'win32', ...extra });
}
