import React from 'react';
import './Select.css';

/**
 * Shared select primitive.
 *
 * This tranche keeps the native select semantics and keyboard behavior while
 * normalizing the visual arrow and theme surface. A custom listbox is a
 * separate follow-up because replacing native selection behavior needs its own
 * interaction and mobile validation.
 */
const Select = React.forwardRef(({ className = '', children, ...selectProps }, ref) => (
  <span className="cc-select">
    <select
      {...selectProps}
      ref={ref}
      className={`cc-select__control ${className}`.trim()}
    >
      {children}
    </select>
    <span className="cc-select__arrow" aria-hidden="true">⌄</span>
  </span>
));

Select.displayName = 'Select';

export default Select;
