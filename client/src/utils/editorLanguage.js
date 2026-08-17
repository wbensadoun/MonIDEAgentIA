// Extension -> Monaco language id. Shared by CodeEditor (drives Monaco
// syntax highlighting) and WorkspaceLayout (drives the shell-level tab
// breadcrumb) so the two never drift out of sync.
export const getLanguageForFile = (filePath) => {
  if (!filePath) return 'plaintext';
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sh') || lower.endsWith('.ps1') || lower.endsWith('.bat')) return 'shell';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.cpp') || lower.endsWith('.c') || lower.endsWith('.h') || lower.endsWith('.hpp')) return 'cpp';
  return 'plaintext';
};
