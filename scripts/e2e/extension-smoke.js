import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { findBrowserExecutable, isExtensionWorkerTarget } from './browser-paths.js';

const ROOT = path.resolve('.');
const execFileAsync = promisify(execFile);
const TEST_PORT = Number(process.env.CHATSENTINEL_E2E_WATCHDOG_PORT || process.env.CHATSENTINEL_E2E_PORT || await freePort());
const FIXTURE_PORT = Number(process.env.CHATSENTINEL_E2E_FIXTURE_PORT || await freePort(new Set([TEST_PORT])));
const EXPECTED_EXTENSION_ID = 'pcidbmcahljjpbmaecjmfmpbpfnpoepc';
const E2E_WAIT_MS = Math.max(10000, Number(process.env.CHATSENTINEL_E2E_WAIT_MS || 90000));
const WATCHDOG = `http://127.0.0.1:${TEST_PORT}`;
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const CHROME = process.env.CHROME_BIN || await findBrowserExecutable();
if (!CHROME) throw new Error('Chrome/Chromium executable not found; install Chrome or set CHROME_BIN');
const sourceExtension = path.join(ROOT, 'extension');
const extension = path.join(os.tmpdir(), `chatsentinel-e2e-extension-${process.pid}`);
const RUN = `e2e-${process.pid}-${Date.now()}`;
const profile = path.join(os.tmpdir(), `chatsentinel-e2e-profile-${process.pid}`);
const testData = path.join(os.tmpdir(), `chatsentinel-e2e-data-${process.pid}`);
await prepareTestExtension(sourceExtension, extension);
const cleanProject = await prepareCleanProject(testData);
const fixture = spawn(process.execPath, ['scripts/e2e/fault-fixture-server.js'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, CHATSENTINEL_FIXTURE_PORT: String(FIXTURE_PORT) }
});
const watchdog = spawn(process.execPath, ['src/local-watchdog.js'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    CHATSENTINEL_PORT: String(TEST_PORT),
    CHATSENTINEL_DATA_DIR: testData,
    CHATSENTINEL_TEST_MODE: '1'
  }
});
let chrome;
let DEVTOOLS;
let EXTENSION_WORKER;

