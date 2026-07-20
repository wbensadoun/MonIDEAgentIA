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

declare global {
  interface Window {
    electronAPI?: ElectronAIApi;
  }
}

/** True when the host exposes at least one usable AI completion endpoint. */
export function hasElectronAI(): boolean {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  return !!(
    api &&
    (api.getGeminiCompletion ||
      api.getClaudeCompletion ||
      api.getKimiCompletion ||
      api.getOllamaCompletion)
  );
}
