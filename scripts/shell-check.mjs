#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('.');
const scripts = fs.readdirSync(path.join(root, 'scripts'))
  .filter(name => name.endsWith('.sh'))
  .map(name => path.join(root, 'scripts', name));
const bash = findBash();
if (!bash) {
  console.error('ChatSentinel shell check: bash not found');
  process.exit(1);
}
let failures = 0;
for (const file of scripts) {
  const result = spawnSync(bash, ['-n', file], { encoding: 'utf8', windowsHide: true });
  if (result.status === 0) console.log(`SH_PARSE PASS ${path.basename(file)}`);
  else {
    failures += 1;
    console.error(`SH_PARSE FAIL ${path.basename(file)}: ${result.stderr || result.stdout}`);
  }
}
if (failures) process.exit(1);

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
    : ['/bin/bash', '/usr/bin/bash'];
  return candidates.find(file => fs.existsSync(file)) || null;
}