try {
  await waitUrl(`${FIXTURE}/idle`);
  const health = await waitJson(`${WATCHDOG}/health`);
  assert.equal(health.version, '1.3.2', 'v1.3.2 watchdog must be running');

  chrome = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    fixtureUrl('idle')
  ], { stdio: 'ignore' });

  const debugPort = await waitDevToolsPort(profile);
  DEVTOOLS = `http://127.0.0.1:${debugPort}`;
  await waitJson(`${DEVTOOLS}/json/version`);
  EXTENSION_WORKER = await waitTarget(isChatSentinelWorkerTarget);
  assert.ok(EXTENSION_WORKER.url.startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`), `unexpected extension id: ${EXTENSION_WORKER.url}`);
  await sleep(500);
  await launchGuardSuite();
  await crashedTabRecoverySuite();
  await detectorSuite();
  await actuatorSuite();
  await conversationWindowSuite();
  await projectConsoleSuite();
  await commandManagerSuite();
  console.log('ChatSentinel browser E2E: PASS');
} finally {
  chrome?.kill();
  fixture.kill();
  watchdog.kill();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await fs.rm(testData, { recursive: true, force: true }).catch(() => {});
  await fs.rm(extension, { recursive: true, force: true }).catch(() => {});
}

async function launchGuardSuite() {
  const guardReady = await waitWorkerCondition("typeof globalThis.ChatSentinelTabLaunchGuard === 'object'");
  if (!guardReady) {
    const debug = await workerValue(`({href:globalThis.location?.href,guard:typeof globalThis.ChatSentinelTabLaunchGuard,command:typeof globalThis.ChatSentinelCommandManager,snapshot:typeof globalThis.ChatSentinelSessionSnapshots,restore:typeof globalThis.ChatSentinelSessionRestore})`).catch(error => ({ error: String(error) }));
    console.error('tab launch guard worker debug:', JSON.stringify(debug));
  }
  assert.equal(guardReady, true, 'tab launch guard did not initialize in service worker');
  const sanitized = await workerValue(`globalThis.ChatSentinelTabLaunchGuard.safeNewChatUrl('https://chatgpt.com/?prompt-textarea=SECRET&foo=bar')`);
  assert.ok(!/prompt-textarea|SECRET/.test(sanitized), `unsafe launch URL: ${sanitized}`);

  await openPage(fixtureUrl('too-many-requests'));
  const tab = await waitWorkerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('/too-many-requests'));return t?{id:t.id,url:t.url}:null})()", value => Boolean(value?.id));
  assert.ok(tab?.id, 'rate-limit fixture tab not found');
  await waitContentReady(tab.id);
  const dismissed = await waitWorkerValue(`chrome.scripting.executeScript({target:{tabId:${tab.id}},func:()=>document.body?.dataset?.rateLimitDismissed==='1'}).then(r=>r?.[0]?.result).catch(()=>false)`, Boolean);
  assert.equal(dismissed, true, 'Too many requests modal Got it button was not auto-clicked');
  const adaptive = await waitWorkerValue(`chrome.storage.local.get(globalThis.ChatSentinelRequestRateLimit.STATE_KEY).then(r=>r[globalThis.ChatSentinelRequestRateLimit.STATE_KEY]||null)`, value => Number(value?.level || 0) >= 1);
  assert.ok(Number(adaptive?.level || 0) >= 1, 'adaptive request pacing was not activated');
  const gate = await workerValue(`globalThis.ChatSentinelRequestRateLimit.gate(chrome.storage.local)`);
  assert.equal(gate?.allowed, false, 'adaptive rate gate must cool down request-making commands');
  await workerValue(`chrome.tabs.remove(${tab.id}).catch(()=>{}); chrome.storage.local.remove([globalThis.ChatSentinelRequestRateLimit.STATE_KEY,globalThis.ChatSentinelRequestRateLimit.LAST_REQUEST_KEY]).then(()=>true)`);
  const resetGate = await workerValue(`globalThis.ChatSentinelRequestRateLimit.gate(chrome.storage.local)`);
  assert.equal(resetGate?.allowed, true, 'rate-limit fixture state must not leak into later E2E suites');
  console.log('tab launch guard sanitization + Too many requests auto-dismiss + adaptive pacing: PASS');
}

async function crashedTabRecoverySuite() {
  const projectId = `project:${RUN}:crash-recovery`;
  await postJson('/projects/upsert', {
    projectId,
    name: 'Crash Recovery Project',
    projectPath: cleanProject,
    operationClass: 'write',
    autoRecovery: true,
    groupTabs: false,
    color: 'orange'
  });

  const page = await openPage(fixtureUrl('noidentity', { crashseed: '1' }));
  const tab = await waitWorkerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('crashseed=1'));return t?{id:t.id,url:t.url,title:t.title}:null})()", value => Boolean(value?.id));
  assert.ok(tab?.id, 'crash recovery seed tab not found');
  await waitContentReady(tab.id);
  await postJson('/projects/attach', {
    projectId,
    conversationId: `tab:${tab.id}`,
    tabId: tab.id,
    title: 'Crash Lane',
    url: tab.url,
    laneId: 'CRASH',
    laneName: 'Crash Recovery Lane',
    branch: 'feat/crash-recovery',
    role: 'implementation'
  });

  const crashOne = fixtureUrl('browser-crash', { cid: `${RUN}-browser-crash-1` });
  await workerValue(`chrome.tabs.update(${tab.id},{url:${JSON.stringify(crashOne)}})`);
  const recovered = await waitWorkerValue(`chrome.tabs.get(${tab.id}).then(t=>({id:t.id,url:t.url,title:t.title})).catch(()=>null)`, value => Boolean(value?.url?.includes('command=lane')));
  assert.equal(recovered?.id, tab.id, 'first crash should recover in the same tab');
  const recoveredTarget = await waitTarget(row => row.type === 'page' && row.url.includes('command=lane'));
  await waitEval(recoveredTarget, "String(document.body.dataset.sent||'').includes('browser tab crashed')");
  console.log('browser crash reload + continue: PASS');

  const crashTwo = fixtureUrl('browser-crash', { cid: `${RUN}-browser-crash-2` });
  await workerValue(`chrome.tabs.update(${tab.id},{url:${JSON.stringify(crashTwo)}})`);
  const replacementChat = await waitProjectLaneTab(projectId, 'CRASH', row => Number(row.tabId) !== Number(tab.id));
  assert.ok(replacementChat?.tabId, 'second crash did not replace the tab');
  const oldGone = await waitWorkerCondition(`chrome.tabs.get(${tab.id}).then(()=>false).catch(()=>true)`);
  assert.equal(oldGone, true, 'old crashed tab remained after replacement');
  const replacementTab = await workerValue(`chrome.tabs.get(${replacementChat.tabId}).then(t=>({id:t.id,url:t.url,title:t.title})).catch(()=>null)`);
  assert.ok(replacementTab?.url?.includes('command=lane'));
  const replacementTarget = await waitTarget(row => row.type === 'page' && row.url.includes('command=lane'));
  await waitEval(replacementTarget, "String(document.body.dataset.sent||'').includes('browser tab crashed')");
  console.log('browser crash replace + restore + continue: PASS');

  const crashThree = fixtureUrl('browser-crash', { cid: `${RUN}-browser-crash-3` });
  await workerValue(`chrome.tabs.update(${replacementChat.tabId},{url:${JSON.stringify(crashThree)}})`);
  await sleep(1500);
  const afterThird = await waitProjectLaneTab(projectId, 'CRASH', () => true);
  assert.equal(Number(afterThird.tabId), Number(replacementChat.tabId), 'third crash should halt instead of opening another tab');
  console.log('browser crash bounded recovery halt: PASS');
}

async function detectorSuite() {
  await verifyDecision('running', 'WAIT');
  await verifyDecision('retry', 'ESCALATE');
  await verifyDecision('delivery-timeout', 'RETRY_MESSAGE_DELIVERY');
  await verifyDecision('delivery-timeout-red', 'RETRY_MESSAGE_DELIVERY');
  await verifyDecision('delivery-timeout-history', 'WAIT');
  await verifyDecision('interrupt', 'CONTINUE_SAME_CHAT');
  await verifyDecision('interrupt-history', 'WAIT');
  await verifyDecision('dead', 'CONTINUE_NEW_CHAT');
  await verifyDecision('frozen', 'RELOAD_AND_RECHECK');
  await verifyDecision('rootidentity', 'WAIT');
  await verifyTabFallback();
  console.log('detector/recovery + identity E2E: 11/11 PASS');
}

async function actuatorSuite() {
  const deliveryTarget = await openPage(fixtureUrl('delivery-timeout', {
    auto: '1', cid: `${RUN}-delivery-timeout-auto`
  }));
  await waitEval(deliveryTarget, "document.body.dataset.deliveryRetryClicked === '1'");
  await sleep(1200);
  const deliveryRetryCount = await evalValue(deliveryTarget, 'Number(document.body.dataset.deliveryRetryCount || 0)');
  assert.equal(deliveryRetryCount, 1, 'delivery retry must be incident-deduplicated during cooldown');
  console.log('message delivery timeout native Retry actuator: PASS');

  const redDeliveryTarget = await openPage(fixtureUrl('delivery-timeout-red', {
    auto: '1', cid: `${RUN}-delivery-timeout-red-auto`
  }));
  await waitEval(redDeliveryTarget, "document.body.dataset.deliveryRedRetryClicked === '1'");
  await sleep(1200);
  const redDeliveryRetryCount = await evalValue(redDeliveryTarget, 'Number(document.body.dataset.deliveryRedRetryCount || 0)');
  assert.equal(redDeliveryRetryCount, 1, 'red composer delivery retry must be incident-deduplicated during cooldown');
  console.log('red composer timeout sibling Retry actuator: PASS');

  await postJson('/conversation/register', {
    conversationId: `${RUN}-retry-auto`,
    operationClass: 'read_only'
  });
  const retryTarget = await openPage(fixtureUrl('retry', {
    auto: '1', cid: `${RUN}-retry-auto`
  }));
  await waitEval(retryTarget, "document.body.dataset.retryClicked === '1'");
  console.log('SAFE_RETRY actuator: PASS');

  const cycleId = `${RUN}-retry-cycle`;
  await postJson('/conversation/register', { conversationId: cycleId, operationClass: 'read_only' });
  let cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  await openPage(fixtureUrl('idle', { auto: '1', cid: cycleId }));
  await sleep(600);
  cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  console.log('SAFE_RETRY incident counter reset: PASS');

  await postJson('/conversation/register', {
    conversationId: `${RUN}-interrupt-auto`,
    projectPath: cleanProject,
    operationClass: 'write'
  });
  const continueTarget = await openPage(fixtureUrl('interrupt', {
    auto: '1', cid: `${RUN}-interrupt-auto`
  }));
  await waitEval(continueTarget, "Boolean(document.body.dataset.sent)");
  const sent = await evalValue(continueTarget, 'document.body.dataset.sent');
  assert.match(sent, /previous response was interrupted/i);
  assert.match(sent, /complete remaining answer/i);
  assert.match(sent, /reconcile the current durable state/i);
  await sleep(1200);
  const sendCount = await evalValue(continueTarget, 'Number(document.body.dataset.sendCount || 0)');
  assert.equal(sendCount, 1, 'one interruption incident must not emit duplicate continuation prompts');
  console.log('CONTINUE_SAME_CHAT complete-answer actuator: PASS');

  const deadId = `${RUN}-dead-auto`;
  const deadTarget = await openPage(fixtureUrl('dead', { auto: '1', cid: deadId }));
  await waitEval(deadTarget, "location.pathname === '/newchat' && Boolean(document.body.dataset.sent)");
  const handoff = await evalValue(deadTarget, 'document.body.dataset.sent');
  assert.match(handoff, /checkpoint|source-of-truth/i);
  console.log('CONTINUE_NEW_CHAT + handoff actuator: PASS');
}

async function conversationWindowSuite() {
  const page = await openPage(fixtureUrl('idle', { window: 'trim' }));
  const result = await evalValue(page, `(async()=>{
    const response=await fetch('/backend-api/conversation/window-test');
    const json=await response.json();
    const visible=Object.values(json.mapping||{}).filter(node=>['user','assistant'].includes(node?.message?.author?.role)).length;
    return {nodes:Object.keys(json.mapping||{}).length,visible,current:json.current_node,root:json.root};
  })()`);
  assert.equal(result.visible, 40);
  assert.equal(result.current, 'n100');
  assert.equal(result.root, 'root');
  assert.ok(result.nodes <= 41);
  await waitEval(page, "Number(document.documentElement.dataset.chatsentinelWindowRemovedTurns) === 60");
  console.log('conversation render-window compaction: PASS');

  const tab = await workerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('window=trim'));return t?{id:t.id}:null})()");
  assert.ok(tab?.id);
  const configured = await workerValue(`chrome.tabs.sendMessage(${tab.id},{type:'CHATSENTINEL_CONVERSATION_WINDOW_SET',config:{enabled:true,keepTurns:12}}).catch(()=>null)`);
  assert.equal(configured?.ok, true);
  const second = await evalValue(page, `(async()=>{const r=await fetch('/backend-api/conversation/window-test-2');const j=await r.json();return Object.values(j.mapping||{}).filter(n=>['user','assistant'].includes(n?.message?.author?.role)).length})()`);
  assert.equal(second, 12);
  console.log('conversation render-window runtime configuration: PASS');
}

async function projectConsoleSuite() {
  const pageA = await openPage(fixtureUrl('noidentity', { console: 'a' }));
  const tabA = await waitWorkerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('console=a'));return t?{id:t.id,url:t.url,title:t.title}:null})()", value => Boolean(value?.id));
  assert.ok(tabA?.id, 'console tab A not found');
  await waitContentReady(tabA.id);
  await waitEval(pageA, "document.documentElement.dataset.chatsentinelConsoleReady === '1'");
  let toggle = await workerValue(`chrome.tabs.sendMessage(${tabA.id},{type:'CHATSENTINEL_TOGGLE_PANEL'}).catch(e=>({ok:false,error:String(e)}))`);
  if (toggle?.ok && toggle.open !== true) {
    toggle = await workerValue(`chrome.tabs.sendMessage(${tabA.id},{type:'CHATSENTINEL_TOGGLE_PANEL'}).catch(e=>({ok:false,error:String(e)}))`);
  }
  assert.equal(toggle?.ok, true, `panel toggle failed: ${JSON.stringify(toggle)}`);
  assert.equal(toggle?.open, true, `panel did not become open: ${JSON.stringify(toggle)}`);
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host')?.style.display === 'block'");
  await waitEval(pageA, "Boolean(document.getElementById('chatsentinel-project-console-host')?.shadowRoot?.getElementById('newProject'))");
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host')?.shadowRoot?.getElementById('footerVersion')?.textContent.includes('v1.3.2')");
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host')?.shadowRoot?.getElementById('setupCard')?.textContent.includes('Environment Setup')");
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host')?.shadowRoot?.getElementById('bootstrapCommand')?.value.includes('bootstrap-')");
  assert.ok(await evalValue(pageA, "Boolean(document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('openSetupAssistant'))"));
  console.log('cross-platform Setup Assistant status: PASS');
  const setupOpened = await workerValue("chrome.runtime.openOptionsPage().then(()=>({ok:true})).catch(error=>({ok:false,error:String(error)}))");
  assert.equal(setupOpened?.ok, true, `Setup Assistant open failed: ${JSON.stringify(setupOpened)}`);
  const setupTarget = await waitTarget(row => row.type === 'page' && row.url.includes('/setup.html'));
  await waitEval(setupTarget, "document.getElementById('version')?.textContent.includes('v1.3.2')");
  await waitEval(setupTarget, "document.getElementById('prerequisites')?.textContent.includes('Node.js')");
  const setupTab = await workerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('/setup.html'));return t?{id:t.id}:null})()");
  if (setupTab?.id) await workerValue(`chrome.tabs.remove(${setupTab.id}).then(()=>true).catch(()=>false)`);
  console.log('Setup Assistant extension page: PASS');
  const projectPath = cleanProject;
  const fullModeProjectPath = path.join(cleanProject, 'full-mode-e2e');
  await fs.mkdir(fullModeProjectPath, { recursive: true });
  await evalValue(pageA, `(()=>{const s=document.getElementById('chatsentinel-project-console-host').shadowRoot;s.getElementById('newProject').click();s.getElementById('pName').value='Full Mode E2E';s.getElementById('pPath').value=${JSON.stringify(fullModeProjectPath)};s.getElementById('pPolicy').value='read_only';s.getElementById('pColor').value='cyan';const c=document.querySelector('#prompt-textarea');c.value='Build feature X';c.dispatchEvent(new Event('input',{bubbles:true}));s.getElementById('insertFullProjectMode').click();return true})()`);
  await waitEval(pageA, "(()=>{const text=document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('fullProjectModeStatus').textContent;return Boolean(text)&&!text.startsWith('Activating')})()");
  const fullModeStatus = await evalValue(pageA, "document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('fullProjectModeStatus').textContent");
  assert.match(fullModeStatus, /Active/, `Full Project Mode activation status: ${fullModeStatus}`);
  await waitEval(pageA, "document.querySelector('#prompt-textarea').value.startsWith('CHATSENTINEL FULL PROJECT MODE') && document.querySelector('#prompt-textarea').value.includes('Build feature X')");
  assert.equal(await evalValue(pageA, 'Number(document.body.dataset.sendCount || 0)'), 0, 'Full Project Mode activation must not auto-send');

  const fullProjects = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
  const fullProject = fullProjects.projects.find(project => project.name === 'Full Mode E2E');
  assert.ok(fullProject?.projectId, 'Full Project Mode did not create a project from the editor path');
  assert.equal(fullProject.autoRecovery, true);
  assert.equal(fullProject.groupTabs, true);
  assert.equal(fullProject.capabilityProfile?.profileId, 'full');
  assert.equal(fullProject.capabilityProfile?.sessionSnapshots, true);
  assert.equal(fullProject.capabilityProfile?.conversationDomCompaction, true);
  assert.equal(fullProject.capabilityProfile?.searchExportImport, true);
  assert.equal(fullProject.capabilityProfile?.runnerOnDemand, true);
  assert.equal(fullProject.fullProjectMode?.active, true);
  assert.equal(fullProject.fullProjectMode?.orchestrationActivation?.configure?.route, '/orchestrator/configure');
  assert.equal(fullProject.fullProjectMode?.orchestrationActivation?.configure?.client, 'local-process');
  assert.equal(fullProject.fullProjectMode?.orchestrationActivation?.laneCommand, 'CREATE_LANE_CHAT');
  assert.ok(fullProject.chats.some(chat => Number(chat.tabId) === Number(tabA.id)), 'current chat was not attached by Full Project Mode');

  const fullGroups = await waitWorkerValue("chrome.tabGroups.query({title:'Full Mode E2E'})", value => Array.isArray(value) && value.some(group => group.color === 'cyan'));
  assert.ok(fullGroups.some(group => group.color === 'cyan'), 'Full Project Mode did not group the attached chat');
  const snapshots = await waitWorkerValue(`sessionRestoreController.listSnapshots(${JSON.stringify(fullProject.projectId)})`, value => Array.isArray(value) && value.length > 0);
  assert.ok(snapshots.length > 0, 'Full Project Mode did not capture an activation snapshot');

  await evalValue(pageA, "document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('insertFullProjectMode').click()");
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('fullProjectModeStatus').textContent.includes('Active')");
  assert.equal(await evalValue(pageA, "document.querySelector('#prompt-textarea').value.split('CHATSENTINEL FULL PROJECT MODE').length - 1"), 1, 'Full Project Mode prepend must remain idempotent');
  const fullProjectsAfter = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
  assert.equal(fullProjectsAfter.projects.filter(project => project.projectId === fullProject.projectId).length, 1, 'Full Project Mode must not create duplicate project authorities');
  console.log('Full Project Mode real create/attach/profile/group/snapshot activation: PASS');
  console.log('in-page project console: PASS');

  await evalValue(pageA, `(()=>{const s=document.getElementById('chatsentinel-project-console-host').shadowRoot;s.getElementById('newProject').click();s.getElementById('pName').value='E2E Project';s.getElementById('pPath').value=${JSON.stringify(projectPath)};s.getElementById('pPolicy').value='read_only';s.getElementById('pAuto').checked=true;s.getElementById('pGroup').checked=true;s.getElementById('pColor').value='purple';s.getElementById('saveProject').click();return true})()`);
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('projectList').textContent.includes('E2E Project')");
  let projects = await fetch(`${WATCHDOG}/projects`).then(r=>r.json());
  const project = projects.projects.find(p=>p.name==='E2E Project');
  assert.ok(project?.projectId, 'project was not created from in-page UI');
  console.log('in-page project settings/create: PASS');

  await evalValue(pageA, `(()=>{const s=document.getElementById('chatsentinel-project-console-host').shadowRoot;s.getElementById('attachChat').click();return true})()`);
  await waitProjectChatCount(project.projectId, 1);
  projects = await fetch(`${WATCHDOG}/projects`).then(r=>r.json());
  let current = projects.projects.find(p=>p.projectId===project.projectId);
  assert.ok(current.chats.some(c=>c.tabId===tabA.id));
  console.log('attach current chat from in-page console: PASS');

  await openPage(fixtureUrl('noidentity', { console: 'b' }));
  const tabB = await waitWorkerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('console=b'));return t?{id:t.id,url:t.url,title:t.title}:null})()", value => Boolean(value?.id));
  assert.ok(tabB?.id, 'console tab B not found');
  await postJson('/projects/attach',{projectId:project.projectId,conversationId:`tab:${tabB.id}`,tabId:tabB.id,title:'E2E lane B',url:tabB.url});
  current = await waitProjectChatCount(project.projectId, 2);
  assert.equal(current.chats.length, 2);

  const grouped = await workerValue(`groupProjectTabs(${JSON.stringify(current)})`);
  assert.equal(grouped.ok, true);
  const groups = await workerValue("chrome.tabGroups.query({title:'E2E Project'})");
  assert.ok(groups.some(g=>g.title==='E2E Project'&&g.color==='purple'));
  const group = groups.find(g=>g.title==='E2E Project');
  const tabRows = await workerValue(`chrome.tabs.query({groupId:${group.id}})`);
  assert.ok(tabRows.some(t=>t.id===tabA.id)&&tabRows.some(t=>t.id===tabB.id));
  console.log('parallel project Chrome Tab Group: PASS');

  const focused = await workerValue(`focusTab(${tabB.id})`);
  assert.equal(focused.ok, true);
  const active = await workerValue("chrome.tabs.query({active:true,currentWindow:true})");
  assert.equal(active[0]?.id, tabB.id);
  console.log('project chat focus/open: PASS');

  await openPage(fixtureUrl('noidentity', { console: 'completed' }));
  const tabC = await waitWorkerValue("(async()=>{const tabs=await chrome.tabs.query({});const t=tabs.find(x=>x.url?.includes('console=completed'));return t?{id:t.id,url:t.url,title:t.title}:null})()", value => Boolean(value?.id));
  const completedId = `WEB:${RUN}-completed`;
  await postJson('/projects/attach', { projectId: project.projectId, conversationId: completedId, tabId: tabC.id, title: 'E2E completed chat', url: tabC.url });
  await postJson('/signal', { conversationId: completedId, tabId: tabC.id, state: 'COMPLETE', checkpointFresh: true });
  await workerValue(`chrome.tabs.sendMessage(${tabA.id},{type:'CHATSENTINEL_TOGGLE_PANEL'})`);
  await workerValue(`chrome.tabs.sendMessage(${tabA.id},{type:'CHATSENTINEL_TOGGLE_PANEL'})`);
  await waitEval(pageA, "[...document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('projectList').querySelectorAll('button')].some(button => button.textContent.includes('E2E Project') && button.textContent.trim().endsWith('2'))");
  await waitEval(pageA, "!document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('chatList').textContent.includes('E2E completed chat')");
  await waitEval(pageA, "document.getElementById('chatsentinel-project-console-host').shadowRoot.getElementById('chatGroup').textContent.includes('1 inactive / stale registered chat hidden')");
  console.log('active parallel chat projection excludes completed live tabs: PASS');

  await workerValue(`chrome.tabs.remove(${tabC.id})`);
  await waitProjectExactChatCount(project.projectId, 2);
  console.log('closed stable chat membership cleanup: PASS');
}

async function commandManagerSuite() {
  const projectId = `project:${RUN}:command`;
  await postJson('/projects/upsert', {
    projectId,
    name: 'Command Project',
    projectPath: cleanProject,
    operationClass: 'write',
    autoRecovery: true,
    groupTabs: true,
    color: 'green'
  });

  const seed = `COMMAND-SEED-${RUN}`;
  const queued = await postJson('/commands/enqueue', {
    type: 'CREATE_LANE_CHAT',
    idempotencyKey: `lane:${RUN}:C1`,
    payload: {
      projectId,
      prompt: seed,
      url: 'https://chatgpt.com/?prompt-textarea=SHOULD-NOT-LEAK&foo=bar',
      laneId: 'C1',
      laneName: 'Command Lane C1',
      branch: 'feat/e2e-command-c1',
      role: 'coding'
    }
  });
  assert.equal(queued.command.status, 'pending');
  await workerValue('(globalThis.ChatSentinelCommandManager.kick(), true)');
  const completed = await waitCommand(queued.command.commandId, 'succeeded');
  assert.ok(completed.result?.tabId, 'command did not create a tab');
  assert.equal(completed.result?.promptSent, true);
  assert.equal(completed.result?.deliveryConfirmed, true, 'command must not succeed before prompt delivery evidence');
  assert.equal(completed.result?.deliveryEvidence, 'user-turn');
  assert.equal(completed.result?.launchUrlSanitized, true);
  assert.ok(!/prompt-textarea|SHOULD-NOT-LEAK/.test(completed.result?.launchUrl || ''));

  const projects = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
  const project = projects.projects.find(row => row.projectId === projectId);
  const lane = project?.chats?.find(chat => chat.tabId === completed.result.tabId);
  assert.equal(lane?.laneId, 'C1');
  assert.equal(lane?.branch, 'feat/e2e-command-c1');

  const target = await waitTarget(row => row.type === 'page' && row.url.includes('command=lane'));
  await waitEval(target, `document.body.dataset.sent === ${JSON.stringify(seed)}`);
  const deliveredUrl = await evalValue(target, 'location.href');
  assert.ok(!/[?&]prompt-textarea=/i.test(deliveredUrl), `prompt leaked into URL: ${deliveredUrl}`);
  assert.equal(await evalValue(target, `document.querySelector('[data-message-author-role="user"]')?.innerText`), seed);
  console.log('verified prompt delivery rejects GET-form URL contamination: PASS');

  const duplicateOwner = await postJson('/commands/enqueue', {
    type: 'CREATE_LANE_CHAT',
    idempotencyKey: `lane:${RUN}:C1:duplicate-owner`,
    payload: { projectId, prompt: seed, laneId: 'C1', laneName: 'Command Lane C1', branch: 'feat/e2e-command-c1', role: 'coding' }
  });
  await workerValue('(globalThis.ChatSentinelCommandManager.kick(), true)');
  const duplicateOwnerDone = await waitCommand(duplicateOwner.command.commandId, 'succeeded');
  assert.equal(duplicateOwnerDone.result?.deduplicated, true);
  assert.equal(duplicateOwnerDone.result?.ownerTabId, completed.result.tabId);
  await sleep(500);
  const afterDuplicate = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
  const commandProject = afterDuplicate.projects.find(row => row.projectId === projectId);
  assert.equal(commandProject.chats.filter(chat => chat.laneId === 'C1').length, 1, 'logical prompt must own exactly one live lane tab');
  console.log('single-delivery ownership across duplicate create commands: PASS');

  const groups = await workerValue("chrome.tabGroups.query({title:'Command Project'})");
  assert.ok(groups.some(group => group.color === 'green'));
  console.log('durable supervisor CREATE_LANE_CHAT: PASS');

  const duplicate = await postJson('/commands/enqueue', {
    type: 'CREATE_LANE_CHAT',
    idempotencyKey: `lane:${RUN}:C1`,
    payload: { projectId, prompt: seed, laneId: 'C1' }
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.command.commandId, queued.command.commandId);
  console.log('supervisor command idempotency: PASS');
}

async function waitCommand(commandId, expectedStatus) {
  // Command polling is backed by a 30s MV3 alarm; allow one full alarm interval plus bounded execution time.
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const data = await fetch(`${WATCHDOG}/commands?limit=200`).then(r => r.json());
    const command = data.commands?.find(row => row.commandId === commandId);
    if (command?.status === expectedStatus) return command;
    if (command?.status === 'failed') throw new Error(`command failed: ${command.lastError}`);
    await sleep(200);
  }
  throw new Error(`command ${commandId} did not reach ${expectedStatus}`);
}

async function waitProjectLaneTab(projectId, laneId, predicate = () => true, timeoutMs = E2E_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
    const project = result.projects?.find(row => row.projectId === projectId);
    const chat = project?.chats?.find(row => row.laneId === laneId && predicate(row));
    if (chat) return chat;
    await sleep(200);
  }
  throw new Error(`project ${projectId} lane ${laneId} did not reach expected tab state`);
}

async function waitProjectChatCount(projectId, count) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await fetch(`${WATCHDOG}/projects`).then(r=>r.json());
    const project = result.projects?.find(row=>row.projectId===projectId);
    if (project?.chatCount >= count) return project;
    await sleep(200);
  }
  throw new Error(`project ${projectId} did not reach ${count} chats`);
}

async function waitProjectExactChatCount(projectId, count) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await fetch(`${WATCHDOG}/projects`).then(r => r.json());
    const project = result.projects?.find(row => row.projectId === projectId);
    if (project?.chatCount === count) return project;
    await sleep(200);
  }
  throw new Error(`project ${projectId} did not settle at ${count} registered chats`);
}

async function waitContentReady(tabId) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const reply = await workerValue(`chrome.tabs.sendMessage(${tabId},{type:'CHATSENTINEL_GET_IDENTITY'}).catch(()=>null)`);
    if (reply?.ok) return reply;
    await sleep(150);
  }
  throw new Error(`content script not ready in tab ${tabId}`);
}
async function waitWorkerValue(expression, predicate = Boolean, timeoutMs = E2E_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await workerValue(expression);
      if (predicate(value)) return value;
    } catch {}
    await sleep(200);
  }
  return null;
}

async function waitWorkerCondition(expression, timeoutMs = E2E_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await workerValue(expression)) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}

async function workerValue(expression) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (!EXTENSION_WORKER?.webSocketDebuggerUrl || attempt > 0) {
        EXTENSION_WORKER = await waitTarget(isChatSentinelWorkerTarget);
      }
      const reply = await cdp(EXTENSION_WORKER, 'Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
      if (reply?.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
      return reply?.result?.result?.value;
    } catch (error) {
      lastError = error;
      EXTENSION_WORKER = null;
      await sleep(100);
    }
  }
  throw lastError || new Error('extension service worker unavailable');
}

async function verifyTabFallback() {
  const before = await fetch(`${WATCHDOG}/supervisor`).then(r => r.json());
  const known = new Set((before.sessions || []).map(row => row.id));
  await openPage(fixtureUrl('noidentity'));
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const state = await fetch(`${WATCHDOG}/supervisor`).then(r => r.json());
    const row = (state.sessions || []).find(item => /^tab:\d+$/.test(item.id) && !known.has(item.id));
    if (row?.decision) {
      assert.equal(row.decision.action, 'WAIT');
      console.log(`tab fallback identity: ${row.id} PASS`);
      return;
    }
    await sleep(250);
  }
  throw new Error('tab fallback identity was not observed');
}

async function verifyDecision(kind, expectedAction) {
  const id = `${RUN}-${kind}`;
  await openPage(fixtureUrl(kind, { cid: id }));
  const row = await waitForSession(id);
  assert.equal(row.decision?.action, expectedAction, `${kind} decision`);
  console.log(`${kind}: ${row.decision.action} PASS`);
}

function fixtureUrl(kind, extra = {}) {
  const params = new URLSearchParams({ watchdog: String(TEST_PORT), ...extra });
  if (kind === 'rootidentity' || kind === 'noidentity') {
    params.set('kind', kind);
    return `${FIXTURE}/?${params}`;
  }
  return `${FIXTURE}/${kind}?${params}`;
}

async function openPage(url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${DEVTOOLS}/json/new?${encoded}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open ${url}: ${res.status}`);
  return await res.json();
}

