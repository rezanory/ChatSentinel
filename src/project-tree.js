export function normalizeFolderPath(value = '') {
  return String(value)
    .split(/[\\/]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('/');
}

export function buildProjectTree(projects = []) {
  const root = { name: '', path: '', folders: [], projects: [] };
  const index = new Map([['', root]]);

  for (const project of projects) {
    const folderPath = normalizeFolderPath(project.folderPath);
    let parent = root;
    let path = '';
    for (const part of folderPath ? folderPath.split('/') : []) {
      path = path ? `${path}/${part}` : part;
      let folder = index.get(path);
      if (!folder) {
        folder = { name: part, path, folders: [], projects: [] };
        index.set(path, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }
    parent.projects.push(project);
  }

  sortNode(root);
  return root;
}

function sortNode(node) {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.projects.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const folder of node.folders) sortNode(folder);
}
