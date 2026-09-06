import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySideEffectRisk, isFreshCheckpoint } from '../src/side-effect-classifier.js';

const clean = {
  ok: true,
  clean: true,
  aheadOrDiverged: false,
  head: 'abc',
  remoteHead: 'abc'
};

test('fresh checkpoint requires clean synchronized git state', () => {
  assert.equal(isFreshCheckpoint(clean), true);
  assert.equal(isFreshCheckpoint({ ...clean, clean: false }), false);
  assert.equal(isFreshCheckpoint({ ...clean, remoteHead: 'def' }), false);
});

test('readonly policy allows safe retry classification', () => {
  assert.equal(classifySideEffectRisk({ reconciliation: clean, policy: { operationClass: 'read_only' } }), 'none');
});

test('dirty tree is treated as possible side effect', () => {
  assert.equal(classifySideEffectRisk({ reconciliation: { ...clean, clean: false } }), 'possible');
});

test('remote head movement is confirmed side effect', () => {
  assert.equal(classifySideEffectRisk({
    previous: { reconciliation: { ...clean, remoteHead: 'old' } },
    reconciliation: clean
  }), 'confirmed');
});

test('unknown clean write state remains conservative', () => {
  assert.equal(classifySideEffectRisk({ reconciliation: clean }), 'unknown');
});

test('explicit readonly policy is enough without a repository', () => {
  assert.equal(classifySideEffectRisk({ policy: { operationClass: 'read_only' } }), 'none');
});

test('stale cached remote evidence can never be treated as a fresh checkpoint', () => {
  assert.equal(isFreshCheckpoint({ ...clean, remoteHeadFresh: false }), false);
});

test('semantic working-tree evidence identifies concrete possible side effects', () => {
  assert.equal(classifySideEffectRisk({
    reconciliation: {
      ...clean,
      clean: false,
      changeSummary: { total: 1, staged: 1, unstaged: 0, untracked: 0, conflicted: 0 }
    },
    policy: { operationClass: 'read_only' }
  }), 'possible');
});