async function waitForSession(id) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const state = await fetch(`${WATCHDOG}/supervisor`).then(r => r.json());
    const row = state.sessions?.find(item => item.id === id);
    if (row?.decision) return row;
    await sleep(250);
  }
  const snapshot = await fetch(`${WATCHDOG}/supervisor`).then(r => r.text()).catch(() => 'unavailable');
  const targets = await fetch(`${DEVTOOLS}/json/list`).then(r => r.text()).catch(() => 'unavailable');
  throw new Error(`session ${id} not observed; supervisor=${snapshot}; targets=${targets}`);
}

async function postJson(route, body) {
  const res = await fetch(`${WATCHDOG}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${route}: ${JSON.stringify(json)}`);
  return json;
}

function isChatSentinelWorkerTarget(target) {
  return isExtensionWorkerTarget(target, EXPECTED_EXTENSION_ID);
}

async function waitTarget(predicate) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    const targets = await waitJson(`${DEVTOOLS}/json/list`);
    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) return target;
    await sleep(200);
  }
  throw new Error('matching CDP target not found');
}

async function waitEval(target, expression) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(target, expression)) return true;
    await sleep(200);
  }
  throw new Error(`condition did not become true: ${expression}`);
}

async function evalValue(target, expression) {
  const reply = await cdp(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return reply?.result?.result?.value;
}

async function cdp(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const id = Math.floor(Math.random() * 1_000_000) + 1;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 5000);
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  ws.send(JSON.stringify({ id, method, params }));
  const result = await response;
  ws.close();
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
}

