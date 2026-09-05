#!/usr/bin/env node
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const runtime = fs.readFileSync('src/runtime-config.js', 'utf8');
const installer = fs.readFileSync('scripts/install-autostart.ps1', 'utf8');
const e2e = fs.readFileSync('scripts/e2e/extension-smoke.js', 'utf8');
const smoke = fs.readFileSync('scripts/production-smoke.mjs', 'utf8');
const mcp = fs.readFileSync('mcp/setup-server.mjs', 'utf8');
const expected = pkg.version;
const checks = [
  ['package-lock root', lock.version],
  ['package-lock package', lock.packages?.['']?.version],
  ['extension manifest', manifest.version],
  ['runtime VERSION', match(runtime, /VERSION\s*=\s*'([^']+)'/)],
  ['Windows installer target', match(installer, /targetVersion\s*=\s*'([^']+)'/)],
  ['browser E2E expected version', match(e2e, /health\.version,\s*'([^']+)'/)],
  ['production smoke expected version', match(smoke, /health\.version,\s*'([^']+)'/)],
  ['Setup MCP server version', match(mcp, /serverInfo:\s*\{ name: 'chatsentinel-setup', version: '([^']+)'/)]
];
let failures = 0;
for (const [name, value] of checks) {
  if (value === expected) console.log(`VERSION PASS ${name}=${value}`);
  else { failures += 1; console.error(`VERSION FAIL ${name}: expected ${expected}, got ${value || 'missing'}`); }
}
if (failures) process.exit(1);
function match(text, pattern) { return text.match(pattern)?.[1] || null; }
