import React from 'react';

/**
 * Shared button primitive for renderer controls.
 *
 * It keeps the native button semantics while giving call sites one safe
 * default: action buttons never submit an enclosing form accidentally.
 * Existing feature classes remain opt-in through className so migrations can
 * happen incrementally without changing a panel's visual language.
 */
const Button = React.forwardRef(({
  variant = 'default',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...buttonProps
}, ref) => {
  const classNames = [
    'cc-button',
    `cc-button--${variant}`,
    `cc-button--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={classNames}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
