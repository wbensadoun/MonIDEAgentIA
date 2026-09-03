/**
 * ComponentLibrary — internal showcase/docs page for the design system.
 *
 * Dev-only: the default export refuses to render outside development
 * builds (see `isDevEnvironment` below) so it can never accidentally ship
 * as a reachable surface in production — mount it behind a dev-only route
 * (e.g. `/__components`) or open it standalone while iterating. It
 * exercises every new component against every existing theme so
 * regressions are visible before they reach AIChat/index.js call sites.
 *
 * No test framework wiring here (kept to plain React) — the goal is a
 * visual reference, not a substitute for AIChat.test.js-style unit tests.
 */
import React, { useMemo, useState } from 'react';
import AutonomyControls, { AutonomyLevel, ExecutionModeId } from '../AIChat/AutonomyControls';
import MessageViewer, { ChatMessage } from '../AIChat/MessageViewer';
import CodeBlock from '../AIChat/CodeBlock';
import InputArea, { AttachedFile } from '../AIChat/InputArea';
import ChatInterface from '../AIChat/ChatInterface';
import './ComponentLibrary.css';

const THEMES = [
  { id: 'theme-midnight', label: 'Midnight Blue' },
  { id: 'theme-amber', label: 'Amber Terminal' },
  { id: 'theme-mint', label: 'Mint Hacker' },
  { id: 'theme-paper', label: 'Paper Light' },
  { id: 'theme-violet', label: 'Violet Dream' }
];

const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    timestamp: Date.now() - 60000,
    blocks: [{ type: 'text', content: 'Peux-tu refactorer useAI.js pour extraire le parsing de stream ?' }]
  },
  {
    id: 'm2',
    role: 'assistant',
    agentLabel: 'Assistant spécialisé',
    timestamp: Date.now() - 45000,
    blocks: [
      { type: 'text', content: "Voici l'extraction proposée, en attente de ta validation :" },
      {
        type: 'code',
        content: "export function parseStreamChunk(chunk) {\n  return chunk.trim();\n}",
        language: 'js',
        filename: 'client/src/hooks/useAI.js',
        pendingApproval: true
      }
    ]
  }
];

interface SectionMeta {
  id: (typeof SECTION_IDS)[number];
  label: string;
}

const SECTION_IDS = ['tokens', 'autonomy', 'messages', 'code', 'input', 'composed'] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTIONS: SectionMeta[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'autonomy', label: 'AutonomyControls' },
  { id: 'messages', label: 'MessageViewer' },
  { id: 'code', label: 'CodeBlock' },
  { id: 'input', label: 'InputArea' },
  { id: 'composed', label: 'ChatInterface' }
];

const SWATCH_TOKENS = ['--bg', '--surface', '--surface-2', '--border', '--accent', '--accent-2', '--accent-3', '--success', '--warning', '--danger'];

const SPACING_TOKENS = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12', '--space-16'];

const TYPE_TOKENS = ['--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl', '--text-2xl'];

const SHADOW_TOKENS = ['--shadow-1', '--shadow-2', '--shadow-3', '--shadow-4'];

/** Usage snippets shown by Inspect Mode — representative call sites, not
 *  a mirror of each component's full implementation (which the reader can
 *  already open directly under client/src/components/AIChat/*.tsx). */
const INSPECT_SNIPPETS: Record<SectionId, string> = {
  tokens: `/* client/src/styles/tokens.css */\n.my-panel {\n  background: var(--surface);\n  color: var(--text-main);\n  padding: var(--space-4);\n  border-radius: var(--radius-md);\n  box-shadow: var(--shadow-2);\n  font-size: var(--text-md);\n}`,
  autonomy: `<AutonomyControls\n  executionMode={executionMode}\n  onExecutionModeChange={setExecutionMode}\n  autonomyLevel={autonomyLevel}\n  onAutonomyLevelChange={setAutonomyLevel}\n  disabled={isBusy}\n/>`,
  messages: `<MessageViewer\n  messages={messages}\n  isStreaming={isStreaming}\n  streamingText="Je prépare la réponse…"\n  emptyState={<p>Aucun message pour le moment.</p>}\n/>`,
  code: `<CodeBlock\n  code={"export const add = (a, b) => a + b;"}\n  language="ts"\n  filename="client/src/utils/math.ts"\n  pendingApproval\n/>`,
  input: `<InputArea\n  value={inputValue}\n  onChange={setInputValue}\n  onSubmit={handleSubmit}\n  attachments={attachments}\n  onAttach={handleAttach}\n  onRemoveAttachment={handleRemoveAttachment}\n  warning="Mode autonome : les commandes s'exécuteront sans confirmation."\n/>`,
  composed: `<ChatInterface\n  executionMode={executionMode}\n  onExecutionModeChange={setExecutionMode}\n  autonomyLevel={autonomyLevel}\n  onAutonomyLevelChange={setAutonomyLevel}\n  messages={messages}\n  inputValue={inputValue}\n  onInputChange={setInputValue}\n  onSubmit={handleSubmit}\n/>`
};

/** True only in development bundles (CRA/webpack define NODE_ENV at build
 *  time). Guards this page from ever being a reachable surface once the
 *  app is built for production, per the "dev-only" requirement — without
 *  pulling a router dependency the project doesn't otherwise have. */
const isDevEnvironment = process.env.NODE_ENV !== 'production';

