// Type definitions for window.electronAPI (Electron preload bridge)

export interface AgentRun {
  id: string;
  status: string;
  agentName?: string;
  projectPath?: string;
  createdAt?: string;
  updatedAt?: string;
  log?: AgentLogEntry[];
  changes?: AgentChange[];
}

export interface AgentChange {
  id: string;
  filePath: string;
  status: 'pending' | 'applied' | 'rejected';
  originalContent?: string;
  newContent?: string;
}

export interface AgentLogEntry {
  type: string;
  content: string;
  timestamp?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface AISnapshot {
  id: string;
  label: string;
  createdAt: string;
  fileCount: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified?: string;
}

export interface SystemAIProfile {
  success: boolean;
  totalGb?: number;
  freeGb?: number;
  gpus?: Array<{ name: string; vramGb: number | null }>;
  ollama?: { available: boolean; models: OllamaModel[]; error: string | null };
}

export interface ElectronAPI {
  // File operations
  getAllFiles: (folderPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  getFolderChildren: (folderPath: string, parentPath?: string) => Promise<{ success: boolean; children?: FileEntry[]; error?: string }>;
  listProjectFiles: (projectPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  searchInProject: (projectPath: string, query: string) => Promise<{ success: boolean; results?: Array<{ file: string; line: number; content: string }>; error?: string }>;
  readFile: (projectPath: string, filename: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (projectPath: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
  deleteFile: (projectPath: string, filename: string) => Promise<{ success: boolean; error?: string }>;
  createNewFile: (projectPath: string, filePath: string, content?: string) => Promise<{ success: boolean; error?: string }>;
  createDirectory: (projectPath: string, dirPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteDirectory: (projectPath: string, dirPath: string) => Promise<{ success: boolean; error?: string }>;
  editFile: (projectPath: string, filePath: string, oldContent: string, newContent: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (projectPath: string, oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
  copyFile: (projectPath: string, sourcePath: string, destPath: string) => Promise<{ success: boolean; error?: string }>;
  moveFile: (projectPath: string, sourcePath: string, destPath: string) => Promise<{ success: boolean; error?: string }>;

  // Settings
  loadSettings: () => Promise<Record<string, unknown>>;
  saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;

  // AI completions
  getGeminiCompletion: (history: unknown[], code: string, files: unknown, options: Record<string, unknown>) => Promise<{ success: boolean; text?: string; error?: string }>;
  getClaudeCompletion: (history: unknown[], code: string, files: unknown, options: Record<string, unknown>) => Promise<{ success: boolean; text?: string; error?: string }>;
  getKimiCompletion: (history: unknown[], code: string, files: unknown, options: Record<string, unknown>) => Promise<{ success: boolean; text?: string; error?: string }>;
  getOllamaCompletion: (history: unknown[], code: string, files: unknown, options: Record<string, unknown>) => Promise<{ success: boolean; text?: string; error?: string }>;

  // Ollama
  listOllamaModels: () => Promise<{ success: boolean; models?: OllamaModel[]; error?: string }>;
  startOllama: () => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>;
  installOllama: () => Promise<{ success: boolean; alreadyInstalled?: boolean; openedDownload?: boolean; error?: string }>;
  pullOllamaModel: (modelName: string) => Promise<{ success: boolean; model?: string; error?: string }>;
  checkOllamaUpdates: (modelNames?: string[]) => Promise<{ success: boolean; models?: Array<{ model: string; status: string; error?: string }> }>;
  resolveOllamaFamily: (payload: { vendor?: string; force?: boolean }) => Promise<{ success: boolean; family?: string; allFamilies?: string[] }>;
  fetchOllamaLibrarySizes: (payload: { family: string; force?: boolean }) => Promise<{ success: boolean; family?: string; sizes?: string[] }>;
  recommendOllamaSize: (payload: { sizes: string[]; consent?: boolean }) => Promise<{ success: boolean; recommended?: string; totalGb?: number; vramGb?: number; basis?: string }>;

  // Snapshots
  createAISnapshot: (projectPath: string, files: string[], label?: string) => Promise<{ success: boolean; snapshotId?: string; error?: string }>;
  listAISnapshots: (projectPath: string) => Promise<{ success: boolean; snapshots?: AISnapshot[]; error?: string }>;
  restoreAISnapshot: (projectPath: string, snapshotId: string) => Promise<{ success: boolean; restored?: number; error?: string }>;

  // Agent runs
  agentListRuns: (projectPath: string) => Promise<{ success: boolean; runs?: AgentRun[]; error?: string }>;
  agentGetRun: (projectPath: string, runId: string) => Promise<{ success: boolean; run?: AgentRun; error?: string }>;
  agentCreateRun: (projectPath: string, payload: unknown) => Promise<{ success: boolean; run?: AgentRun; error?: string }>;
  agentUpdateRun: (projectPath: string, runId: string, patch: Partial<AgentRun>) => Promise<{ success: boolean; run?: AgentRun; error?: string }>;
  agentAppendLog: (projectPath: string, runId: string, log: AgentLogEntry) => Promise<{ success: boolean; error?: string }>;
  agentApplyChange: (projectPath: string, runId: string, changeId: string) => Promise<{ success: boolean; error?: string }>;
  agentRejectChange: (projectPath: string, runId: string, changeId: string) => Promise<{ success: boolean; error?: string }>;

  // Agents & Skills library
  listAgents: (projectPath: string) => Promise<{ success: boolean; agents?: unknown[]; error?: string }>;
  getAgent: (name: string, scope: string, projectPath: string) => Promise<{ success: boolean; agent?: unknown; error?: string }>;
  saveAgent: (name: string, content: string, scope: string, projectPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteAgent: (name: string, scope: string, projectPath: string) => Promise<{ success: boolean; error?: string }>;
  listSkills: (projectPath: string) => Promise<{ success: boolean; skills?: unknown[]; error?: string }>;
  getSkill: (name: string, scope: string, projectPath: string) => Promise<{ success: boolean; skill?: unknown; error?: string }>;

  // Intelligent Router — returns success:true even on failure (safe fallback decision).
  routeRequest: (
    projectPath: string | null,
    userPrompt: string,
    options?: {
      provider?: string;
      apiKey?: string;
      hardwareProfile?: { vramGb?: number; totalGb?: number } | null;
      settings?: Record<string, unknown> | null;
    }
  ) => Promise<{
    success: true;
    decision: {
      mode: 'single_agent' | 'orchestrator' | 'multi_agent';
      agent: string | null;
      skills: string[];
      complexity: 'light' | 'premium';
    };
    execution: {
      executionMode: 'agent' | 'multi-agent';
      depth: 'fast' | 'deep';
    };
    model: { provider: string; tier: 'light' | 'premium'; resolved: string; source: 'live' | 'registry' | 'static' };
    source: 'llm' | 'fallback';
    timingMs: number;
  }>;

  // System
  getSystemAIProfile: (options?: { consent?: boolean }) => Promise<SystemAIProfile>;
  getSystemInfo: () => Promise<{ platform: string; arch: string; version: string }>;

  // Logging (from renderer to Electron)
  logInfo?: (msg: string, meta?: Record<string, unknown>) => void;
  logWarn?: (msg: string, meta?: Record<string, unknown>) => void;
  logError?: (msg: string, meta?: Record<string, unknown>) => void;

  // Event listeners
  onMenuOpenSettings?: (callback: () => void) => (() => void);
  onOllamaPullProgress?: (callback: (data: { model: string; status: string; completed?: number | null; total?: number | null }) => void) => (() => void);
  onAgentAction?: (callback: (data: { type: string; runId: string; status: string; at: string }) => void) => (() => void);
  onAIChunk?: (callback: (data: { chunk: string; done?: boolean }) => void) => (() => void);
  onTerminalOutput?: (callback: (data: unknown) => void) => (() => void);
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
