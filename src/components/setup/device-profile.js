import os from 'node:os';
import path from 'node:path';

export function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const root = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(root, 'ChatSentinel');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'ChatSentinel');
  const root = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(root, 'ChatSentinel');
}

export function deviceProfile(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const hostname = options.hostname || os.hostname();
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  return Object.freeze({
    deviceId: `${sanitize(hostname)}-${platform}-${arch}`,
    hostname,
    platform,
    arch,
    home,
    dataDir: options.dataDir || env.CHATSENTINEL_DATA_DIR || defaultDataDir(platform, env, home),
    runnerLabels: ['self-hosted', platformLabel(platform), arch.toUpperCase(), 'chatsentinel']
  });
}
function platformLabel(platform) {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function sanitize(value) {
  return String(value || 'device').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
}
