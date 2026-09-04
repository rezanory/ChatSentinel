import http from 'node:http';
import { decideRecovery } from './recovery-engine.js';
import { reconcileProject } from './project-reconciler.js';
import { startHeartbeat } from './heartbeat.js';

const PORT = Number(process.env.CHATSENTINEL_PORT || 4317);
const HOST = process.env.CHATSENTINEL_HOST || '127.0.0.1';
const sessions = new Map();
const projects = new Map();
const heartbeat = startHeartbeat();

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return end(res, 204);

    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'ChatSentinel',
        sessions: sessions.size,
        projects: projects.size,
        heartbeat: heartbeat.enabled
      });
    }

    if (req.method === 'GET' && req.url === '/sessions') {
      return json(res, 200, { sessions: [...sessions.values()] });
    }

    if (req.method === 'GET' && req.url === '/supervisor') {
      const rows = [...sessions.entries()].map(([id, row]) => ({
        id,
        state: row.state,
        decision: row.decision,
        updatedAt: row.updatedAt,
        progressAgeMs: row.progressAgeMs,
        projectPath: row.projectPath,
        branch: row.reconciliation?.branch,
        head: row.reconciliation?.head
      }));
      return json(res, 200, { count: rows.length, sessions: rows });
    }

    if (req.method === 'POST' && req.url === '/project/register') {
      const body = await readJson(req);
      if (!body.conversationId || !body.projectPath) {
        return json(res, 400, { ok: false, error: 'conversationId-and-projectPath-required' });
      }
      projects.set(body.conversationId, body.projectPath);
      const reconciliation = await reconcileProject(body.projectPath);
      return json(res, reconciliation.ok ? 200 : 422, { ok: reconciliation.ok, reconciliation });
    }

    if (req.method === 'POST' && req.url === '/project/reconcile') {
      const body = await readJson(req);
      const projectPath = body.projectPath || projects.get(body.conversationId);
      const reconciliation = await reconcileProject(projectPath);
      return json(res, reconciliation.ok ? 200 : 422, { ok: reconciliation.ok, reconciliation });
    }

    if (req.method === 'POST' && req.url === '/signal') {
      const signal = await readJson(req);
      const id = signal.conversationId || signal.tabId || 'unknown';
      const previous = sessions.get(id) || {};
      const projectPath = projects.get(id);
      const reconciliation = projectPath ? await reconcileProject(projectPath) : null;

      const merged = {
        ...previous,
        ...signal,
        projectPath,
        reconciliation,
        checkpointFresh: signal.checkpointFresh || Boolean(reconciliation?.ok && reconciliation.remoteHead),
        sideEffectRisk: classifySideEffectRisk(signal, reconciliation),
        updatedAt: new Date().toISOString()
      };

      const decision = decideRecovery(merged);
      const record = { ...merged, decision };
      sessions.set(id, record);
      process.stdout.write(JSON.stringify({ type: 'decision', id, decision }) + '\n');
      return json(res, 200, { ok: true, decision, reconciliation, projectPath });
    }

    return json(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    process.stderr.write(JSON.stringify({ type: 'request-error', error: error.message }) + '\n');
    return json(res, 500, { ok: false, error: 'internal-error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ChatSentinel watchdog listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    heartbeat.stop();
    server.close(() => process.exit(0));
  });
}

function classifySideEffectRisk(signal, reconciliation) {
  if (signal.sideEffectRisk && signal.sideEffectRisk !== 'unknown') return signal.sideEffectRisk;
  if (signal.state === 'RUNNING') return 'possible';
  if (!reconciliation?.ok) return 'unknown';
  if (!reconciliation.clean || reconciliation.aheadOrDiverged) return 'possible';
  return 'unknown';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://chatgpt.com');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
function end(res, status) {
  res.statusCode = status;
  res.end();
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if ((body += chunk).length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
