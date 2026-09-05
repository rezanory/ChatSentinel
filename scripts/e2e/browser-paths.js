import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function findBrowserExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const exists = options.exists || defaultExists;
  const readdir = options.readdir || fs.readdir;

  for (const cache of playwrightCacheCandidates(platform, env, home)) {
    const found = await findPlaywrightChromium(cache, platform, { exists, readdir });
    if (found) return found;
  }

  for (const candidate of systemChromeCandidates(platform, env, home)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export function systemChromeCandidates(platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES && path.win32.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env['PROGRAMFILES(X86)'] && path.win32.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      path.posix.join(home, 'Applications', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.posix.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
    ];
  }
  if (platform === 'linux') {
    return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  }
  return [];
}
export function playwrightCacheCandidates(platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
  if (platform === 'darwin') return [path.posix.join(home, 'Library', 'Caches', 'ms-playwright')];
  if (platform === 'linux') return [env.XDG_CACHE_HOME ? path.posix.join(env.XDG_CACHE_HOME, 'ms-playwright') : path.posix.join(home, '.cache', 'ms-playwright')];
  return [];
}

export async function findPlaywrightChromium(base, platform, options = {}) {
  const exists = options.exists || defaultExists;
  const readdir = options.readdir || fs.readdir;
  let entries;
  try { entries = (await readdir(base)).filter(name => name.startsWith('chromium-')).sort().reverse(); }
  catch { return null; }
  for (const entry of entries) {
    for (const relative of playwrightExecutableRelatives(platform)) {
      const join = platform === 'win32' ? path.win32.join : path.posix.join;
      const candidate = join(base, entry, ...relative.split('/'));
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

function playwrightExecutableRelatives(platform) {
  if (platform === 'win32') return ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  if (platform === 'darwin') return [
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium'
  ];
  if (platform === 'linux') return ['chrome-linux64/chrome', 'chrome-linux/chrome'];
  return [];
}

async function defaultExists(file) {
  try { await fs.access(file); return true; }
  catch { return false; }
}
