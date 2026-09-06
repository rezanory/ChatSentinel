import path from 'node:path';
import { defaultDataDir } from './components/setup/device-profile.js';

export const VERSION = '1.3.3';

const dataDir = process.env.CHATSENTINEL_DATA_DIR || defaultDataDir();

export const runtimeConfig = Object.freeze({
  version: VERSION,
  host: process.env.CHATSENTINEL_HOST || '127.0.0.1',
  port: intEnv('CHATSENTINEL_PORT', 4317, 1024, 65535),
  dataDir,
  stateFile: path.join(dataDir, 'data', 'state.json'),
  logDir: path.join(dataDir, 'logs'),
  sessionTtlMs: intEnv('CHATSENTINEL_SESSION_TTL_MS', 24 * 60 * 60 * 1000, 60_000, 30 * 24 * 60 * 60 * 1000),
  maxSessions: intEnv('CHATSENTINEL_MAX_SESSIONS', 500, 10, 5000),
  maxBodyBytes: intEnv('CHATSENTINEL_MAX_BODY_BYTES', 64 * 1024, 1024, 1024 * 1024),
  rateLimitPerMinute: intEnv('CHATSENTINEL_RATE_LIMIT_PER_MIN', 600, 60, 10_000),
  testMode: process.env.CHATSENTINEL_TEST_MODE === '1'
});

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}
