/**
 * colorContrast — WCAG 2.x contrast-ratio helpers for design-token audits.
 *
 * Why this exists instead of `getComputedStyle` in jsdom:
 * jsdom's CSS engine (cssstyle) resolves a custom property's own value
 * (e.g. reading `--bg` back off an element) but does NOT substitute
 * `var(--bg)` references used inside *other* properties like
 * `background-color` or `color` — those come back as an empty string.
 * Verified empirically against this repo's jsdom version: setting
 * `style="background-color: var(--bg)"` and reading it back via
 * `getComputedStyle(...).backgroundColor` yields `""`, even though the
 * stylesheet that defines `--bg` was appended to `document.head` first.
 * There is no real paint/layout pass to sample rendered pixels from
 * either. So contrast checks in this Jest/RTL suite work directly off
 * the literal hex values authored in tokens.css (parsed as text) rather
 * than through the DOM — this is the only reliable source of truth
 * available under `react-scripts test` (jsdom), short of standing up a
 * real browser (Playwright/Puppeteer), which this project does not
 * currently depend on.
 */

export type RGB = [number, number, number];

/** Accepts #rgb or #rrggbb. Throws on anything else (rgba()/named colors
 *  are intentionally out of scope — tokens.css only uses hex for the
 *  solid colors this module audits). */
export function hexToRgb(hex: string): RGB {
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`colorContrast: not a hex color: "${hex}"`);
  }
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [channel(r), channel(g), channel(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two hex colors, in the range [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA thresholds, for readable assertions in test files. */
export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3.0;
/** Non-text UI component boundaries/indicators, WCAG 2.1 SC 1.4.11. */
export const WCAG_AA_UI_COMPONENT = 3.0;

export interface ThemeColorTokens {
  bg: string;
  surface: string;
  'surface-2': string;
  border: string;
  accent: string;
  'accent-2': string;
  'accent-3': string;
  'text-main': string;
  'text-dim': string;
  'text-muted': string;
  success: string;
  warning: string;
  danger: string;
  'on-accent': string;
}

const HEX_VAR_RE = /--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g;
const THEME_BLOCK_RE = /((?::root)?(?:\s*,\s*)?\.theme-[\w-]+(?:\s*,\s*\.theme-[\w-]+)*|:root)\s*\{([^}]*)\}/g;

/**
 * Extracts { themeName: { tokenName: '#hex', ... } } from the raw text of
 * tokens.css. Intentionally a small regex scan, not a CSS parser — the
 * file's theme blocks are simple flat `--token: #hex;` declarations, and
 * a real parser is unwarranted for a test-only utility.
 */
export function parseThemeTokens(cssText: string): Record<string, Partial<ThemeColorTokens>> {
  const themes: Record<string, Partial<ThemeColorTokens>> = {};
  let match: RegExpExecArray | null;
  THEME_BLOCK_RE.lastIndex = 0;
  while ((match = THEME_BLOCK_RE.exec(cssText)) !== null) {
    const [, selector, body] = match;
    const themeNames = Array.from(selector.matchAll(/\.theme-([\w-]+)/g)).map((m) => m[1]);
    if (themeNames.length === 0) continue; // bare :root (typography/spacing/etc.) — no theme to attribute hex values to

    const tokens: Record<string, string> = {};
    let varMatch: RegExpExecArray | null;
    HEX_VAR_RE.lastIndex = 0;
    while ((varMatch = HEX_VAR_RE.exec(body)) !== null) {
      tokens[varMatch[1]] = varMatch[2];
    }

    for (const name of themeNames) {
      themes[name] = { ...(themes[name] ?? {}), ...tokens };
    }
  }
  return themes;
}
