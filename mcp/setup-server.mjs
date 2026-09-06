#!/usr/bin/env node
import readline from 'node:readline';
import process from 'node:process';
import path from 'node:path';
import { inspectSetup, planSetup, applySetup, planRunner, planMaintenance, applyMaintenance } from '../src/components/setup/controller.js';

const ROOT = path.resolve(process.env.CHATSENTINEL_ROOT || '.');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try { request = JSON.parse(trimmed); }
  catch { return write(errorResponse(null, -32700, 'Parse error')); }
  if (!request || request.jsonrpc !== '2.0') return write(errorResponse(request?.id ?? null, -32600, 'Invalid Request'));
  try {
    const response = await handle(request);
    if (response) write(response);
  } catch (error) {
    write(errorResponse(request.id ?? null, -32000, String(error?.message || error)));
  }
});

async function handle(request) {
  const { method, params = {}, id } = request;
  if (method === 'notifications/initialized') return null;
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params.protocolVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'chatsentinel-setup', version: '1.3.2' }
    });
  }
  if (method === 'tools/list') return ok(id, { tools: toolDefinitions() });
  if (method === 'tools/call') return ok(id, await callTool(params));
  if (method === 'ping') return ok(id, {});
  return errorResponse(id ?? null, -32601, `Method not found: ${method}`);
}
function toolDefinitions() {
  return [
    {
      name: 'setup_status',
      description: 'Inspect ChatSentinel prerequisites, platform, watchdog and extension pairing without changing the device.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'setup_plan',
      description: 'Build a prerequisite and watchdog-service installation plan. This never installs anything.',
      inputSchema: {
        type: 'object',
        properties: {
          includeRecommended: { type: 'boolean' },
          includeWatchdogService: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'setup_apply',
      description: 'Apply only explicitly approved setup step IDs. Defaults to dry-run unless execute=true.',
      inputSchema: {
        type: 'object',
        properties: {
          approvedStepIds: { type: 'array', items: { type: 'string' } },
          execute: { type: 'boolean' },
          includeWatchdogService: { type: 'boolean' }
        },
        required: ['approvedStepIds'],
        additionalProperties: false
      }
    },
    {
      name: 'maintenance_plan',
      description: 'Build a repair or safe ChatSentinel service-uninstall plan. Shared prerequisites are never removed automatically.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['repair', 'uninstall'] } },
        required: ['action'],
        additionalProperties: false
      }
    },
    {
      name: 'maintenance_apply',
      description: 'Apply only explicitly approved maintenance step IDs. Defaults to dry-run unless execute=true.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['repair', 'uninstall'] },
          approvedStepIds: { type: 'array', items: { type: 'string' } },
          execute: { type: 'boolean' }
        },
        required: ['action', 'approvedStepIds'],
        additionalProperties: false
      }
    },
    {
      name: 'runner_plan',
      description: 'Build a GitHub self-hosted runner plan for this device. The plan does not register a runner.',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'GitHub owner/repository' },
          name: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          runnerDir: { type: 'string' }
        },
        required: ['repo'],
        additionalProperties: false
      }
    }
  ];
}

async function callTool(params = {}) {
  const args = params.arguments || {};
  let value;
  if (params.name === 'setup_status') {
    value = await inspectSetup({ root: ROOT });
  } else if (params.name === 'setup_plan') {
    value = await planSetup({
      root: ROOT,
      includeRecommended: args.includeRecommended,
      includeWatchdogService: args.includeWatchdogService
    });
  } else if (params.name === 'setup_apply') {
    const plan = await planSetup({ root: ROOT, includeRecommended: true, includeWatchdogService: args.includeWatchdogService });
    value = await applySetup({
      plan,
      root: ROOT,
      approvedStepIds: args.approvedStepIds || [],
      dryRun: args.execute !== true
    });
  } else if (params.name === 'maintenance_plan') {
    value = await planMaintenance({ root: ROOT, action: args.action });
  } else if (params.name === 'maintenance_apply') {
    const plan = await planMaintenance({ root: ROOT, action: args.action });
    value = await applyMaintenance({ plan, root: ROOT, approvedStepIds: args.approvedStepIds || [], dryRun: args.execute !== true });
  } else if (params.name === 'runner_plan') {
    value = await planRunner({
      root: ROOT,
      repo: args.repo,
      name: args.name,
      labels: args.labels,
      runnerDir: args.runnerDir
    });
  } else {
    return toolError(`Unknown tool: ${params.name || ''}`);
  }
  return toolResult(value);
}
function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: value?.ok === false
  };
}

function toolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, error: message },
    isError: true
  };
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
