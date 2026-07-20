import {
  getNavigatorBaseName,
  getNavigatorDirName,
  isNavigatorDescendant,
  isSameNavigatorPath,
  joinNavigatorPath,
  replaceNavigatorPathPrefix
} from './navigatorPaths';

describe('navigatorPaths', () => {
  test('extracts basename and dirname with mixed separators', () => {
    expect(getNavigatorBaseName('backend/src/app.js')).toBe('app.js');
    expect(getNavigatorBaseName('backend\\src\\app.js')).toBe('app.js');
    expect(getNavigatorDirName('backend/src/app.js')).toBe('backend/src');
    expect(getNavigatorDirName('backend\\src\\app.js')).toBe('backend\\src');
  });

  test('joins paths using the existing separator style', () => {
    expect(joinNavigatorPath('backend/src', 'utils.js')).toBe('backend/src/utils.js');
    expect(joinNavigatorPath('backend\\src', 'utils.js')).toBe('backend\\src\\utils.js');
  });

  test('detects descendants and equality', () => {
    expect(isNavigatorDescendant('backend/src/utils/app.js', 'backend/src')).toBe(true);
    expect(isNavigatorDescendant('backend/src', 'backend/src')).toBe(false);
    expect(isSameNavigatorPath('backend/src/app.js', 'backend/src/app.js')).toBe(true);
    expect(isSameNavigatorPath('backend/src/app.js', 'backend\\src\\app.js')).toBe(true);
  });

  test('replaces path prefixes while preserving separator style', () => {
    expect(replaceNavigatorPathPrefix('backend/src/app.js', 'backend/src', 'backend/core')).toBe('backend/core/app.js');
    expect(replaceNavigatorPathPrefix('backend\\src\\app.js', 'backend\\src', 'backend\\core')).toBe('backend\\core\\app.js');
  });
});
