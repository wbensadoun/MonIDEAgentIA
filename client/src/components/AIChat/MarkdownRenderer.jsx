import React, { useState, useCallback, useMemo } from 'react';

/**
 * MarkdownRenderer — lightweight Markdown-to-JSX renderer.
 */

/**
 * Syntax-highlight a code string using simple regex rules.
 * Returns an array of React elements.
 */
const highlightCode = (code, language) => {
  const lines = code.split('\n');
  return lines.map((line, i) => {
    const tokens = tokenizeLine(line, language);
    return (
      <div key={i} className="md-code-line">
        <span className="md-code-ln">{i + 1}</span>
        <span className="md-code-content">{tokens}</span>
      </div>
    );
  });
};

const TOKEN_RULES = [
  // comments
  { regex: /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm, className: 'md-tok-comment' },
  // strings
  { regex: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, className: 'md-tok-string' },
  // keywords (JS/TS/Python/Go/Rust/Java/C++)
  {
    regex: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|true|false|null|undefined|void|yield|static|super|def|self|print|lambda|pass|with|as|elif|raise|except|None|True|False|fn|pub|mod|use|impl|struct|enum|trait|match|loop|mut|ref|crate|type|interface|package|func|defer|go|chan|select|range|map|fmt|println|public|private|protected|final|abstract|synchronized|volatile|transient|native)\b/g,
    className: 'md-tok-keyword'
  },
  // numbers
  { regex: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\b/gi, className: 'md-tok-number' },
  // function calls
  { regex: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, className: 'md-tok-function' },
];

const tokenizeLine = (line, _language) => {
  if (!line) return line;

  // Build a list of { start, end, className, text }
  const spans = [];
  for (const rule of TOKEN_RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let m;
    while ((m = re.exec(line)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, className: rule.className, text: m[0] });
    }
  }

  if (spans.length === 0) return line;

  // Sort by start, remove overlapping (first match wins)
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  let lastEnd = 0;
  for (const span of spans) {
    if (span.start < lastEnd) continue; // overlap
    merged.push(span);
    lastEnd = span.end;
  }

  // Build JSX
  const result = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const span = merged[i];
    if (cursor < span.start) {
      result.push(line.slice(cursor, span.start));
    }
    result.push(
      <span key={`${i}-${span.start}`} className={span.className}>{span.text}</span>
    );
    cursor = span.end;
  }
  if (cursor < line.length) {
    result.push(line.slice(cursor));
  }
  return result;
};

/* ── code block component ─────────────────────────────── */

const CodeBlock = ({ language, code, onCopy, onApply }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
    if (onCopy) onCopy(code);
  }, [code, onCopy]);

  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{language || 'text'}</span>
        <div className="md-codeblock-actions">
          {onApply && (
            <button
              type="button"
              className="md-codeblock-btn md-codeblock-apply"
              onClick={() => onApply(code, language)}
              title="Appliquer dans l'éditeur"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Appliquer
            </button>
          )}
          <button
            type="button"
            className="md-codeblock-btn"
            onClick={handleCopy}
            title="Copier le code"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copié !
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copier
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="md-codeblock-body">
        <code>{highlighted}</code>
      </pre>
    </div>
  );
};

/* ── inline markdown parser ───────────────────────────── */

const parseInline = (text) => {
  if (!text) return text;

  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Find the earliest match among inline patterns
    let earliest = null;
    let earliestIdx = remaining.length;

    const patterns = [
      // bold+italic
      { re: /\*\*\*(.+?)\*\*\*/, render: (m) => <strong key={key++}><em>{parseInline(m[1])}</em></strong> },
      // bold
      { re: /\*\*(.+?)\*\*/, render: (m) => <strong key={key++}>{parseInline(m[1])}</strong> },
      // italic
      { re: /\*(.+?)\*/, render: (m) => <em key={key++}>{parseInline(m[1])}</em> },
      // inline code
      { re: /`([^`]+?)`/, render: (m) => <code key={key++} className="md-inline-code">{m[1]}</code> },
      // link
      { re: /\[([^\]]+?)\]\(([^)]+?)\)/, render: (m) => <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className="md-link">{m[1]}</a> },
    ];

    for (const pat of patterns) {
      const match = pat.re.exec(remaining);
      if (match && match.index < earliestIdx) {
        earliest = { match, pat };
        earliestIdx = match.index;
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    // Add text before match
    if (earliestIdx > 0) {
      parts.push(remaining.slice(0, earliestIdx));
    }

    parts.push(earliest.pat.render(earliest.match));
    remaining = remaining.slice(earliestIdx + earliest.match[0].length);
  }

  return parts.length === 1 ? parts[0] : parts;
};

/* ── block-level parser ───────────────────────────────── */

const parseMarkdown = (text, onCopy, onApply) => {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block (``` or ~~~)
    const codeMatch = line.match(/^```(\w*)\s*$/);
    if (codeMatch) {
      const lang = codeMatch[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(
        <CodeBlock
          key={key++}
          language={lang}
          code={codeLines.join('\n')}
          onCopy={onCopy}
          onApply={onApply}
        />
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={key++} className={`md-heading md-h${level}`}>
          {parseInline(headingMatch[2])}
        </Tag>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="md-blockquote">
          {parseInline(quoteLines.join('\n'))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items.map((item, j) => (
            <li key={j} className="md-li">{parseInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items.map((item, j) => (
            <li key={j} className="md-li">{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — gather contiguous non-empty non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[-*+]\s+/) &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].match(/^>\s/) &&
      !lines[i].match(/^(-{3,}|_{3,}|\*{3,})\s*$/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="md-paragraph">
        {parseInline(paraLines.join('\n'))}
      </p>
    );
  }

  return blocks;
};

/* ── main component ───────────────────────────────────── */

const MarkdownRenderer = ({ text, onCopy, onApply }) => {
  const rendered = useMemo(
    () => parseMarkdown(text, onCopy, onApply),
    [text, onCopy, onApply]
  );

  return <div className="md-root">{rendered}</div>;
};

export default MarkdownRenderer;
export { CodeBlock, parseInline, parseMarkdown, highlightCode };
