const {
  buildBrainGraph,
  getGraphPath,
  loadBrainGraph,
  saveBrainGraph,
  selectBrainGraphContext
} = require('../brain/brainGraph');

const registerBrainGraphHandlers = ({
  ipcMain,
  ensureTrustedProjectPath,
  assertSafePath
}) => {
  const handle = (channel, listener) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const requireTrustedProjectPath = async (projectPath) => {
    if (!projectPath) throw new Error('No project path');
    return ensureTrustedProjectPath(projectPath);
  };

  const loadOrBuildGraph = async (projectPath, options = {}) => {
    const trustedProjectPath = await requireTrustedProjectPath(projectPath);
    if (!options.force) {
      try {
        const loaded = await loadBrainGraph(trustedProjectPath);
        return {
          graph: loaded.graph,
          graphPath: loaded.graphPath,
          source: 'cache'
        };
      } catch {
        // Build below.
      }
    }

    const graph = await buildBrainGraph(trustedProjectPath, options);
    const graphPath = await saveBrainGraph(trustedProjectPath, graph);
    assertSafePath(trustedProjectPath, graphPath);
    return { graph, graphPath, source: 'scan' };
  };

  handle('brain-graph:index', async (event, projectPath, options = {}) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const graph = await buildBrainGraph(trustedProjectPath, options || {});
      const graphPath = await saveBrainGraph(trustedProjectPath, graph);
      assertSafePath(trustedProjectPath, graphPath);
      return { success: true, graph, graphPath, source: 'scan' };
    } catch (error) {
      console.error('[BrainGraph] index error:', error);
      return { success: false, error: error.message };
    }
  });

  handle('brain-graph:get', async (event, projectPath, options = {}) => {
    try {
      const result = await loadOrBuildGraph(projectPath, options || {});
      return { success: true, ...result };
    } catch (error) {
      console.error('[BrainGraph] get error:', error);
      return { success: false, error: error.message };
    }
  });

  handle('brain-graph:select', async (event, projectPath, query, options = {}) => {
    try {
      const result = await loadOrBuildGraph(projectPath, options || {});
      const selection = selectBrainGraphContext(result.graph, query, options || {});
      return {
        success: true,
        selection,
        graphStats: result.graph.stats,
        graphGeneratedAt: result.graph.generatedAt,
        source: result.source
      };
    } catch (error) {
      console.error('[BrainGraph] select error:', error);
      return { success: false, error: error.message };
    }
  });

  handle('brain-graph:path', async (event, projectPath) => {
    try {
      const trustedProjectPath = await requireTrustedProjectPath(projectPath);
      const graphPath = getGraphPath(trustedProjectPath);
      assertSafePath(trustedProjectPath, graphPath);
      return { success: true, graphPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = {
  registerBrainGraphHandlers
};
