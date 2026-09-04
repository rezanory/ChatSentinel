export function startHeartbeat({ url = process.env.CHATSENTINEL_HEARTBEAT_URL, intervalMs = 60000 } = {}) {
  if (!url) return { enabled: false, stop() {} };

  let stopped = false;
  let timer;

  const ping = async () => {
    if (stopped) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: `ChatSentinel alive ${new Date().toISOString()}`,
        signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      process.stderr.write(JSON.stringify({ type: 'heartbeat-error', error: error.message }) + '\n');
    } finally {
      if (!stopped) timer = setTimeout(ping, intervalMs);
    }
  };

  ping();
  return {
    enabled: true,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
