const DEFAULT_WORKFLOW_OLLAMA_MODEL = 'qwen3:8b';

export const normalizeWorkflowProvider = (value) => {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'kimi' || provider === 'ollama') return provider;
  return 'gemini';
};

export const buildWorkflowAIInvocation = ({ provider, prompt, projectPath }) => {
  const normalizedProvider = normalizeWorkflowProvider(provider);
  const history = [{ role: 'user', text: String(prompt || '') }];
  const baseArgs = [history, '', [], { projectPath }];

  if (normalizedProvider === 'kimi') {
    return {
      provider: normalizedProvider,
      methodName: 'getKimiCompletion',
      args: [
        history,
        '',
        [],
        {
          model: 'moonshotai/Kimi-K2.5',
          projectPath,
          fastMode: true,
          reactMode: false,
          streamResponse: false,
          includeProjectContext: false,
          includeGlobalSkills: false,
          maxTokens: 1536
        }
      ]
    };
  }

  if (normalizedProvider === 'ollama') {
    return {
      provider: normalizedProvider,
      methodName: 'getOllamaCompletion',
      args: [
        history,
        '',
        [],
        {
          model: DEFAULT_WORKFLOW_OLLAMA_MODEL,
          projectPath,
          maxTokens: 1536
        }
      ]
    };
  }

  return {
    provider: normalizedProvider,
    methodName: 'getGeminiCompletion',
    args: baseArgs
  };
};

const stripOuterParens = (value) => {
  let current = String(value || '').trim();
  let changed = true;

  while (changed && current.startsWith('(') && current.endsWith(')')) {
    changed = false;
    let depth = 0;
    let enclosed = true;
    let quote = null;

    for (let index = 0; index < current.length; index += 1) {
      const char = current[index];
      const previousChar = current[index - 1];

      if (quote) {
        if (char === quote && previousChar !== '\\') {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === '\'' || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;

      if (depth === 0 && index < current.length - 1) {
        enclosed = false;
        break;
      }
    }

    if (enclosed) {
      current = current.slice(1, -1).trim();
      changed = true;
    }
  }

  return current;
};

const splitTopLevel = (expression, operator) => {
  const source = String(expression || '');
  let depth = 0;
  let quote = null;

  for (let index = 0; index <= source.length - operator.length; index += 1) {
    const char = source[index];
    const previousChar = source[index - 1];

    if (quote) {
      if (char === quote && previousChar !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && source.slice(index, index + operator.length) === operator) {
      return [source.slice(0, index).trim(), source.slice(index + operator.length).trim()];
    }
  }

  return null;
};

const getByPath = (source, rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return undefined;

  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return acc[key];
  }, source);
};

const parseQuotedString = (token) => {
  const trimmed = String(token || '').trim();
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== '\'' && quote !== '`') || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  return trimmed.slice(1, -1).replace(/\\(['"`\\])/g, '$1');
};

const resolveWorkflowValue = (token, context) => {
  const normalized = stripOuterParens(token);
  const quoted = parseQuotedString(normalized);
  if (quoted !== null) return quoted;

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;
  if (normalized === 'undefined') return undefined;

  if ((normalized.startsWith('{') && normalized.endsWith('}')) || (normalized.startsWith('[') && normalized.endsWith(']'))) {
    try {
      return JSON.parse(normalized);
    } catch {
      // fall through
    }
  }

  if (/^[A-Za-z_$][\w$.]*$/.test(normalized)) {
    const rootSegment = normalized.split('.')[0];
    if (Object.prototype.hasOwnProperty.call(context, rootSegment)) {
      return getByPath(context, normalized);
    }
  }

  return normalized;
};

const compareValues = (left, right, operator) => {
  switch (operator) {
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '<':
      return left < right;
    default:
      return false;
  }
};

export const evaluateWorkflowCondition = (expression, context = {}) => {
  const normalized = stripOuterParens(expression);
  if (!normalized) return true;

  const orSplit = splitTopLevel(normalized, '||');
  if (orSplit) {
    return evaluateWorkflowCondition(orSplit[0], context) || evaluateWorkflowCondition(orSplit[1], context);
  }

  const andSplit = splitTopLevel(normalized, '&&');
  if (andSplit) {
    return evaluateWorkflowCondition(andSplit[0], context) && evaluateWorkflowCondition(andSplit[1], context);
  }

  if (normalized.startsWith('!')) {
    return !evaluateWorkflowCondition(normalized.slice(1), context);
  }

  for (const operator of ['===', '!==', '>=', '<=', '>', '<']) {
    const comparison = splitTopLevel(normalized, operator);
    if (!comparison) continue;
    const left = resolveWorkflowValue(comparison[0], context);
    const right = resolveWorkflowValue(comparison[1], context);
    return compareValues(left, right, operator);
  }

  return Boolean(resolveWorkflowValue(normalized, context));
};
