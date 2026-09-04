import fs from 'node:fs/promises';
import path from 'node:path';

export function createLogger({ dir, maxBytes = 5 * 1024 * 1024, keep = 3 } = {}) {
  const file = path.join(dir, 'watchdog.jsonl');
  let queue = Promise.resolve();

  function log(level, event, fields = {}) {
    const record = {
      ts: new Date().toISOString(),
      level,
      event,
      pid: process.pid,
      ...sanitize(fields)
    };
    const line = `${JSON.stringify(record)}\n`;
    queue = queue
      .then(async () => {
        await fs.mkdir(dir, { recursive: true });
        await rotateIfNeeded(file, Buffer.byteLength(line), maxBytes, keep);
        await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
      })
      .catch(error => {
        process.stderr.write(`${JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'log-write-failed',
          error: error.message
        })}\n`);
      });
    return queue;
  }

  return {
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
    flush: () => queue,
    file
  };
}

async function rotateIfNeeded(file, incomingBytes, maxBytes, keep) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.size + incomingBytes <= maxBytes) return;
  for (let i = keep - 1; i >= 1; i -= 1) {
    const src = `${file}.${i}`;
    const dst = `${file}.${i + 1}`;
    await fs.rename(src, dst).catch(() => {});
  }
  await fs.rename(file, `${file}.1`).catch(() => {});
}

function sanitize(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const copy = { ...fields };
  for (const key of ['prompt', 'body', 'authorization', 'token', 'apiToken']) {
    if (key in copy) copy[key] = '[redacted]';
  }
  if (typeof copy.error === 'object' && copy.error) {
    copy.error = copy.error.message || String(copy.error);
  }
  return copy;
}
