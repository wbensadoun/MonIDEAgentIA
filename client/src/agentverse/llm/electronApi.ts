/**
 * Minimal typings for the subset of `window.electronAPI` AgentVerse needs.
 *
 * The IDE exposes a much larger surface (see `preload.js`); we only declare the
 * AI-completion entrypoints + settings, so the module stays decoupled and the
 * strict TS build doesn't depend on the untyped `.js` host code.
 */

export interface AIMessage {
  role: 'user' | 'model' | 'system';
  text: string;
}

export interface CompletionResult {
  success: boolean;
  text?: string;
  model?: string;
  error?: string;
  retryable?: boolean;
  cancelled?: boolean;
}

export type CompletionFn = (
  history: AIMessage[],
  currentCode: string,
  allProjectFiles: unknown[],
  options: Record<string, unknown>,
) => Promise<CompletionResult>;

export interface LoadSettingsResult {
  success: boolean;
  settings?: Record<string, unknown>;
}

export interface ElectronAIApi {
  getGeminiCompletion?: CompletionFn;
  getClaudeCompletion?: CompletionFn;
  getKimiCompletion?: CompletionFn;
  getOllamaCompletion?: CompletionFn;
  loadSettings?: () => Promise<LoadSettingsResult>;
}

// No `declare global` augmentation here on purpose: the host app already
// declares a (richer) global `Window.electronAPI: ElectronAPI` type in
// `client/src/services/electron.bridge.ts`, and TS requires merged global
// interface augmentations to match exactly. Read through this narrow local
// cast instead, so AgentVerse stays decoupled from the host's full API shape.
export const getElectronAIApi = (): ElectronAIApi | undefined =>
  typeof window !== 'undefined' ? (window as unknown as { electronAPI?: ElectronAIApi }).electronAPI : undefined;

/** True when the host exposes at least one usable AI completion endpoint. */
export function hasElectronAI(): boolean {
  const api = getElectronAIApi();
  return !!(
    api &&
    (api.getGeminiCompletion ||
      api.getClaudeCompletion ||
      api.getKimiCompletion ||
      api.getOllamaCompletion)
  );
}
