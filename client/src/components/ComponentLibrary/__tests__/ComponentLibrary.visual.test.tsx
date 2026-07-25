/**
 * ComponentLibrary — theme/token "visual regression" coverage.
 *
 * Honesty note on scope: the QA brief asks for screenshot-based visual
 * regression. This project's test runner is `react-scripts test`
 * (Jest + jsdom, no real paint/layout, no Playwright/Puppeteer
 * dependency). jsdom cannot rasterize pixels, and — verified empirically
 * while building this suite — it does not even resolve `var(--token)`
 * references through `getComputedStyle` for standard CSS properties (see
 * client/src/test-utils/colorContrast.ts for the experiment and why
 * contrast checks read tokens.css as text instead). A pixel-diffing
 * screenshot test is therefore out of reach without adding a headless
 * browser to the toolchain, which is a bigger call than this test task.
 *
 * What this file verifies instead, across all 5 themes, is the thing a
 * screenshot test would actually be guarding against regressing:
 *   1. Selecting a theme applies exactly that theme's class to the root
 *      (and only that one — no leftover/duplicate theme classes).
 *   2. Every token swatch/spacing-bar/shadow-card still *references* its
 *      CSS variable (`var(--token)`) rather than a hardcoded fallback
 *      color that would silently stop tracking the active theme.
 *   3. A snapshot of the resolved hex values per theme (parsed straight
 *      from tokens.css) — this is the closest text-based analogue to a
 *      visual baseline: any token edit shows up as a diff on review.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';

import ComponentLibrary from '../ComponentLibrary';
import { parseThemeTokens } from '../../../test-utils/colorContrast';

// Mirrors THEMES in ComponentLibrary.tsx — kept as a local literal (rather
// than exported from the component) since it's the dev-only showcase's
// own concern; if it drifts, the "renders exactly 5 theme options" test
// below will fail loudly and point back here.
const THEMES = [
  { id: 'theme-midnight', label: 'Midnight Blue' },
  { id: 'theme-amber', label: 'Amber Terminal' },
  { id: 'theme-mint', label: 'Mint Hacker' },
  { id: 'theme-paper', label: 'Paper Light' },
  { id: 'theme-violet', label: 'Violet Dream' }
];

// Mirrors SWATCH_TOKENS / SPACING_TOKENS / SHADOW_TOKENS in
// ComponentLibrary.tsx. Used to assert the *labels* actually rendered per
// theme match what the source declares (order included, since it's a
// straight .map()). Note what this deliberately does NOT do: read back
// each element's resolved `background`/`width`/`box-shadow` via
// getComputedStyle/getAttribute('style'). Verified empirically — jsdom's
// style engine (cssstyle) rejects `var(--x)` as an invalid value for
// typed CSS properties (background-color, width, box-shadow, ...) and
// silently drops it, so `element.getAttribute('style')` comes back `""`
// even though React set `style={{ width: 'var(--space-4)' }}` correctly.
// (Contrast: reading a *custom property's own* value, e.g. `--bg` on
// `<body>`, does resolve — only substitution *inside other properties*
// is unsupported.) The `var(${token})` wiring itself is instead verified
// once, directly against the source below, which is the reliable way to
// catch a hardcoded-fallback-color regression under this toolchain.
const SWATCH_TOKENS = ['--bg', '--surface', '--surface-2', '--border', '--accent', '--accent-2', '--accent-3', '--success', '--warning', '--danger'];
const SPACING_TOKENS = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10', '--space-12', '--space-16'];
const SHADOW_TOKENS = ['--shadow-1', '--shadow-2', '--shadow-3', '--shadow-4'];

const selectTheme = (label: string) => {
  fireEvent.click(screen.getByRole('radio', { name: label }));
};

describe('ComponentLibrary — theme switcher', () => {
  test('renders exactly the 5 documented themes as selectable options', () => {
    render(<ComponentLibrary />);
    const switcher = screen.getByRole('radiogroup', { name: 'Choisir un thème' });
    const radios = within(switcher).getAllByRole('radio');
    expect(radios).toHaveLength(THEMES.length);
    THEMES.forEach((t) => expect(within(switcher).getByRole('radio', { name: t.label })).toBeInTheDocument());
  });

  test('Midnight Blue is selected by default', () => {
    render(<ComponentLibrary />);
    expect(screen.getByRole('radio', { name: 'Midnight Blue' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Thème actif : Midnight Blue')).toBeInTheDocument();
  });
});

describe.each(THEMES)('ComponentLibrary — $label theme application', ({ id, label }) => {
  test(`selecting "${label}" applies "${id}" to the root, and no other theme class`, () => {
    const { container } = render(<ComponentLibrary />);
    selectTheme(label);

    const root = container.querySelector('.component-library') as HTMLElement;
    const themeClasses = Array.from(root.classList).filter((c) => c.startsWith('theme-'));
    expect(themeClasses).toEqual([id]);

    expect(screen.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(`Thème actif : ${label}`)).toBeInTheDocument();
  });

  test(`"${label}": renders exactly the 10 documented color-token swatches, in order`, () => {
    const { container } = render(<ComponentLibrary />);
    selectTheme(label);

    const swatches = container.querySelectorAll('.component-library__swatch');
    const labels = Array.from(swatches).map((s) => s.querySelector('code')?.textContent);
    expect(labels).toEqual(SWATCH_TOKENS);

    // Every swatch has its color patch present (the element that carries
    // `background: var(--token)` at runtime — see module docblock for why
    // this test doesn't re-derive the resolved color under jsdom).
    swatches.forEach((swatch) => {
      expect(swatch.querySelector('.component-library__swatch-color')).toBeInTheDocument();
    });
  });

  test(`"${label}": renders the documented spacing rows and shadow cards, in order`, () => {
    const { container } = render(<ComponentLibrary />);
    selectTheme(label);

    const spacingRows = container.querySelectorAll('.component-library__spacing-row');
    expect(Array.from(spacingRows).map((r) => r.querySelector('code')?.textContent)).toEqual(SPACING_TOKENS);

    const shadowCards = container.querySelectorAll('.component-library__shadow-card');
    expect(Array.from(shadowCards).map((c) => c.querySelector('code')?.textContent)).toEqual(SHADOW_TOKENS);
  });

  test(`"${label}": AutonomyControls, MessageViewer, CodeBlock and InputArea all render under this theme without crashing`, () => {
    const { container } = render(<ComponentLibrary />);
    selectTheme(label);

    expect(container.querySelector('.autonomy-controls')).toBeInTheDocument();
    expect(container.querySelector('.message-viewer')).toBeInTheDocument();
    expect(container.querySelector('.code-block')).toBeInTheDocument();
    expect(container.querySelector('.input-area')).toBeInTheDocument();
  });
});

describe('ComponentLibrary — token wiring (source-level, theme-independent)', () => {
  // Runs once, not per theme: the JSX template is identical regardless of
  // which theme is active, so this is where the "still references
  // var(--token) and isn't a hardcoded fallback color" guarantee actually
  // lives (see the failed jsdom runtime-style experiment documented above
  // SWATCH_TOKENS).
  const source = fs.readFileSync(path.resolve(__dirname, '../ComponentLibrary.tsx'), 'utf8');

  test('color swatches are painted via `background: var(${token})`, not a literal color', () => {
    expect(source).toMatch(/background:\s*`var\(\$\{token\}\)`/);
  });

  test('spacing bars are sized via `width: var(${token})`', () => {
    expect(source).toMatch(/width:\s*`var\(\$\{token\}\)`/);
  });

  test('shadow cards use `boxShadow: var(${token})`', () => {
    expect(source).toMatch(/boxShadow:\s*`var\(\$\{token\}\)`/);
  });

  test('type ramp rows use `fontSize: var(${token})`', () => {
    expect(source).toMatch(/fontSize:\s*`var\(\$\{token\}\)`/);
  });
});

describe('ComponentLibrary — token value baseline (text-based visual snapshot)', () => {
  test('resolved hex values per theme match the committed snapshot', () => {
    const cssPath = path.resolve(__dirname, '../../../styles/tokens.css');
    const themes = parseThemeTokens(fs.readFileSync(cssPath, 'utf8'));

    const ordered = THEMES.reduce<Record<string, unknown>>((acc, t) => {
      const name = t.id.replace('theme-', '');
      acc[t.id] = themes[name];
      return acc;
    }, {});

    expect(ordered).toMatchSnapshot();
  });
});
