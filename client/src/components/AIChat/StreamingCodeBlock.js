import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * StreamingCodeBlock — animated code streaming with syntax highlighting,
 * line numbers, a glowing cursor, and a file header.
 */

const TOKEN_RULES = [
  { regex: /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm, className: 'sc-tok-comment' },
  { regex: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, className: 'sc-tok-string' },
  {
    regex: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|true|false|null|undefined|void|yield|static|super|def|self|print|lambda|pass|with|as|elif|raise|except|None|True|False|fn|pub|mod|use|impl|struct|enum|trait|match|loop|mut|ref|crate|type|interface|package|func|defer|go|chan|select|range|map|fmt|println|public|private|protected|final|abstract)\b/g,
    className: 'sc-tok-keyword'
  },
  { regex: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\b/gi, className: 'sc-tok-number' },
  { regex: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, className: 'sc-tok-function' },
];

const tokenizeLine = (line) => {
  if (!line) return [line || ''];

  const spans = [];
  for (const rule of TOKEN_RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let m;
    while ((m = re.exec(line)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, className: rule.className, text: m[0] });
    }
  }

  if (spans.length === 0) return [line];

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  let lastEnd = 0;
  for (const span of spans) {
    if (span.start < lastEnd) continue;
    merged.push(span);
    lastEnd = span.end;
  }

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

const StreamingCodeBlock = ({
  code = '',
  filePath = '',
  language = '',
  isStreaming = true,
  agent = ''
}) => {
  const containerRef = useRef(null);
  const [visibleLines, setVisibleLines] = useState(0);
  const prevLineCountRef = useRef(0);

  const lines = useMemo(() => {
    if (!code) return [];
    return code.split('\n');
  }, [code]);

  // Reveal lines progressively with animation
  useEffect(() => {
    if (!isStreaming) {
      setVisibleLines(lines.length);
      return;
    }

    const newLineCount = lines.length;
    const prevCount = prevLineCountRef.current;

    if (newLineCount > prevCount) {
      // Animate the reveal of new lines
      let current = prevCount;
      const reveal = () => {
        current++;
        setVisibleLines(current);
        if (current < newLineCount) {
          requestAnimationFrame(reveal);
        }
      };
      requestAnimationFrame(reveal);
    }

    prevLineCountRef.current = newLineCount;
  }, [lines.length, isStreaming, lines]);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  const fileName = useMemo(() => {
    if (!filePath) return '';
    return filePath.split(/[/\\]/).pop() || filePath;
  }, [filePath]);

  const langLabel = (language || 'text').toLowerCase();

  return (
    <div className="sc-block">
      {/* Header */}
      <div className="sc-header">
        <div className="sc-header-left">
          <span className="sc-dot sc-dot-1" />
          <span className="sc-dot sc-dot-2" />
          <span className="sc-dot sc-dot-3" />
          {fileName && <span className="sc-filename">{fileName}</span>}
          {!fileName && filePath && <span className="sc-filename">{filePath}</span>}
        </div>
        <div className="sc-header-right">
          {agent && <span className="sc-agent">{agent}</span>}
          <span className="sc-lang">{langLabel}</span>
          <span className="sc-counter">
            {lines.length} ligne{lines.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Code body */}
      <div className="sc-body" ref={containerRef}>
        <div className="sc-lines">
          {lines.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className={`sc-line ${i === visibleLines - 1 && isStreaming ? 'sc-line-latest' : ''}`}
              style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}
            >
              <span className="sc-ln">{i + 1}</span>
              <span className="sc-content">{tokenizeLine(line)}</span>
            </div>
          ))}
        </div>

        {/* Glowing cursor */}
        {isStreaming && (
          <div className="sc-cursor-line">
            <span className="sc-cursor" />
          </div>
        )}

        {/* Scanline effect */}
        {isStreaming && <div className="sc-scanline" />}
      </div>

      {/* Progress bar */}
      {isStreaming && (
        <div className="sc-progress">
          <div className="sc-progress-bar">
            <div className="sc-progress-fill" />
          </div>
          <span className="sc-progress-label">
            {lines.length} ligne{lines.length !== 1 ? 's' : ''} reçue{lines.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
};

export default StreamingCodeBlock;
