const {
  VISUAL_WORKFLOW_SCHEMA_VERSION,
  sanitizeVisualWorkflowPayload
} = require('../workflows/visualWorkflowSchema');

const parseWorkflowFile = (content) => {
  const lines = String(content || '').split('\n');
  let description = '';
  let body = String(content || '');

  if (lines[0] && lines[0].trim() === '---') {
    let endIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        endIndex = index;
        break;
      }
      const match = lines[index].match(/^description:\s*(.+)$/i);
      if (match) {
        description = match[1].trim();
      }
    }
    if (endIndex > 0) {
      body = lines.slice(endIndex + 1).join('\n').trim();
    }
  }

  return { description, body };
};
const registerWorkflowHandlers = ({
  ipcMain,
  app,
  fs,
  path,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath,
  toPositiveInt,
  getN8nCatalogEntries,
  fetchTrustedN8nWorkflow,
  workflowEngine
}) => {
  const getGlobalWorkflowsDir = () => path.join(app.getPath('userData'), 'workflows');
  const getWorkspaceWorkflowsDir = (projectPath) => path.join(projectPath, '.agent', 'workflows');
  const getVisualWorkflowsDir = (projectPath) => path.join(projectPath, '.vibe-workflows');

  const handle = (channel, listener) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const requireTrustedProjectPath = async (projectPath) => {
    if (!projectPath) throw new Error('No project path');
    return ensureTrustedProjectPath(projectPath);
  };

  handle('list-workflows', async (event, projectPath) => {
    try {
      const workflows = [];

      const globalDir = getGlobalWorkflowsDir();
      try {
        await fs.mkdir(globalDir, { recursive: true });
        const globalFiles = await fs.readdir(globalDir);
        for (const file of globalFiles) {
          if (!file.endsWith('.md')) continue;
          const name = file.replace('.md', '');
          const content = await fs.readFile(path.join(globalDir, file), 'utf-8');
          const { description } = parseWorkflowFile(content);
          workflows.push({
            name,
            scope: 'global',
            description,
            path: path.join(globalDir, file)
          });
        }
      } catch {
        // ignore
      }

      if (projectPath) {
        const trustedProjectPath = await requireTrustedProjectPath(projectPath);
        const workspaceDir = getWorkspaceWorkflowsDir(trustedProjectPath);
        try {
          const workspaceFiles = await fs.readdir(workspaceDir);
          for (const file of workspaceFiles) {
            if (!file.endsWith('.md')) continue;
            const name = file.replace('.md', '');
            const content = await fs.readFile(path.join(workspaceDir, file), 'utf-8');
            const { description } = parseWorkflowFile(content);
            workflows.push({
              name,
              scope: 'workspace',
              description,
              path: path.join(workspaceDir, file)
            });
          }
        } catch {
          // ignore
        }
      }

      return { success: true, workflows };
    } catch (error) {
      console.error('[Workflows] Error listing workflows:', error);
      return { success: false, error: error.message };
    }
  });

  handle('get-workflow', async (event, name, scope, projectPath) => {
    try {
      const safeName = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safeName) {
        return { success: false, error: 'Invalid workflow name' };
      }
      let filePath;
      if (scope === 'global') {
        filePath = path.join(getGlobalWorkflowsDir(), `${safeName}.md`);
      } else if (scope === 'workspace' && projectPath) {
        const trustedProjectPath = await requireTrustedProjectPath(projectPath);
        filePath = path.join(getWorkspaceWorkflowsDir(trustedProjectPath), `${safeName}.md`);
      } else {
        return { success: false, error: 'Invalid scope or missing project path' };
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const { description, body } = parseWorkflowFile(content);

      return {
        success: true,
        workflow: { name: safeName, scope, description, body, content, path: filePath }
      };
    } catch (error) {
      console.error('[Workflows] Error getting workflow:', error);
      return { success: false, error: error.message };
    }
  });

  handle('save-workflow', async (event, name, content, scope, projectPath) => {
    try {
      await ensureEditPermission();

      let dir;
      if (scope === 'global') {
        dir = getGlobalWorkflowsDir();
      } else if (scope === 'workspace' && projectPath) {
        const trustedProjectPath = await requireTrustedProjectPath(projectPath);
        dir = getWorkspaceWorkflowsDir(trustedProjectPath);
      } else {
        return { success: false, error: 'Invalid scope or missing project path' };
      }

      const safeName = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safeName) {
        return { success: false, error: 'Invalid workflow name' };
      }

      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safeName}.md`);
      await fs.writeFile(filePath, content, 'utf-8');

      console.log(`[Workflows] Saved workflow: ${filePath}`);
      return { success: true, path: filePath, name: safeName };
    } catch (error) {
      console.error('[Workflows] Error saving workflow:', error);
      return { success: false, error: error.message };
    }
  });

  handle('delete-workflow', async (event, name, scope, projectPath) => {
    try {
      await ensureEditPermission();

      const safeName = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safeName) {
        return { success: false, error: 'Invalid workflow name' };
      }
      let filePath;
      if (scope === 'global') {
        filePath = path.join(getGlobalWorkflowsDir(), `${safeName}.md`);
      } else if (scope === 'workspace' && projectPath) {
        const trustedProjectPath = await requireTrustedProjectPath(projectPath);
        filePath = path.join(getWorkspaceWorkflowsDir(trustedProjectPath), `${safeName}.md`);
      } else {
        return { success: false, error: 'Invalid scope or missing project path' };
      }

      await fs.unlink(filePath);
      console.log(`[Workflows] Deleted workflow: ${filePath}`);
      return { success: true };
    } catch (error) {
      console.error('[Workflows] Error deleting workflow:', error);
      return { success: false, error: error.message };
    }
  });

  handle('list-visual-workflows', async (event, projectPath) => {
    try {
      if (!projectPath) return { success: false, error: 'No project path' };
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const dir = getVisualWorkflowsDir(trustedProjectPath);
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // ignore
      }

      const files = await fs.readdir(dir);
      const workflows = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const wfRaw = JSON.parse(content);
          const { workflow: wf, sourceVersion, migrated } = sanitizeVisualWorkflowPayload(wfRaw, { strict: false });
          workflows.push({
            filename: file,
            name: wf.name || file.replace('.json', ''),
            nodeCount: (wf.nodes || []).length,
            edgeCount: (wf.edges || []).length,
            schemaVersion: sourceVersion,
            migrated,
            updatedAt: wf.updatedAt || null
          });
        } catch {
          // ignore invalid workflow file
        }
      }

      return { success: true, workflows };
    } catch (error) {
      console.error('[VisualWorkflows] Error listing:', error);
      return { success: false, error: error.message };
    }
  });

  handle('save-visual-workflow', async (event, projectPath, workflowJson) => {
    try {
      await ensureEditPermission();

      if (!projectPath) return { success: false, error: 'No project path' };
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const dir = getVisualWorkflowsDir(trustedProjectPath);
      await fs.mkdir(dir, { recursive: true });

      const wfRaw = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;
      const sanitized = sanitizeVisualWorkflowPayload(wfRaw, { strict: true });
      const wf = sanitized.workflow;
      wf.updatedAt = new Date().toISOString();

      const safeName = (wf.name || 'workflow').replace(/[<>:"/\\|?*]/g, '_').trim();
      const filePath = path.join(dir, `${safeName}.json`);
      let existedBefore = false;
      try {
        await fs.access(filePath);
        existedBefore = true;
      } catch {
        existedBefore = false;
      }

      await fs.writeFile(filePath, JSON.stringify(wf, null, 2), 'utf-8');

      console.log(`[VisualWorkflows] Saved: ${filePath}`);
      return {
        success: true,
        path: filePath,
        name: safeName,
        filename: `${safeName}.json`,
        action: existedBefore ? 'updated' : 'created',
        schemaVersion: VISUAL_WORKFLOW_SCHEMA_VERSION,
        migrated: sanitized.migrated,
        sourceVersion: sanitized.sourceVersion
      };
    } catch (error) {
      console.error('[VisualWorkflows] Error saving:', error);
      return { success: false, error: error.message };
    }
  });

  handle('delete-visual-workflow', async (event, projectPath, filename) => {
    try {
      await ensureEditPermission();

      if (!projectPath || !filename) return { success: false, error: 'Missing params' };
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const visualWorkflowDir = getVisualWorkflowsDir(trustedProjectPath);
      const filePath = path.join(visualWorkflowDir, filename);
      assertSafePath(visualWorkflowDir, filePath);
      await fs.unlink(filePath);
      console.log(`[VisualWorkflows] Deleted: ${filePath}`);
      return { success: true };
    } catch (error) {
      console.error('[VisualWorkflows] Error deleting:', error);
      return { success: false, error: error.message };
    }
  });

  handle('workflow-run', async (event, projectPath, workflowPayload) => {
    try {
      if (!workflowEngine || typeof workflowEngine.start !== 'function') {
        return { success: false, error: 'Moteur de workflow indisponible.' };
      }
      return await workflowEngine.start(projectPath, workflowPayload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('workflow-stop', async (event, runId) => {
    try {
      if (!workflowEngine || typeof workflowEngine.stop !== 'function') {
        return { success: false, error: 'Moteur de workflow indisponible.' };
      }
      return await workflowEngine.stop(runId);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('list-workflow-runs', async (event, projectPath) => {
    try {
      if (!workflowEngine || typeof workflowEngine.list !== 'function') {
        return { success: false, error: 'Historique de workflow indisponible.' };
      }
      return await workflowEngine.list(projectPath);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('get-workflow-run', async (event, runId, projectPath) => {
    try {
      if (!workflowEngine || typeof workflowEngine.get !== 'function') {
        return { success: false, error: 'Historique de workflow indisponible.' };
      }
      return await workflowEngine.get(runId, projectPath);
    } catch {
      return { success: false, error: 'Workflow introuvable.' };
    }
  });

  handle('fetch-n8n-catalog', async (event, page = 1, perPage = 50) => {
    try {
      const safePage = toPositiveInt(page, 1, 1, 100000);
      const safePerPage = toPositiveInt(perPage, 50, 1, 5000);
      const catalog = await getN8nCatalogEntries(15000);
      const allItems = Array.isArray(catalog.items) ? catalog.items : [];
      const startIndex = (safePage - 1) * safePerPage;
      const pagedItems = allItems.slice(startIndex, startIndex + safePerPage);
      const total = Number(catalog.total) || allItems.length;
      const totalPages = Math.max(1, Math.ceil(total / safePerPage));
      return {
        success: true,
        items: pagedItems,
        total,
        page: safePage,
        perPage: safePerPage,
        totalPages,
        source: catalog.source || 'unknown',
        truncated: !!catalog.truncated
      };
    } catch (error) {
      console.error('[n8nCatalog] Error fetching:', error.message);
      return { success: false, error: error.message };
    }
  });

  handle('download-n8n-workflow', async (event, downloadUrl) => {
    try {
      const workflow = await fetchTrustedN8nWorkflow(downloadUrl, 15000);
      return { success: true, data: workflow };
    } catch (error) {
      console.error('[n8nCatalog] Error downloading:', error.message);
      return { success: false, error: error.message };
    }
  });
};

module.exports = {
  registerWorkflowHandlers
};
