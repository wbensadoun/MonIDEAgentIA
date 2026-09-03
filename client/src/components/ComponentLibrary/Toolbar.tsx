/**
 * Toolbar — Structured container for grouped actions
 * Replaces the flat button list in AppTopbar.js:256-347
 *
 * Structure:
 * <Toolbar>
 *   <ToolbarGroup>
 *     <IconButton>Layout</IconButton>
 *     <IconButton>Chat</IconButton>
 *   </ToolbarGroup>
 *   <ToolbarSeparator />
 *   <ToolbarGroup>
 *     <IconButton>Folder</IconButton>
 *   </ToolbarGroup>
 * </Toolbar>
 */

import React from 'react';
import './Toolbar.css';

interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

interface ToolbarGroupProps {
  children: React.ReactNode;
  className?: string;
  label?: string;
}

interface ToolbarSeparatorProps {
  className?: string;
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  label?: string;
  isActive?: boolean | undefined;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'accent';
}

/**
 * Toolbar root container — flex row with proper spacing
 */
export const Toolbar: React.FC<ToolbarProps> = ({ children, className, style }) => (
  <div className={`toolbar ${className || ''}`} style={style} role="toolbar">
    {children}
  </div>
);

/**
 * ToolbarGroup — semantic grouping of related actions
 * Shows visual separation from adjacent groups
 */
export const ToolbarGroup: React.FC<ToolbarGroupProps> = ({ children, className, label }) => (
  <div className={`toolbar-group ${className || ''}`} role="group" aria-label={label}>
    {children}
  </div>
);

/**
 * ToolbarSeparator — visual divider between groups
 * Replaces raw pipes or margins
 */
export const ToolbarSeparator: React.FC<ToolbarSeparatorProps> = ({ className }) => (
  <div className={`toolbar-separator ${className || ''}`} aria-hidden="true" />
);

/**
 * IconButton — unified button style for topbar & layout actions
 * Standardizes icon size, spacing, label placement, active state
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      isActive = false,
      size = 'md',
      variant = 'default',
      className,
      title,
      type = 'button',
      'aria-label': ariaLabel,
      ...rest
    },
    ref
  ) => {
    const classNames = [
      'icon-button',
      `icon-button--${size}`,
      `icon-button--${variant}`,
      isActive && 'icon-button--active',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={classNames}
        type={type}
        aria-pressed={isActive === undefined ? undefined : isActive}
        aria-label={ariaLabel || (!label ? title : undefined)}
        title={title || label}
        {...rest}
      >
        {icon && <span className="icon-button__icon">{icon}</span>}
        {label && <span className="icon-button__label">{label}</span>}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

/**
 * Pill — compact badge/chip (provider + model selector, status, etc.)
 * Unified styling for topbar model selector, auto-route badge, etc.
 */
interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  isActive?: boolean;
  icon?: React.ReactNode;
  label: string;
  detail?: string;
  clickable?: boolean;
}

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  (
    {
      variant = 'default',
      isActive = false,
      icon,
      label,
      detail,
      clickable = true,
      className,
      onClick,
      type = 'button',
      ...rest
    },
    ref
  ) => {
    const classNames = [
      'pill',
      `pill--${variant}`,
      isActive && 'pill--active',
      !clickable && 'pill--static',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const Tag = (clickable ? 'button' : 'div') as React.ElementType;

    return (
      <Tag
        ref={ref}
        className={classNames}
        {...(clickable ? { type } : {})}
        onClick={clickable ? onClick : undefined}
        {...(clickable ? rest : {})}
      >
        {icon && <span className="pill__icon">{icon}</span>}
        <span className="pill__label">{label}</span>
        {detail && <span className="pill__detail">{detail}</span>}
      </Tag>
    );
  }
);

Pill.displayName = 'Pill';

export default Toolbar;
