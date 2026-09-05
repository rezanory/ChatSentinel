import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

function startMcp() {
  const child = spawn(process.execPath, ['mcp/setup-server.mjs'], {
    cwd: path.resolve('.'),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];
  rl.on('line', line => {
    const value = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(value); else queue.push(value);
  });
  const read = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
  const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
  const stop = () => { rl.close(); child.kill(); };
  return { child, read, send, stop };
}

test('setup MCP exposes read/plan/apply/runner tools with approval semantics', async t => {
  const mcp = startMcp();
  t.after(() => mcp.stop());
  mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  let response = await mcp.read();
  assert.equal(response.result.serverInfo.name, 'chatsentinel-setup');
  assert.equal(response.result.serverInfo.version, '1.3.1');
  assert.equal(response.result.protocolVersion, '2025-03-26');

  mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  response = await mcp.read();
  const names = response.result.tools.map(tool => tool.name);
  assert.deepEqual(names, ['setup_status', 'setup_plan', 'setup_apply', 'maintenance_plan', 'maintenance_apply', 'runner_plan']);
  mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'setup_plan', arguments: { includeWatchdogService: true } } });
  response = await mcp.read();
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.ok, true);
  assert.ok(Array.isArray(response.result.structuredContent.steps));

  mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'setup_apply', arguments: { approvedStepIds: [], execute: false } } });
  response = await mcp.read();
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.ok, true);
  assert.ok(response.result.structuredContent.results.every(row => row.status === 'skipped'));

  mcp.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'maintenance_plan', arguments: { action: 'uninstall' } } });
  response = await mcp.read();
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.action, 'uninstall');
  assert.ok(response.result.structuredContent.steps.some(step => step.id === 'service:watchdog:remove'));

  mcp.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'runner_plan', arguments: { repo: 'rezanory/ChatSentinel', labels: ['project-local'] } } });
  response = await mcp.read();
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.repo, 'rezanory/ChatSentinel');
  assert.ok(response.result.structuredContent.labels.includes('project-local'));
});
