import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useWorkspaceSessionLayout, {
  fitSideWidths,
  migrateLegacyWidth,
  WORKSPACE_LAYOUT_VERSION
} from './useWorkspaceSessionLayout';

const Harness = ({ projectPath = 'C:/project' }) => {
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState('');
  const [centerView, setCenterView] = useState('code');
  const layout = useWorkspaceSessionLayout({
    currentProjectPath: projectPath,
    openFiles,
    activeFile,
    setOpenFiles,
    setActiveFile,
    centerView,
    setCenterView
  });
  return (
    <div ref={layout.layoutRef}>
      <output data-testid="layout-state">
        {JSON.stringify({
          leftWidth: layout.leftWidth,
          rightWidth: layout.rightWidth,
          isLeftCollapsed: layout.isLeftCollapsed,
          isRightCollapsed: layout.isRightCollapsed,
          isFocusMode: layout.isFocusMode,
          isChatMaximized: layout.isChatMaximized
        })}
      </output>
      <button onClick={layout.toggleLeftPanel}>left</button>
      <button onClick={layout.toggleRightPanel}>right</button>
      <button onClick={layout.toggleFocusMode}>focus</button>
      <button onClick={layout.toggleChatMaximize}>maximize-chat</button>
    </div>
  );
};

const readState = () => JSON.parse(screen.getByTestId('layout-state').textContent);

beforeEach(() => {
  localStorage.clear();
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }));
});

test('chat maximize and focus mode are mutually exclusive', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'maximize-chat' }));
  expect(readState()).toMatchObject({ isChatMaximized: true, isFocusMode: false, isRightCollapsed: false });

  fireEvent.click(screen.getByRole('button', { name: 'focus' }));
  expect(readState()).toMatchObject({ isChatMaximized: false, isFocusMode: true, isRightCollapsed: true });
});

test('chat maximize restores a previously collapsed right panel', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'right' }));
  fireEvent.click(screen.getByRole('button', { name: 'maximize-chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'maximize-chat' }));
  expect(readState()).toMatchObject({ isChatMaximized: false, isRightCollapsed: true });
});

afterEach(() => jest.restoreAllMocks());

test('legacy percentages are converted to pixel widths', () => {
  expect(migrateLegacyWidth(20, 1200, 280)).toBe(240);
  expect(migrateLegacyWidth('22', 1200, 360)).toBe(264);
});

test('side widths yield to the editor minimum at the application minimum width', () => {
  const fitted = fitSideWidths({
    availableWidth: 482,
    leftWidth: 280,
    rightWidth: 360,
    leftMin: 200,
    rightMin: 280
  });

  expect(fitted.leftWidth + fitted.rightWidth).toBe(482);
  expect(fitted.leftWidth).toBeGreaterThanOrEqual(200);
  expect(fitted.rightWidth).toBeGreaterThanOrEqual(280);
});

test('loads legacy workspace widths and rewrites the session as versioned pixels', async () => {
  localStorage.setItem('vibeIDE_session:C:/project', JSON.stringify({
    leftWidth: 20,
    rightWidth: 30,
    layoutDensityVersion: 2,
    openFiles: [],
    centerView: 'code'
  }));
  render(<Harness />);

  await waitFor(() => expect(readState()).toMatchObject({ leftWidth: 240, rightWidth: 360 }));
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem('vibeIDE_session:C:/project'));
    expect(saved.layoutDensityVersion).toBe(WORKSPACE_LAYOUT_VERSION);
    expect(saved.leftWidth).toBe(240);
    expect(saved.rightWidth).toBe(360);
  });
});

test('collapse and focus restore visibility without losing pixel widths', async () => {
  render(<Harness />);
  const initial = readState();

  fireEvent.click(screen.getByRole('button', { name: 'left' }));
  expect(readState()).toMatchObject({ leftWidth: initial.leftWidth, isLeftCollapsed: true });

  fireEvent.click(screen.getByRole('button', { name: 'focus' }));
  expect(readState()).toMatchObject({ isFocusMode: true, isLeftCollapsed: true, isRightCollapsed: true });
  fireEvent.click(screen.getByRole('button', { name: 'focus' }));

  await waitFor(() => expect(readState()).toMatchObject({
    leftWidth: initial.leftWidth,
    rightWidth: initial.rightWidth,
    isFocusMode: false,
    isLeftCollapsed: true,
    isRightCollapsed: false
  }));
});
