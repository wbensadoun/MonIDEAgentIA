import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import './Tooltip.css';

const composeHandlers = (existingHandler, tooltipHandler) => (event) => {
  existingHandler?.(event);
  tooltipHandler(event);
};

/**
 * Shared tooltip for compact controls that already expose a text label.
 *
 * The trigger keeps its native `title` fallback at call sites. This layer adds
 * a themeable label that also appears after keyboard focus, not only hover.
 */
const Tooltip = ({ label, children, placement = 'top', delay = 400 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef(null);
  const generatedId = useId().replace(/:/g, '');
  const tooltipId = `cc-tooltip-${generatedId}`;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setIsVisible(true);
      timerRef.current = null;
    }, delay);
  }, [clearTimer, delay]);

  const hide = useCallback(() => {
    clearTimer();
    setIsVisible(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const child = React.Children.only(children);
  const describedBy = [child.props['aria-describedby'], tooltipId]
    .filter(Boolean)
    .join(' ');
  const trigger = React.cloneElement(child, {
    'aria-describedby': describedBy,
    onMouseEnter: composeHandlers(child.props.onMouseEnter, show),
    onMouseLeave: composeHandlers(child.props.onMouseLeave, hide),
    onFocus: composeHandlers(child.props.onFocus, show),
    onBlur: composeHandlers(child.props.onBlur, hide),
  });

  return (
    <span className="cc-tooltip" data-visible={isVisible}>
      {trigger}
      <span
        id={tooltipId}
        className={`cc-tooltip__content cc-tooltip__content--${placement}`}
        role="tooltip"
        aria-hidden={!isVisible}
      >
        {label}
      </span>
    </span>
  );
};

export default Tooltip;
