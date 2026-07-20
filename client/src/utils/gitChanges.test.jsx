import {
  getGitDisplayPath,
  getGitSectionActionLabel,
  getGitSectionMeta,
  groupGitStatusEntries
} from './gitChanges';

describe('gitChanges utilities', () => {
  it('groups entries by scm section', () => {
    const groups = groupGitStatusEntries([
      { file: 'src/conflict.js', conflicted: true, rawStatus: 'UU' },
      { file: 'src/app.js', staged: true, unstaged: true, indexStatus: 'M', workingTreeStatus: 'M' },
      { file: 'src/new.js', untracked: true },
      { file: 'README.md', staged: true, unstaged: false, indexStatus: 'A', workingTreeStatus: ' ' }
    ]);

    expect(groups.conflicted).toHaveLength(1);
    expect(groups.staged.map((entry) => entry.file)).toEqual(['src/app.js', 'README.md']);
    expect(groups.working.map((entry) => entry.file)).toEqual(['src/app.js']);
    expect(groups.untracked.map((entry) => entry.file)).toEqual(['src/new.js']);
  });

  it('formats renamed paths for display', () => {
    expect(getGitDisplayPath({
      file: 'client/src/App.js',
      previousFile: 'client/src/OldApp.js'
    })).toBe('client/src/OldApp.js -> client/src/App.js');
  });

  it('returns section metadata and actions', () => {
    expect(getGitSectionMeta({ rawStatus: 'UU' }, 'conflicted')).toBe('Conflit UU');
    expect(getGitSectionMeta({ indexStatus: 'M' }, 'staged')).toBe('Index M');
    expect(getGitSectionMeta({ workingTreeStatus: 'D' }, 'working')).toBe('Working tree D');
    expect(getGitSectionMeta({}, 'untracked')).toBe('Non suivi');
    expect(getGitSectionActionLabel('staged')).toBe('Unstage');
    expect(getGitSectionActionLabel('working')).toBe('Stage');
  });
});
