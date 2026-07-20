const getExtension = (filePath) => {
  const value = String(filePath || '').toLowerCase();
  const idx = value.lastIndexOf('.');
  return idx >= 0 ? value.slice(idx) : '';
};

const createSymbol = (kind, symbol, line, column, text) => ({
  id: `${kind}:${symbol}:${line}:${column}`,
  kind,
  symbol,
  line,
  column,
  text: String(text || '').trim()
});

const extractJavaScriptLikeSymbols = (lines) => {
  const matchers = [
    { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
    { kind: 'let', regex: /^\s*(?:export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
    { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'enum', regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ }
  ];

  const symbols = [];
  lines.forEach((lineText, index) => {
    for (const matcher of matchers) {
      const match = lineText.match(matcher.regex);
      if (!match) continue;
      const symbol = String(match[1] || '').trim();
      if (!symbol) continue;
      symbols.push(createSymbol(matcher.kind, symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
      break;
    }
  });
  return symbols;
};

const extractPythonSymbols = (lines) => {
  const symbols = [];
  lines.forEach((lineText, index) => {
    let match = lineText.match(/^\s*def\s+([A-Za-z_][\w]*)\s*\(/);
    if (match) {
      const symbol = match[1];
      symbols.push(createSymbol('function', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
      return;
    }

    match = lineText.match(/^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(|:)/);
    if (match) {
      const symbol = match[1];
      symbols.push(createSymbol('class', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
    }
  });
  return symbols;
};

const extractMarkdownSymbols = (lines) => {
  const symbols = [];
  lines.forEach((lineText, index) => {
    const match = lineText.match(/^\s*(#{1,6})\s+(.+)/);
    if (!match) return;
    const symbol = String(match[2] || '').trim();
    if (!symbol) return;
    symbols.push(createSymbol(`heading-${match[1].length}`, symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
  });
  return symbols;
};

const extractJsonYamlSymbols = (lines) => {
  const symbols = [];
  lines.forEach((lineText, index) => {
    let match = lineText.match(/^\s*"([^"]+)"\s*:/);
    if (!match) {
      match = lineText.match(/^\s*([A-Za-z0-9_.-]+)\s*:/);
    }
    if (!match) return;
    const symbol = String(match[1] || '').trim();
    if (!symbol) return;
    symbols.push(createSymbol('property', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
  });
  return symbols;
};

const extractCssSymbols = (lines) => {
  const symbols = [];
  lines.forEach((lineText, index) => {
    const match = lineText.match(/^\s*([.#]?[A-Za-z_][\w\-.:#\s>[+~]*)\s*\{/);
    if (!match) return;
    const symbol = String(match[1] || '').trim();
    if (!symbol || symbol.startsWith('@')) return;
    symbols.push(createSymbol('selector', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
  });
  return symbols;
};

const extractHtmlSymbols = (lines) => {
  const symbols = [];
  lines.forEach((lineText, index) => {
    const idMatch = lineText.match(/id="([^"]+)"/);
    if (idMatch) {
      const symbol = idMatch[1];
      symbols.push(createSymbol('id', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
      return;
    }
    const sectionMatch = lineText.match(/<([A-Za-z][\w-]*)/);
    if (sectionMatch) {
      const symbol = sectionMatch[1];
      symbols.push(createSymbol('tag', symbol, index + 1, Math.max(1, lineText.indexOf(symbol) + 1), lineText));
    }
  });
  return symbols;
};

export const getEditorSymbolKindLabel = (kind) => {
  const value = String(kind || '');
  if (value.startsWith('heading-')) return 'Heading';
  const labels = {
    function: 'Function',
    class: 'Class',
    const: 'Const',
    let: 'Let',
    type: 'Type',
    interface: 'Interface',
    enum: 'Enum',
    property: 'Property',
    selector: 'Selector',
    id: 'ID',
    tag: 'Tag'
  };
  return labels[value] || 'Symbol';
};

export const getEditorSymbolKindIcon = (kind) => {
  const value = String(kind || '');
  if (value.startsWith('heading-')) return '#';
  const icons = {
    function: 'ƒ',
    class: 'C',
    const: 'K',
    let: 'L',
    type: 'T',
    interface: 'I',
    enum: 'E',
    property: 'P',
    selector: 'S',
    id: '#',
    tag: '<>'
  };
  return icons[value] || '•';
};

export const extractEditorSymbols = (filePath, content) => {
  const ext = getExtension(filePath);
  const lines = String(content || '').split('\n');

  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    return extractJavaScriptLikeSymbols(lines);
  }
  if (ext === '.py') {
    return extractPythonSymbols(lines);
  }
  if (ext === '.md') {
    return extractMarkdownSymbols(lines);
  }
  if (['.json', '.yml', '.yaml'].includes(ext)) {
    return extractJsonYamlSymbols(lines);
  }
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
    return extractCssSymbols(lines);
  }
  if (ext === '.html') {
    return extractHtmlSymbols(lines);
  }

  return extractJavaScriptLikeSymbols(lines);
};

export const filterEditorSymbols = (symbols, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return Array.isArray(symbols) ? symbols : [];
  return (Array.isArray(symbols) ? symbols : []).filter((symbol) => {
    const hay = `${symbol.symbol} ${symbol.kind} ${symbol.text}`.toLowerCase();
    return hay.includes(normalizedQuery);
  });
};

export const findActiveEditorSymbol = (symbols, lineNumber) => {
  const targetLine = Math.max(1, Number(lineNumber) || 1);
  let active = null;
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    if (!symbol || typeof symbol.line !== 'number') continue;
    if (symbol.line <= targetLine) {
      active = symbol;
    } else {
      break;
    }
  }
  return active;
};
