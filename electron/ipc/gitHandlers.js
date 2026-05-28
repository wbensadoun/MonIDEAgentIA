const GIT_UNMERGED_STATUSES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

const normalizeGitPath = (filePath) => String(filePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');

const parseGitStatusPorcelain = (stdout) => {
  const records = String(stdout || '').split('\0').filter(Boolean);
  const files = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = String(records[index] || '');
    if (record.length < 4) continue;

    const rawStatus = record.slice(0, 2);
    const indexStatus = rawStatus[0] || ' ';
    const workingTreeStatus = rawStatus[1] || ' ';
    const filePath = normalizeGitPath(record.slice(3));
    if (!filePath) continue;

    let previousFile = '';
    if ((indexStatus === 'R' || indexStatus === 'C') && records[index + 1]) {
      previousFile = normalizeGitPath(records[index + 1]);
      index += 1;
    }

    const untracked = rawStatus === '??';
    const ignored = rawStatus === '!!';
    const conflicted = GIT_UNMERGED_STATUSES.has(rawStatus);
    const staged = !untracked && !ignored && indexStatus !== ' ';
    const unstaged = !untracked && !ignored && workingTreeStatus !== ' ';

    files.push({
      status: rawStatus.trim() || rawStatus,
      rawStatus,
      indexStatus,
      workingTreeStatus,
      file: filePath,
      previousFile,
      staged,
      unstaged,
      untracked,
      ignored,
      conflicted,
      added: untracked || indexStatus === 'A',
      modified: indexStatus === 'M' || workingTreeStatus === 'M' || indexStatus === 'T' || workingTreeStatus === 'T',
      deleted: indexStatus === 'D' || workingTreeStatus === 'D',
      renamed: indexStatus === 'R' || workingTreeStatus === 'R' || Boolean(previousFile),
      copied: indexStatus === 'C' || workingTreeStatus === 'C'
    });
  }

  return files.filter((entry) => !entry.ignored);
};

const isGitMissingPathError = (error) => {
  const message = String(error?.message || '');
  return /not in ['"]HEAD['"]|not in index|does not exist|exists on disk, but not in/i.test(message);
};

const registerGitHandlers = ({
  ipcMain,
  fs,
  path,
  runGit,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath
}) => {
  const readGitBlobIfExists = async (projectPath, gitSpecifier) => {
    try {
      const { stdout } = await runGit(['show', gitSpecifier], projectPath);
      return { exists: true, content: stdout };
    } catch (error) {
      if (isGitMissingPathError(error)) {
        return { exists: false, content: '' };
      }
      throw error;
    }
  };

  const handle = (channel, listener) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const requireTrustedProjectPath = async (projectPath) => {
    if (!projectPath) throw new Error('Chemin projet manquant');
    return ensureTrustedProjectPath(projectPath);
  };

  handle('git-status', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], trustedProjectPath);
      return { success: true, files: parseGitStatusPorcelain(stdout) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-diff', async (event, projectPath, filePath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const args = filePath ? ['diff', 'HEAD', '--', filePath] : ['diff', 'HEAD'];
      const { stdout } = await runGit(args, trustedProjectPath);
      return { success: true, diff: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-add', async (event, projectPath, files = []) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const args = files && files.length > 0 ? ['add', ...files] : ['add', '-A'];
      await runGit(args, trustedProjectPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-unstage', async (event, projectPath, files = []) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const normalizedFiles = Array.isArray(files)
        ? files.map((file) => normalizeGitPath(file)).filter(Boolean)
        : [];
      const args = normalizedFiles.length > 0
        ? ['reset', 'HEAD', '--', ...normalizedFiles]
        : ['reset', 'HEAD'];
      await runGit(args, trustedProjectPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-commit', async (event, projectPath, message) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      if (!message || !message.trim()) return { success: false, error: 'Message de commit manquant' };
      const { stdout } = await runGit(['commit', '-m', message.trim()], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-push', async (event, projectPath, remote, branch) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const args = ['push'];
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const { stdout } = await runGit(args, trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-pull', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const { stdout } = await runGit(['pull'], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-log', async (event, projectPath, limit = 20) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['log', `--max-count=${limit}`, '--pretty=format:%H|%an|%ae|%ar|%s'], trustedProjectPath);
      const commits = stdout.split('\n').filter(Boolean).map((line) => {
        const parts = line.split('|');
        return { hash: parts[0], author: parts[1], email: parts[2], date: parts[3], message: parts.slice(4).join('|') };
      });
      return { success: true, commits };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-read-file-state', async (event, projectPath, filePath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);

      const normalizedFile = normalizeGitPath(filePath);
      if (!normalizedFile) return { success: false, error: 'Chemin fichier manquant' };

      const absoluteFilePath = path.join(trustedProjectPath, normalizedFile);
      assertSafePath(trustedProjectPath, absoluteFilePath);

      const [headRes, indexRes] = await Promise.all([
        readGitBlobIfExists(trustedProjectPath, `HEAD:${normalizedFile}`),
        readGitBlobIfExists(trustedProjectPath, `:${normalizedFile}`)
      ]);

      let workingContent = '';
      let existsInWorking = false;

      try {
        workingContent = await fs.readFile(absoluteFilePath, 'utf-8');
        existsInWorking = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      return {
        success: true,
        filePath: normalizedFile,
        headContent: headRes.content,
        indexContent: indexRes.content,
        workingContent,
        existsInHead: headRes.exists,
        existsInIndex: indexRes.exists,
        existsInWorking
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-init', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const { stdout } = await runGit(['init'], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-branch', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['branch', '--show-current'], trustedProjectPath);
      return { success: true, branch: stdout.trim() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-remotes', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['remote', '-v'], trustedProjectPath);
      return { success: true, remotes: stdout.trim() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-list-branches', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['branch', '--all', '--no-color'], trustedProjectPath);
      const branches = stdout
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .map((line) => ({
          name: line.replace(/^\*\s*/, '').replace(/^remotes\//, ''),
          current: line.startsWith('*')
        }));
      return { success: true, branches };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-checkout-branch', async (event, projectPath, branchName) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const target = String(branchName || '').trim();
      if (!target) return { success: false, error: 'Nom de branche manquant' };
      const { stdout } = await runGit(['checkout', target], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-create-branch', async (event, projectPath, branchName) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const target = String(branchName || '').trim();
      if (!target) return { success: false, error: 'Nom de branche manquant' };
      const { stdout } = await runGit(['checkout', '-b', target], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-stash-save', async (event, projectPath, message) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const stashMessage = String(message || '').trim() || `stash-${new Date().toISOString()}`;
      const { stdout } = await runGit(['stash', 'push', '-u', '-m', stashMessage], trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-stash-list', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const { stdout } = await runGit(['stash', 'list', '--pretty=format:%gd|%cr|%s'], trustedProjectPath);
      const stashes = stdout.split('\n').filter(Boolean).map((line) => {
        const [ref, when, ...rest] = line.split('|');
        return { ref: ref || '', when: when || '', message: rest.join('|') || '' };
      });
      return { success: true, stashes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('git-stash-pop', async (event, projectPath, stashRef) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      await ensureEditPermission();
      const ref = String(stashRef || '').trim();
      const args = ref ? ['stash', 'pop', ref] : ['stash', 'pop'];
      const { stdout } = await runGit(args, trustedProjectPath);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = {
  registerGitHandlers
};
