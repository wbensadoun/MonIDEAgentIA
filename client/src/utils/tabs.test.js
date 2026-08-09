import {
  createFileTab,
  createChatTab,
  tabIdentity,
  isSameTab,
  normalizeOpenTabs
} from './tabs';

// plan-ia-onglets.md §⑤ 5.5.1 — chat tabs { type: 'chat', sessionId } join
// the existing Tab[] model (§9: no second tab system for chat). Unlike
// 'preview'/'settings' (singletons), 'chat' is identified by sessionId, so
// n instances can coexist — one per open session.

test('createChatTab builds a { type: chat, sessionId } tab', () => {
  expect(createChatTab('sess_1')).toEqual({ type: 'chat', sessionId: 'sess_1' });
});

test('tabIdentity distinguishes chat tabs by sessionId, not just type', () => {
  expect(tabIdentity(createChatTab('sess_1'))).toBe('chat:sess_1');
  expect(tabIdentity(createChatTab('sess_2'))).toBe('chat:sess_2');
  expect(tabIdentity(createChatTab('sess_1'))).not.toBe(tabIdentity(createChatTab('sess_2')));
});

test('isSameTab treats two chat tabs with the same sessionId as identical (§2 identity rule)', () => {
  expect(isSameTab(createChatTab('sess_1'), createChatTab('sess_1'))).toBe(true);
  expect(isSameTab(createChatTab('sess_1'), createChatTab('sess_2'))).toBe(false);
  expect(isSameTab(createChatTab('sess_1'), createFileTab('sess_1'))).toBe(false);
});

test('normalizeOpenTabs accepts chat tabs and drops one with a missing/blank sessionId', () => {
  expect(normalizeOpenTabs([
    { type: 'chat', sessionId: 'sess_1' },
    { type: 'chat', sessionId: '' }, // blank — dropped
    { type: 'chat' }, // missing sessionId — dropped
    { type: 'chat', sessionId: 'sess_1' } // duplicate identity — collapsed
  ])).toEqual([
    { type: 'chat', sessionId: 'sess_1' }
  ]);
});

test('normalizeOpenTabs round-trips a mix of file, preview, settings and chat tabs', () => {
  const tabs = [
    { type: 'file', path: 'src/App.js' },
    { type: 'preview' },
    { type: 'settings' },
    { type: 'chat', sessionId: 'sess_1' },
    { type: 'chat', sessionId: 'sess_2' }
  ];
  expect(normalizeOpenTabs(tabs)).toEqual(tabs);
});
