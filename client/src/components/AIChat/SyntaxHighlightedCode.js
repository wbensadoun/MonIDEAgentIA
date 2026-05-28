import React, { useEffect } from 'react';
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import './SyntaxHighlightedCode.css';

const detectedLanguages = {
  'import ': 'typescript',
  'export ': 'typescript',
  'async ': 'typescript',
  'await ': 'typescript',
  'interface ': 'typescript',
  'type ': 'typescript',
  '{': 'json',
  '[': 'json',
  '<': 'html',
  'SELECT ': 'sql',
  'INSERT ': 'sql',
  'UPDATE ': 'sql'
};

const detectLanguage = (code) => {
  const trimmed = code.trim();

  // Try to detect based on content markers
  for (const [marker, lang] of Object.entries(detectedLanguages)) {
    if (trimmed.includes(marker)) {
      // Prioritize JSON for pure JSON structures
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && lang === 'json') {
        try {
          JSON.parse(trimmed);
          return 'json';
        } catch {
          // Not valid JSON, check for other patterns
        }
      }
      if (lang === 'typescript') return lang;
    }
  }

  // Default to JavaScript if it looks like code
  if (trimmed.includes('function ') || trimmed.includes('const ') || trimmed.includes('let ')) {
    return 'javascript';
  }

  return 'plaintext';
};

const SyntaxHighlightedCode = ({
  code = '',
  language = null,
  showLineNumbers = true,
  maxHeight = '400px'
}) => {
  const codeRef = React.useRef(null);
  const detectedLang = language || detectLanguage(code);
  const lines = code.split('\n');
  const lineCount = lines.length;

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, detectedLang]);

  return (
    <div className="syntax-highlighted-container" style={{ maxHeight }}>
      {showLineNumbers && (
        <div className="syntax-gutter">
          {lines.map((_, i) => (
            <span key={i} className="syntax-line-number">{i + 1}</span>
          ))}
        </div>
      )}
      <pre className={`syntax-code-wrapper${showLineNumbers ? ' with-gutter' : ''}`}>
        <code
          ref={codeRef}
          className={`language-${detectedLang}`}
        >
          {code}
        </code>
      </pre>
    </div>
  );
};

export default SyntaxHighlightedCode;
