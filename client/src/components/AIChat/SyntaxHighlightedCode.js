import React from 'react';
import './SyntaxHighlightedCode.css';

// Regex-based tokenizer — no external deps
const TOKENS = [
  { type: 'comment',  re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/ },
  { type: 'string',   re: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/ },
  { type: 'keyword',  re: /\b(import|export|from|default|const|let|var|function|return|async|await|class|extends|new|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|typeof|instanceof|in|of|this|super|static|public|private|readonly|interface|type|enum|void|null|undefined|true|false)\b/ },
  { type: 'type',     re: /\b([A-Z][a-zA-Z0-9]*)\b/ },
  { type: 'fn',       re: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/ },
  { type: 'number',   re: /\b(\d+(?:\.\d+)?)\b/ },
  { type: 'operator', re: /([=<>!+\-*/&|^~%]+|[?:,;.])/ },
];

const COMBINED = new RegExp(TOKENS.map(t => `(${t.re.source})`).join('|'), 'g');

const highlight = (code) => {
  const parts = [];
  let last = 0;
  let m;
  COMBINED.lastIndex = 0;
  while ((m = COMBINED.exec(code)) !== null) {
    if (m.index > last) {
      parts.push(<span key={last}>{code.slice(last, m.index)}</span>);
    }
    const idx = TOKENS.findIndex((_, i) => m[i + 1] !== undefined);
    if (idx >= 0) {
      parts.push(
        <span key={m.index} className={`sh-${TOKENS[idx].type}`}>{m[0]}</span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < code.length) {
    parts.push(<span key={last}>{code.slice(last)}</span>);
  }
  return parts;
};

const SyntaxHighlightedCode = ({ code = '', showLineNumbers = true, maxHeight = '400px' }) => {
  const lines = code.split('\n');
  return (
    <div className="shc-root" style={{ maxHeight }}>
      {showLineNumbers && (
        <div className="shc-gutter">
          {lines.map((_, i) => (
            <span key={i} className="shc-ln">{i + 1}</span>
          ))}
        </div>
      )}
      <pre className="shc-code">
        {lines.map((line, i) => (
          <span key={i} className="shc-line">{highlight(line)}{'\n'}</span>
        ))}
      </pre>
    </div>
  );
};

export default SyntaxHighlightedCode;
