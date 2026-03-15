export const groupGitStatusEntries = (entries = []) => {
  const groups = {
    conflicted: [],
    staged: [],
    working: [],
    untracked: []
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.file) continue;

    if (entry.conflicted) {
      groups.conflicted.push(entry);
      continue;
    }

    if (entry.untracked) {
      groups.untracked.push(entry);
      continue;
    }

    if (entry.staged) {
      groups.staged.push(entry);
    }

    if (entry.unstaged) {
      groups.working.push(entry);
    }
  }

  return groups;
};

export const getGitDisplayPath = (entry) => {
  const filePath = String(entry?.file || '').trim();
  const previousFile = String(entry?.previousFile || '').trim();

  if (previousFile && previousFile !== filePath) {
    return `${previousFile} -> ${filePath}`;
  }

  return filePath;
};

export const getGitSectionMeta = (entry, sectionId) => {
  if (!entry) return '';

  if (sectionId === 'conflicted') {
    return `Conflit ${String(entry.rawStatus || entry.status || '').trim() || 'U'}`;
  }

  if (sectionId === 'staged') {
    return `Index ${String(entry.indexStatus || entry.status || '').trim() || 'M'}`;
  }

  if (sectionId === 'working') {
    return `Working tree ${String(entry.workingTreeStatus || entry.status || '').trim() || 'M'}`;
  }

  if (sectionId === 'untracked') {
    return 'Non suivi';
  }

  return String(entry.status || '').trim();
};

export const getGitSectionActionLabel = (sectionId) => {
  if (sectionId === 'staged') return 'Unstage';
  return 'Stage';
};
