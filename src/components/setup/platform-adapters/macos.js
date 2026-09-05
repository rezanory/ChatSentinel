const FORMULAE = Object.freeze({ node: 'node', git: 'git', gh: 'gh' });

export const macosAdapter = Object.freeze({
  platform: 'darwin',
  packageManagerStep(root) {
    return step('install:homebrew', 'install-package-manager', 'bash', [`${root}/scripts/bootstrap-macos.sh`, '--apply', '--install-homebrew'], { requirement: 'homebrew', requiresElevation: false });
  },
  installStep(requirement) {
    const formula = FORMULAE[requirement];
    if (formula) return step(`install:${requirement}`, 'install-package', 'brew', ['install', formula], { requirement, requiresElevation: false });
    if (requirement === 'chrome') return step('install:chrome', 'install-package', 'brew', ['install', '--cask', 'google-chrome'], { requirement, requiresElevation: false });
    return null;
  },
  updateStep(requirement) {
    const formula = FORMULAE[requirement];
    if (formula) return step(`update:${requirement}`, 'update-package', 'brew', ['upgrade', formula], { requirement, requiresElevation: false });
    if (requirement === 'chrome') return step('update:chrome', 'update-package', 'brew', ['upgrade', '--cask', 'google-chrome'], { requirement, requiresElevation: false });
    return null;
  },
  watchdogServiceSteps(root) {
    return [step('service:watchdog', 'configure-service', 'bash', [
      `${root}/scripts/install-autostart-macos.sh`
    ], { requirement: 'watchdog-service', requiresElevation: false })];
  },
  removeWatchdogServiceSteps(root) {
    return [step('service:watchdog:remove', 'remove-service', 'bash', [
      `${root}/scripts/uninstall-autostart-macos.sh`
    ], { requirement: 'watchdog-service', requiresElevation: false })];
  },
  bootstrapHint() {
    return 'bash scripts/bootstrap-macos.sh';
  }
});

function step(id, kind, command, args, extra = {}) {
  return Object.freeze({ id, kind, command, args, platform: 'darwin', ...extra });
}
