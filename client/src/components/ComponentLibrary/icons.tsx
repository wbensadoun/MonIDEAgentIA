/**
 * Unified Icon System — Single source of truth for all glyphs
 * Replaces ad-hoc SVG inline definitions scattered across:
 * - AppTopbar.js (lines 8-82)
 * - WorkspaceLayout.js (lines 14-71)
 * - Settings/index.js (emoji usage)
 * - FileExplorer (text '+', '⊕', 'X')
 *
 * Every icon is a React component consuming currentColor + CSS variables
 * for stroke width & sizing.
 */

import React from 'react';

interface IconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number | string;
}

/**
 * Base SVG wrapper — all icons inherit this structure
 * to ensure consistent stroke weight, sizing, and theming.
 */
const SvgIcon: React.FC<{ children: React.ReactNode } & IconProps> = ({
  size = 24,
  className,
  style,
  strokeWidth = '1.8',
  children
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{
      width: typeof size === 'number' ? `${size}px` : size,
      height: typeof size === 'number' ? `${size}px` : size,
      flexShrink: 0,
      ...style
    }}
  >
    {children}
  </svg>
);

/* ============================================================
   TOPBAR & LAYOUT ICONS
   ============================================================ */

export const IconBot: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 2a2 2 0 0 1 2 2v2H10V4a2 2 0 0 1 2-2z" />
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M9 16h6" />
    <path d="M2 10v4M22 10v4" />
  </SvgIcon>
);

export const IconFolder: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </SvgIcon>
);

export const IconPlay: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconStop: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconSidebar: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </SvgIcon>
);

export const IconChat: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </SvgIcon>
);

export const IconWorkflow: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </SvgIcon>
);

export const IconSettings: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </SvgIcon>
);

export const IconTerminal: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </SvgIcon>
);

export const IconLightning: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconCompass: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="12 12 14.5 9.5 16 14 11 15.5" fill="currentColor" stroke="none" />
  </SvgIcon>
);

/* ============================================================
   CENTER TABS ICONS (WorkspaceLayout)
   ============================================================ */

export const IconCode: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </SvgIcon>
);

export const IconEye: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </SvgIcon>
);

export const IconGit: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </SvgIcon>
);

export const IconAudit: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <path d="M9 11l2 2 4-4" />
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </SvgIcon>
);

export const IconFlow: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </SvgIcon>
);

export const IconBrain: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 13}>
    <circle cx="7" cy="8" r="3" />
    <circle cx="17" cy="8" r="3" />
    <circle cx="12" cy="16" r="3" />
    <path d="M9.5 9.8 11 13.2" />
    <path d="M14.5 9.8 13 13.2" />
    <path d="M10 16h-2a4 4 0 0 1-4-4" />
    <path d="M14 16h2a4 4 0 0 0 4-4" />
  </SvgIcon>
);

export const IconMaximize: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 12}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </SvgIcon>
);

export const IconX: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 12} strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </SvgIcon>
);

export const IconMaximize2: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 12} strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </SvgIcon>
);

export const IconMinimize2: React.FC<IconProps> = (props) => (
  <SvgIcon {...props} size={props.size || 12} strokeWidth="2">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </SvgIcon>
);

/* ============================================================
   ACTION ICONS (Close, separator, etc.)
   ============================================================ */

export const IconClose: React.FC<IconProps> = (props) => (
  <IconX {...props} />
);

export const IconArrowRight: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </SvgIcon>
);

export const IconChevronDown: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="6 9 12 15 18 9" />
  </SvgIcon>
);

export const IconChevronUp: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="18 15 12 9 6 15" />
  </SvgIcon>
);

export const IconPlus: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </SvgIcon>
);

export const IconCheck: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="20 6 9 17 4 12" />
  </SvgIcon>
);

/**
 * Export all icons as a namespace for easier consumption:
 * import { Icons } from './icons';
 * <Icons.Bot />
 */
export const Icons = {
  Bot: IconBot,
  Folder: IconFolder,
  Play: IconPlay,
  Stop: IconStop,
  Sidebar: IconSidebar,
  Chat: IconChat,
  Workflow: IconWorkflow,
  Settings: IconSettings,
  Terminal: IconTerminal,
  Lightning: IconLightning,
  Compass: IconCompass,
  Code: IconCode,
  Eye: IconEye,
  Git: IconGit,
  Audit: IconAudit,
  Flow: IconFlow,
  Brain: IconBrain,
  Maximize: IconMaximize,
  X: IconX,
  Maximize2: IconMaximize2,
  Minimize2: IconMinimize2,
  Close: IconClose,
  ArrowRight: IconArrowRight,
  ChevronDown: IconChevronDown,
  ChevronUp: IconChevronUp,
  Plus: IconPlus,
  Check: IconCheck,
};

export default Icons;
