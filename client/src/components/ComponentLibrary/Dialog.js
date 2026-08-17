import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const getFocusableElements = (container) => (
  Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) || [])
    .filter((element) => element.getAttribute('aria-hidden') !== 'true')
);

/**
 * Accessible overlay primitive used by the workbench quick-picks and dialogs.
 * Styling stays opt-in through className/overlayClassName so the primitive does
 * not impose a visual system on its consumers.
 */
const Dialog = ({
  open = true,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  initialFocusRef,
  closeOnBackdrop = true,
  restoreFocus = true,
  overlayClassName = '',
  className = '',
  children,
  ...dialogProps
}) => {
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current = document.activeElement;
    const target = initialFocusRef?.current
      || getFocusableElements(dialogRef.current)[0]
      || dialogRef.current;
    target?.focus();

    return () => {
      const previousFocus = returnFocusRef.current;
      if (restoreFocus && previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [initialFocusRef, open, restoreFocus]);

  if (!open) return null;

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current?.();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && (activeElement === first || !dialogRef.current?.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !dialogRef.current?.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onCloseRef.current?.();
    }
  };

  return (
    <div className={overlayClassName} onClick={handleBackdropClick} data-dialog-backdrop>
      <div
        {...dialogProps}
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        onKeyDownCapture={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
};

export default Dialog;
