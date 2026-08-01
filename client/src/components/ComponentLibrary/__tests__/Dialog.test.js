import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Dialog from '../Dialog';

const DialogHarness = () => {
  const [open, setOpen] = useState(false);
  const initialFocusRef = useRef(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ouvrir</button>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          ariaLabel="Dialogue de test"
          initialFocusRef={initialFocusRef}
          overlayClassName="overlay"
          className="dialog"
        >
          <input ref={initialFocusRef} aria-label="Premier champ" />
          <button type="button">Dernière action</button>
        </Dialog>
      )}
    </>
  );
};

test('announces the dialog and gives focus to its initial target', () => {
  render(<DialogHarness />);

  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));

  expect(screen.getByRole('dialog', { name: 'Dialogue de test' }))
    .toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('textbox', { name: 'Premier champ' })).toHaveFocus();
});

test('traps Tab and Shift+Tab at both ends', () => {
  render(<DialogHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));

  const first = screen.getByRole('textbox', { name: 'Premier champ' });
  const last = screen.getByRole('button', { name: 'Dernière action' });

  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();

  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
});

test('Escape closes the dialog and returns focus to the trigger', () => {
  render(<DialogHarness />);
  const trigger = screen.getByRole('button', { name: 'Ouvrir' });
  trigger.focus();
  fireEvent.click(trigger);

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
