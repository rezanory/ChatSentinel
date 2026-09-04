import { createWatchdogServer } from './server.js';
import { runtimeConfig } from './runtime-config.js';

const app = await createWatchdogServer(runtimeConfig);

app.server.on('clientError', (error, socket) => {
  app.logger.warn('client-error', { error });
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

app.server.on('error', error => {
  app.logger.error('server-error', { error });
  process.stderr.write(`${JSON.stringify({ type: 'server-error', error: error.message })}\n`);
});

app.server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  const event = {
    type: 'watchdog-listening',
    host: runtimeConfig.host,
    port: runtimeConfig.port,
    version: runtimeConfig.version,
    pid: process.pid
  };
  app.logger.info('watchdog-started', event);
  process.stdout.write(`${JSON.stringify(event)}\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info('watchdog-stopping', { signal });
  const forced = setTimeout(() => process.exit(1), 5000);
  forced.unref?.();
  await app.close();
  clearTimeout(forced);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal).catch(() => process.exit(1)));
}

process.on('uncaughtException', error => {
  app.logger.error('uncaught-exception', { error });
  process.stderr.write(`${JSON.stringify({ type: 'uncaught-exception', error: error.message })}\n`);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', reason => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  app.logger.error('unhandled-rejection', { error });
  process.stderr.write(`${JSON.stringify({ type: 'unhandled-rejection', error: error.message })}\n`);
});
