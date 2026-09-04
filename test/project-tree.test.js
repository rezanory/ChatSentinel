import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTree, normalizeFolderPath } from '../src/project-tree.js';

test('project tree normalizes nested folder paths and keeps projects isolated', () => {
  assert.equal(normalizeFolderPath(' Client \\ Product / Phase '), 'Client/Product/Phase');
  const tree = buildProjectTree([
    { projectId: 'p2', name: 'Beta', folderPath: 'Client/Product' },
    { projectId: 'p1', name: 'Alpha', folderPath: 'Client/Product/Phase' },
    { projectId: 'p3', name: 'Root' }
  ]);
  assert.deepEqual(tree.projects.map(project => project.projectId), ['p3']);
  const client = tree.folders[0];
  const product = client.folders[0];
  assert.equal(client.path, 'Client');
  assert.deepEqual(product.projects.map(project => project.projectId), ['p2']);
  assert.deepEqual(product.folders[0].projects.map(project => project.projectId), ['p1']);
});
