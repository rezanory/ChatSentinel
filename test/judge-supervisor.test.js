import test from 'node:test';
import assert from 'node:assert/strict';
import {
  terminalCandidate,
  parseJudgeDecision,
  buildJudgeInstruction,
  judgeNeedsRollover,
  judgeChatForProject
} from '../src/components/judge-supervisor/controller.js';

test('idle prose-final worker with incomplete deterministic gate becomes a judge candidate', () => {
  const row = {
    conversationId: 'conv-1',
    lane: { laneId: 'C32', laneName: 'Bot Flow', branch: 'feat/c32', baselineSha: 'base' },
    completion: { complete: false, reason: 'branch-not-advanced' },
    session: {
      state: 'IDLE', projectId: 'p1', tabId: 42,
      lastAssistantText: 'Done. Everything is complete.',
      lastAssistantFingerprint: 'fp123', assistantSettledMs: 9000
    }
  };
  const candidate = terminalCandidate(row, { status: 'succeeded' });
  assert.equal(candidate.laneId, 'C32');
  assert.equal(candidate.assistantFingerprint, 'fp123');
  assert.equal(candidate.completionReason, 'branch-not-advanced');
});

test('judge instruction forbids execution and binds verdict to the incident fingerprint', () => {
  const text = buildJudgeInstruction({
    laneId: 'C32', assistantFingerprint: 'fp123', assistantExcerpt: 'final-ish answer'
  });
  assert.match(text, /ADJUDICATION ONLY/);
  assert.match(text, /DO NOT EXECUTE PROJECT WORK/);
  assert.match(text, /INCIDENT: fp123/);
  assert.match(text, /deterministic Git\/workflow gate has final authority/i);
});

test('judge verdict parser requires both verdict and incident for safe correlation', () => {
  assert.deepEqual(
    parseJudgeDecision('VERDICT: CONTINUE_NEW_WORKER\nINCIDENT: fp123\nverify branch'),
    { verdict: 'CONTINUE_NEW_WORKER', incident: 'fp123' }
  );
  assert.deepEqual(parseJudgeDecision('looks complete'), { verdict: '', incident: '' });
});

test('judge rolls over after bounded adjudications in the current judge generation', () => {
  const commands = Array.from({ length: 6 }, (_, index) => ({
    status: 'succeeded', type: 'SEND_PROMPT', updatedAt: `2026-09-06T0${index + 1}:00:00Z`,
    payload: { role: 'judge' }
  }));
  assert.equal(judgeNeedsRollover(commands, 6, '2026-09-06T00:30:00Z'), true);
  assert.equal(judgeNeedsRollover(commands.slice(0, 5), 6, '2026-09-06T00:30:00Z'), false);
});

test('latest judge chat is selected and worker chats are ignored', () => {
  const configs = {
    a: { projectId: 'p1', role: 'judge', attachedAt: '2026-09-06T01:00:00Z' },
    b: { projectId: 'p1', role: 'worker', attachedAt: '2026-09-06T03:00:00Z' },
    c: { projectId: 'p1', role: 'judge', attachedAt: '2026-09-06T02:00:00Z' }
  };
  const found = judgeChatForProject(configs, {}, 'p1');
  assert.equal(found.conversationId, 'c');
});
