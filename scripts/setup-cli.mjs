#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { inspectSetup, planSetup, applySetup, planRunner, planMaintenance, applyMaintenance } from '../src/components/setup/controller.js';

const args = process.argv.slice(2);
const command = args.shift() || 'inspect';
const flags = parseArgs(args);
const root = path.resolve(flags.root || '.');

try {
  if (command === 'inspect') {
    print(await inspectSetup({ root }));
  } else if (command === 'plan') {
    print(await planSetup({
      root,
      includeRecommended: flags.recommended !== 'false',
      includeWatchdogService: Boolean(flags.service)
    }));
  } else if (command === 'apply') {
    const plan = await planSetup({ root, includeRecommended: true, includeWatchdogService: Boolean(flags.service) });
    const approvedStepIds = String(flags.approve || '').split(',').map(value => value.trim()).filter(Boolean);
    const result = await applySetup({ plan, root, approvedStepIds, dryRun: !flags.execute });
    print(result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'repair-plan' || command === 'uninstall-plan') {
    const action = command === 'repair-plan' ? 'repair' : 'uninstall';
    print(await planMaintenance({ root, action, includeRecommended: flags.recommended !== 'false' }));
  } else if (command === 'maintenance-apply') {
    const action = flags.action === 'uninstall' ? 'uninstall' : 'repair';
    const plan = await planMaintenance({ root, action, includeRecommended: true });
    const approvedStepIds = String(flags.approve || '').split(',').map(value => value.trim()).filter(Boolean);
    const result = await applyMaintenance({ plan, root, approvedStepIds, dryRun: !flags.execute });
    print(result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'runner-plan') {
    if (!flags.repo) throw new Error('--repo owner/repo is required');
    print(await planRunner({ root, repo: flags.repo, name: flags.name, labels: splitCsv(flags.labels) }));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
}
function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function splitCsv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
