/**
 * CodeBlock — syntax-highlighted code with copy affordance and optional
 * filename/diff header. Wraps the existing regex tokenizer in
 * SyntaxHighlightedCode.js (client/src/components/AIChat/SyntaxHighlightedCode.js)
 * rather than replacing it — it already handles the common languages used
 * in this codebase (JS/TS/CSS) with zero external deps, which matters given
 * the CPU-only Ollama constraint on model calls but is equally a good
 * constraint for the client bundle: no Prism/Shiki/highlight.js needed.
 */
import React, { useCallback, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import './CodeBlock.css';

export interface CodeBlockProps {
  code: string;
  language?: string;
  /** File path shown in the header, e.g. "client/src/App.js". */
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  /** Marks this block as a proposed diff awaiting approval — pairs with
   *  the "Supervisé" autonomy level in AutonomyControls. */
  pendingApproval?: boolean;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  filename,
  showLineNumbers = true,
  maxHeight = '400px',
  pendingApproval = false,
  className
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (permissions/context) — fail silently,
      // the button simply won't confirm. No sensitive data at stake here.
    }
  }, [code]);

  return (
    <div
      className={['code-block', pendingApproval ? 'code-block--pending' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="code-block__header">
        <span className="code-block__meta">
          {filename && <span className="code-block__filename">{filename}</span>}
          {language && <span className="code-block__lang">{language}</span>}
          {pendingApproval && <span className="code-block__badge">en attente</span>}
        </span>
        <button
          type="button"
          className="code-block__copy"
          data-focus-ring
          onClick={handleCopy}
          aria-label={copied ? 'Copié' : 'Copier le code'}
        >
          {copied ? '✓ Copié' : 'Copier'}
        </button>
      </div>
      <div className="code-block__body">
        <SyntaxHighlightedCode code={code} showLineNumbers={showLineNumbers} maxHeight={maxHeight} />
      </div>
    </div>
  );
};

export default CodeBlock;
