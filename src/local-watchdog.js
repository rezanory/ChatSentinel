import http from 'node:http';
import { decideRecovery } from './recovery-engine.js';

const PORT = Number(process.env.CHATSENTINEL_PORT || 4317);
const HOST = process.env.CHATSENTINEL_HOST || '127.0.0.1';
const sessions = new Map();

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return end(res, 204);

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, service: 'ChatSentinel', sessions: sessions.size });
  }

  if (req.method === 'GET' && req.url === '/sessions') {
    return json(res, 200, { sessions: [...sessions.values()] });
  }

  if (req.method === 'POST' && req.url === '/signal') {
    const signal = await readJson(req);
    const id = signal.conversationId || signal.tabId || 'unknown';
    const previous = sessions.get(id) || {};
    const merged = { ...previous, ...signal, updatedAt: new Date().toISOString() };
    const decision = decideRecovery(merged);
    const record = { ...merged, decision };
    sessions.set(id, record);
    process.stdout.write(JSON.stringify({ type: 'decision', id, decision }) + '\n');
    return json(res, 200, { ok: true, decision });
  }

  return json(res, 404, { ok: false, error: 'not-found' });
});

server.listen(PORT, HOST, () => {
  console.log(`ChatSentinel watchdog listening on http://${HOST}:${PORT}`);
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://chatgpt.com');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function end(res, status) { res.statusCode = status; res.end(); }
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 100_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
