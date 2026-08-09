/**
 * Shared tab model (plan-ia-onglets.md §2 / §③ / §⑤).
 *
 * @typedef {{ type: 'file', path: string }} FileTab
 * @typedef {{ type: 'preview' }} PreviewTab
 * @typedef {{ type: 'settings' }} SettingsTab
 * @typedef {{ type: 'chat', sessionId: string }} ChatTab
 * @typedef {FileTab | PreviewTab | SettingsTab | ChatTab} Tab
 *
 * Identity rule (§2): a tab is identified by its `type` plus discriminant
 * (`path` for a file, `sessionId` for a chat). Two tabs never share the same
 * identity. `preview` and `settings` are singletons: no discriminant, so
 * only one of each can ever exist. `chat` is not a singleton (§⑤ 5.5.1):
 * n chat tabs can be open at once, one per session.
 */

export const createFileTab = (path) => ({ type: 'file', path });
export const createChatTab = (sessionId) => ({ type: 'chat', sessionId });

export const tabIdentity = (tab) => {
  if (!tab) return undefined;
  if (tab.type === 'file') return `file:${tab.path}`;
  if (tab.type === 'chat') return `chat:${tab.sessionId}`;
  return tab.type;
};

export const isSameTab = (a, b) => (
  Boolean(a) && Boolean(b) && tabIdentity(a) === tabIdentity(b)
);

/**
 * Normalizes a persisted tab list into valid Tab[].
 *
 * Accepts both the current format (Tab[]) and the legacy pre-③ format
 * (openFiles: string[]) so an existing user's session reloads without error
 * or loss: every legacy string becomes `{ type: 'file', path }`. Invalid
 * entries are dropped and duplicate identities are collapsed, keeping the
 * first occurrence.
 *
 * @param {unknown} rawTabs
 * @returns {Tab[]}
 */
export const normalizeOpenTabs = (rawTabs) => {
  if (!Array.isArray(rawTabs)) return [];
  const seen = new Set();
  const tabs = [];

  rawTabs.forEach((raw) => {
    let tab = null;

    if (typeof raw === 'string') {
      // Legacy format: openFiles was string[] before plan-ia-onglets.md ③.
      const path = raw.trim();
      if (path) tab = createFileTab(path);
    } else if (raw && typeof raw === 'object') {
      if (raw.type === 'file' && typeof raw.path === 'string' && raw.path.trim()) {
        tab = createFileTab(raw.path);
      } else if (raw.type === 'preview') {
        tab = { type: 'preview' };
      } else if (raw.type === 'settings') {
        tab = { type: 'settings' };
      } else if (raw.type === 'chat' && typeof raw.sessionId === 'string' && raw.sessionId.trim()) {
        tab = createChatTab(raw.sessionId);
      }
    }

    if (!tab) return;
    const identity = tabIdentity(tab);
    if (seen.has(identity)) return;
    seen.add(identity);
    tabs.push(tab);
  });

  return tabs;
};