async function waitDevToolsPort(profileDir) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const [port] = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/);
      if (/^\d+$/.test(port)) return Number(port);
    } catch {}
    await sleep(150);
  }
  throw new Error('DevToolsActivePort was not created');
}

async function waitJson(url) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function waitUrl(url) {
  const deadline = Date.now() + E2E_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function prepareTestExtension(source, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const script of manifest.content_scripts || []) script.matches = ['<all_urls>'];
  manifest.host_permissions = ['<all_urls>'];
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const executorPath = path.join(destination, 'command-executor.js');
  let executor = await fs.readFile(executorPath, 'utf8');
  executor = executor.replaceAll('http://127.0.0.1:4317', `http://127.0.0.1:${TEST_PORT}`);
  await fs.writeFile(executorPath, executor, 'utf8');

  const backgroundPath = path.join(destination, 'background.js');
  let background = await fs.readFile(backgroundPath, 'utf8');
  background = background.replaceAll('http://127.0.0.1:4317', `http://127.0.0.1:${TEST_PORT}`);
  background = background.replaceAll('http://127.0.0.1:4320', `http://127.0.0.1:${FIXTURE_PORT}`);
  await fs.writeFile(backgroundPath, background, 'utf8');

  const setupPath = path.join(destination, 'setup.js');
  let setup = await fs.readFile(setupPath, 'utf8');
  setup = setup.replaceAll('http://127.0.0.1:4317', `http://127.0.0.1:${TEST_PORT}`);
  await fs.writeFile(setupPath, setup, 'utf8');

  for (const relative of ['identity.js', 'content.js']) {
    const fixturePath = path.join(destination, relative);
    let fixtureSource = await fs.readFile(fixturePath, 'utf8');
    fixtureSource = fixtureSource.replaceAll("'4320'", `'${FIXTURE_PORT}'`);
    await fs.writeFile(fixturePath, fixtureSource, 'utf8');
  }

  const guardPath = path.join(destination, 'components', 'tab-launch-guard', 'controller.js');
  let guard = await fs.readFile(guardPath, 'utf8');
  guard = guard.replace(
    "const CHATGPT_HOME = 'https://chatgpt.com/';",
    `const CHATGPT_HOME = 'http://127.0.0.1:${FIXTURE_PORT}/noidentity?watchdog=${TEST_PORT}&command=lane';`
  );
  guard = guard.replace('const DEFAULT_MIN_LAUNCH_GAP_MS = 6000;', 'const DEFAULT_MIN_LAUNCH_GAP_MS = 1000;');
  await fs.writeFile(guardPath, guard, 'utf8');
}

async function prepareCleanProject(base) {
  const project = path.join(base, 'project');
  const remote = path.join(base, 'remote.git');
  await fs.mkdir(project, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: project });
  await execFileAsync('git', ['config', 'user.email', 'chatsentinel@test.local'], { cwd: project });
  await execFileAsync('git', ['config', 'user.name', 'ChatSentinel Test'], { cwd: project });
  await fs.writeFile(path.join(project, 'checkpoint.txt'), 'clean checkpoint\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: project });
  await execFileAsync('git', ['commit', '-m', 'test checkpoint'], { cwd: project });
  await execFileAsync('git', ['init', '--bare', remote]);
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: project });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: project });
  return project;
}

async function freePort(excluded = new Set()) {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const value = server.address()?.port;
        server.close(error => error ? reject(error) : resolve(value));
      });
    });
    if (port && !excluded.has(port)) return port;
  }
}
