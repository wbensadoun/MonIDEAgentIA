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

/**
 * Layout controls — même grammaire visuelle que la barre de titre VS Code
 * (Toggle Primary/Secondary Side Bar, Toggle Panel, Customize Layout) :
 * un cadre du panneau complet + une zone pleine indiquant la région active.
 * Redessinées en stroke 24x24 pour matcher SvgIcon plutôt que copiées telles
 * quelles depuis les codicons (qui sont des glyphes "fill" 16x16).
 *
 * Comme dans VS Code, chaque région a DEUX glyphes : zone pleine quand le
 * panneau est visible, simple trait de séparation quand il est masqué
 * (codicons layout-sidebar-left vs layout-sidebar-left-off). L'état ne se
 * lit donc pas qu'à la couleur — utile en daltonisme et en contraste élevé.
 */
export const IconLayoutSidebarLeft: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="4" y="4.5" width="6" height="15" rx="1" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconLayoutSidebarLeftOff: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </SvgIcon>
);

export const IconLayoutPanel: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="4" y="14.5" width="16" height="5.5" rx="1" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconLayoutPanelOff: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="15" x2="21" y2="15" />
  </SvgIcon>
);

export const IconLayoutSidebarRight: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="14" y="4.5" width="6" height="15" rx="1" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconLayoutSidebarRightOff: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </SvgIcon>
);

export const IconLayoutCustomize: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="3" y="3" width="9" height="18" rx="1.5" />
    <rect x="14" y="3" width="7" height="8" rx="1.5" />
    <rect x="14" y="13" width="7" height="8" rx="1.5" />
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

export const IconSearch: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </SvgIcon>
);

export const IconAgents: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 2a2 2 0 0 1 2 2v2h-4V4a2 2 0 0 1 2-2z" />
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M9 16h6" />
    <path d="M2 10v4M22 10v4" />
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

export const IconSave: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </SvgIcon>
);

export const IconTrash: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </SvgIcon>
);

export const IconUpload: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </SvgIcon>
);

export const IconDownload: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </SvgIcon>
);

export const IconPackage: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 8v8a2 2 0 0 1-1 1.73l-6 3.46a2 2 0 0 1-2 0l-6-3.46A2 2 0 0 1 5 16V8a2 2 0 0 1 1-1.73l6-3.46a2 2 0 0 1 2 0l6 3.46A2 2 0 0 1 21 8z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </SvgIcon>
);

export const IconShield: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </SvgIcon>
);

/* ============================================================
   WORKFLOW / NODE ICONS (VisualWorkflowEditor catalogue)
   ============================================================ */

export const IconClock: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 16 14" />
  </SvgIcon>
);

export const IconGlobe: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </SvgIcon>
);

export const IconSparkle: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconFile: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </SvgIcon>
);

export const IconEdit: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </SvgIcon>
);

export const IconLink: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </SvgIcon>
);

export const IconShuffle: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </SvgIcon>
);

export const IconRepeat: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </SvgIcon>
);

export const IconHourglass: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M6 2h12v6l-6 4-6-4V2z" />
    <path d="M6 22h12v-6l-6-4-6 4v6z" />
  </SvgIcon>
);

export const IconBell: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </SvgIcon>
);

export const IconMail: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <polyline points="22 6 12 13 2 6" />
  </SvgIcon>
);

export const IconSend: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </SvgIcon>
);

/* ============================================================
   MCP / TOOLING ICONS (McpSettings)
   ============================================================ */

export const IconPlug: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M9 2v6" />
    <path d="M15 2v6" />
    <rect x="6" y="8" width="12" height="6" rx="2" />
    <path d="M12 14v8" />
  </SvgIcon>
);

export const IconKey: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="7" cy="15" r="4" />
    <path d="M10.5 11.5L21 1" />
    <path d="M17 5l3 3" />
    <path d="M14 8l3 3" />
  </SvgIcon>
);

export const IconCloud: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </SvgIcon>
);

export const IconWrench: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </SvgIcon>
);

export const IconDot: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
  </SvgIcon>
);

/* ============================================================
   PROVIDER MARKS (LoadingAnimations — abstract, non-branded glyphs)
   ============================================================ */

export const IconDiamond: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polygon points="12 2 22 12 12 22 2 12" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconMoon: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="none" />
  </SvgIcon>
);

export const IconCpu: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </SvgIcon>
);

export const IconUser: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </SvgIcon>
);

/* ============================================================
   SESSIONS / CHAT TABS ICONS (plan-ia-onglets.md §⑤)
   ============================================================ */

export const IconMoreVertical: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </SvgIcon>
);

export const IconCopy: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </SvgIcon>
);

export const IconExpand: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
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
  LayoutSidebarLeft: IconLayoutSidebarLeft,
  LayoutSidebarLeftOff: IconLayoutSidebarLeftOff,
  LayoutPanel: IconLayoutPanel,
  LayoutPanelOff: IconLayoutPanelOff,
  LayoutSidebarRight: IconLayoutSidebarRight,
  LayoutSidebarRightOff: IconLayoutSidebarRightOff,
  LayoutCustomize: IconLayoutCustomize,
  Chat: IconChat,
  Workflow: IconWorkflow,
  Settings: IconSettings,
  Terminal: IconTerminal,
  Lightning: IconLightning,
  Compass: IconCompass,
  Search: IconSearch,
  Agents: IconAgents,
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
  Save: IconSave,
  Trash: IconTrash,
  Upload: IconUpload,
  Download: IconDownload,
  Package: IconPackage,
  Shield: IconShield,
  Clock: IconClock,
  Globe: IconGlobe,
  Sparkle: IconSparkle,
  File: IconFile,
  Edit: IconEdit,
  Link: IconLink,
  Shuffle: IconShuffle,
  Repeat: IconRepeat,
  Hourglass: IconHourglass,
  Bell: IconBell,
  Mail: IconMail,
  Send: IconSend,
  Plug: IconPlug,
  Key: IconKey,
  Cloud: IconCloud,
  Wrench: IconWrench,
  Dot: IconDot,
  Diamond: IconDiamond,
  Moon: IconMoon,
  Cpu: IconCpu,
  User: IconUser,
  MoreVertical: IconMoreVertical,
  Copy: IconCopy,
  Expand: IconExpand,
};

export default Icons;
