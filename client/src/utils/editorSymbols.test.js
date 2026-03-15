import {
  extractEditorSymbols,
  filterEditorSymbols,
  findActiveEditorSymbol,
  getEditorSymbolKindIcon,
  getEditorSymbolKindLabel
} from './editorSymbols';

describe('editorSymbols', () => {
  test('extracts javascript and typescript symbols', () => {
    const content = [
      'export function loadUser() {}',
      'const App = () => null;',
      'class Store {}',
      'interface User {}'
    ].join('\n');

    const symbols = extractEditorSymbols('src/app.tsx', content);
    expect(symbols.map((item) => item.symbol)).toEqual(['loadUser', 'App', 'Store', 'User']);
  });

  test('extracts markdown headings and yaml properties', () => {
    const markdown = extractEditorSymbols('README.md', '# Intro\n## Usage');
    expect(markdown.map((item) => item.symbol)).toEqual(['Intro', 'Usage']);

    const yaml = extractEditorSymbols('config.yml', 'server:\n  port: 3000');
    expect(yaml.map((item) => item.symbol)).toEqual(['server', 'port']);
  });

  test('filters symbols and finds the active symbol from line', () => {
    const symbols = extractEditorSymbols('src/app.js', 'function alpha() {}\n\nfunction beta() {}\n');
    expect(filterEditorSymbols(symbols, 'bet').map((item) => item.symbol)).toEqual(['beta']);
    expect(findActiveEditorSymbol(symbols, 3)?.symbol).toBe('beta');
  });

  test('returns stable labels and icons', () => {
    expect(getEditorSymbolKindLabel('function')).toBe('Function');
    expect(getEditorSymbolKindIcon('class')).toBe('C');
    expect(getEditorSymbolKindLabel('heading-2')).toBe('Heading');
  });
});