export const ComponentLibrary: React.FC = () => {
  const [theme, setTheme] = useState<string>('theme-midnight');
  const [executionMode, setExecutionMode] = useState<ExecutionModeId>('agent');
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('normal');
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [inspectMode, setInspectMode] = useState(false);

  const activeThemeLabel = useMemo(
    () => THEMES.find((t) => t.id === theme)?.label ?? theme,
    [theme]
  );

  if (!isDevEnvironment) {
    return (
      <div className="component-library component-library--disabled" role="alert">
        ComponentLibrary est désactivé en production (dev-only route).
      </div>
    );
  }

  const renderInspect = (id: SectionId) =>
    inspectMode && (
      <div className="component-library__inspect">
        <CodeBlock code={INSPECT_SNIPPETS[id]} language="tsx" showLineNumbers={false} maxHeight="240px" />
      </div>
    );

  return (
    <div className={`component-library ${theme}`}>
      <header className="component-library__header">
        <div>
          <h1>Code Companion — Design System</h1>
          <p>Thème actif : {activeThemeLabel}</p>
        </div>
        <div className="component-library__header-controls">
          <button
            type="button"
            data-focus-ring
            aria-pressed={inspectMode}
            className={`component-library__inspect-toggle${inspectMode ? ' is-active' : ''}`}
            onClick={() => setInspectMode((v) => !v)}
          >
            {inspectMode ? '✓ Inspect mode' : '</> Inspect mode'}
          </button>
          <div className="component-library__theme-switch" role="radiogroup" aria-label="Choisir un thème">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                data-focus-ring
                className={`component-library__theme-btn${theme === t.id ? ' is-active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="component-library__body">
        <nav className="component-library__sidebar" aria-label="Sections">
          <span className="component-library__sidebar-title">Sommaire</span>
          <ul>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} data-focus-ring>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="component-library__main">
          <section id="tokens" className="component-library__section">
            <h2>Design Tokens</h2>

            <h3 className="component-library__subheading">Couleurs</h3>
            <div className="component-library__swatches">
              {SWATCH_TOKENS.map((token) => (
                <div key={token} className="component-library__swatch">
                  <span className="component-library__swatch-color" style={{ background: `var(${token})` }} />
                  <code>{token}</code>
                </div>
              ))}
            </div>

            <h3 className="component-library__subheading">Espacement (8px grid)</h3>
            <div className="component-library__spacing">
              {SPACING_TOKENS.map((token) => (
                <div key={token} className="component-library__spacing-row">
                  <code>{token}</code>
                  <span className="component-library__spacing-bar" style={{ width: `var(${token})` }} />
                </div>
              ))}
            </div>

            <h3 className="component-library__subheading">Typographie</h3>
            <div className="component-library__type-ramp">
              {TYPE_TOKENS.map((token) => (
                <div key={token} className="component-library__type-row" style={{ fontSize: `var(${token})` }}>
                  <span>Aa {token}</span>
                </div>
              ))}
            </div>

            <h3 className="component-library__subheading">Ombres</h3>
            <div className="component-library__shadows">
              {SHADOW_TOKENS.map((token) => (
                <div key={token} className="component-library__shadow-card" style={{ boxShadow: `var(${token})` }}>
                  <code>{token}</code>
                </div>
              ))}
            </div>

            {renderInspect('tokens')}
          </section>

          <section id="autonomy" className="component-library__section">
            <h2>AutonomyControls</h2>
            <AutonomyControls
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              autonomyLevel={autonomyLevel}
              onAutonomyLevelChange={setAutonomyLevel}
              isDeveloperMode={false}
            />
            {renderInspect('autonomy')}
          </section>

          <section id="messages" className="component-library__section">
            <h2>MessageViewer</h2>
            <div className="component-library__frame" style={{ height: 320 }}>
              <MessageViewer messages={SAMPLE_MESSAGES} isStreaming streamingText="Je prépare la réponse…" />
            </div>
            {renderInspect('messages')}
          </section>

          <section id="code" className="component-library__section">
            <h2>CodeBlock</h2>
            <CodeBlock
              code={"export const add = (a, b) => a + b;"}
              language="ts"
              filename="client/src/utils/math.ts"
            />
            {renderInspect('code')}
          </section>

          <section id="input" className="component-library__section">
            <h2>InputArea</h2>
            <div className="component-library__frame">
              <InputArea
                value={inputValue}
                onChange={setInputValue}
                onSubmit={() => setInputValue('')}
                attachments={attachments}
                onAttach={(files) =>
                  setAttachments((prev) => [
                    ...prev,
                    ...Array.from(files).map((f, i) => ({ id: `${f.name}-${i}-${Date.now()}`, name: f.name, size: f.size }))
                  ])
                }
                onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((f) => f.id !== id))}
                warning={autonomyLevel === 'permissive' ? 'Mode autonome : les commandes terminal s\'exécuteront sans confirmation.' : undefined}
              />
            </div>
            {renderInspect('input')}
          </section>

          <section id="composed" className="component-library__section">
            <h2>ChatInterface (composed)</h2>
            <div className="component-library__frame" style={{ height: 480 }}>
              <ChatInterface
                executionMode={executionMode}
                onExecutionModeChange={setExecutionMode}
                autonomyLevel={autonomyLevel}
                onAutonomyLevelChange={setAutonomyLevel}
                messages={SAMPLE_MESSAGES}
                inputValue={inputValue}
                onInputChange={setInputValue}
                onSubmit={() => setInputValue('')}
              />
            </div>
            {renderInspect('composed')}
          </section>
        </main>
      </div>
    </div>
  );
};

export default ComponentLibrary;
