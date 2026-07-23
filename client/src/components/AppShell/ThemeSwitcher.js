import React, { useState, useEffect, useRef } from 'react';

const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight Blue',
    swatches: ['#0c0c0e', '#141417', '#3b82f6', '#e1e1e6'],
  },
  {
    id: 'amber',
    name: 'Amber Terminal',
    swatches: ['#0a0806', '#14100b', '#f59e0b', '#f5e6c8'],
  },
  {
    id: 'mint',
    name: 'Mint Hacker',
    swatches: ['#050e0a', '#091410', '#10b981', '#d1fae5'],
  },
  {
    id: 'paper',
    name: 'Paper Light',
    swatches: ['#f8f9fa', '#ffffff', '#1d4ed8', '#1a1a2e'],
  },
  {
    id: 'violet',
    name: 'Violet Dream',
    swatches: ['#0a0810', '#120f1a', '#8b5cf6', '#e8e4f0'],
  },
];

const STORAGE_KEY = 'futurIA_theme';

const ThemeSwitcher = ({ theme, onThemeChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  const current = THEMES.find((t) => t.id === theme) || THEMES[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((prev) => !prev);
  };

  const handleSelect = (id) => {
    onThemeChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        className="topbar-theme-chip"
        onClick={handleOpen}
        title="Changer de thème"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="topbar-theme-swatch" />
        <span>{current.name}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          ref={ref}
          className="theme-dropdown"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div className="theme-dropdown-header">Thème</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-option ${t.id === theme ? 'is-active' : ''}`}
              onClick={() => handleSelect(t.id)}
            >
              <span className="theme-swatches">
                {t.swatches.map((c, i) => (
                  <span
                    key={i}
                    className="theme-swatch"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span>{t.name}</span>
              {t.id === theme && (
                <svg style={{ marginLeft: 'auto', width: 12, height: 12 }} viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

export { THEMES, STORAGE_KEY };
export default ThemeSwitcher;
