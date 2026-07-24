/**
 * ChatInterface — end-to-end flow test.
 *
 * ChatInterface is deliberately a "dumb" composition root (see its own
 * docblock): it owns no fetch/streaming/state, only layout + prop
 * forwarding to AutonomyControls / MessageViewer / InputArea. To exercise
 * a realistic user flow we drive it through a small stateful harness that
 * plays the same role a real container (AIChat/index.js today,
 * ComponentLibrary.tsx as a working example already in this codebase)
 * would: it owns messages/input/streaming state and reacts to the
 * callbacks ChatInterface forwards.
 *
 * Flow covered, in one continuous session per the QA brief:
 *   1. Render ChatInterface
 *   2. Change ExecutionMode and confirm the UI reflects it
 *   3. Send a message and confirm it renders in the log
 *   4. Streaming reply revealed character by character, then finalized
 *      into history with a pending-approval code block
 *   5. Copy that code block
 *   6. Upload a file attachment (and remove it)
 */
import React, { useCallback, useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import ChatInterface from '../ChatInterface';
import { AutonomyLevel, ExecutionModeId } from '../AutonomyControls';
import { AttachedFile } from '../InputArea';
import { ChatMessage } from '../MessageViewer';

const CANNED_REPLY = 'Voici le correctif propose.';
const CANNED_CODE = 'export function add(a, b) {\n  return a + b;\n}';

/**
 * Stand-in for the real streaming transport (useAI.js) — reveals the
 * canned reply one character at a time on an interval, exactly the shape
 * of update ChatInterface is built to receive (`streamingText` growing,
 * `isStreaming` true, then a final message appended once done).
 */
const ChatHarness: React.FC<{ onUserMessage?: (text: string) => void }> = ({ onUserMessage }) => {
  const [executionMode, setExecutionMode] = useState<ExecutionModeId>('agent');
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('normal');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const revealIndex = useRef(0);
  const timer = useRef<number | null>(null);

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      { id: `u-${prev.length}`, role: 'user', timestamp: Date.now(), blocks: [{ type: 'text', content: text }] }
    ]);
    onUserMessage?.(text);
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');
    revealIndex.current = 0;

    timer.current = window.setInterval(() => {
      revealIndex.current += 1;
      setStreamingText(CANNED_REPLY.slice(0, revealIndex.current));

      if (revealIndex.current >= CANNED_REPLY.length) {
        if (timer.current !== null) window.clearInterval(timer.current);
        setIsStreaming(false);
        setStreamingText('');
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${prev.length}`,
            role: 'assistant',
            agentLabel: 'test/model',
            timestamp: Date.now(),
            blocks: [
              { type: 'text', content: CANNED_REPLY },
              { type: 'code', content: CANNED_CODE, language: 'js', filename: 'client/src/utils/math.js', pendingApproval: true }
            ]
          }
        ]);
      }
    }, 10);
  }, [inputValue, onUserMessage]);

  return (
    <ChatInterface
      executionMode={executionMode}
      onExecutionModeChange={setExecutionMode}
      autonomyLevel={autonomyLevel}
      onAutonomyLevelChange={setAutonomyLevel}
      messages={messages}
      streamingText={streamingText}
      isStreaming={isStreaming}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSubmit={handleSubmit}
      attachments={attachments}
      onAttach={(files) =>
        setAttachments((prev) => [
          ...prev,
          ...Array.from(files).map((f, i) => ({ id: `${f.name}-${i}-${prev.length}`, name: f.name, size: f.size }))
        ])
      }
      onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((f) => f.id !== id))}
    />
  );
};

const getFileInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
};

describe('ChatInterface — end-to-end flow', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true
    });
  });

  test('renders the mandated hierarchy: AutonomyControls -> MessageViewer -> InputArea', () => {
    const { container } = render(<ChatHarness />);
    const root = container.querySelector('.chat-interface') as HTMLElement;
    const children = Array.from(root.children).map((el) => el.className);

    expect(children[0]).toContain('autonomy-controls');
    expect(children[1]).toContain('message-viewer');
    expect(children[2]).toContain('input-area');
  });

  test('changing ExecutionMode updates the active segment in the UI', () => {
    render(<ChatHarness />);
    const askButton = screen.getByRole('radio', { name: 'Ask' });
    const agentButton = screen.getByRole('radio', { name: 'Agent' });

    expect(agentButton).toHaveAttribute('aria-checked', 'true');
    expect(askButton).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(askButton);

    expect(askButton).toHaveAttribute('aria-checked', 'true');
    expect(askButton.className).toContain('is-active');
    expect(agentButton).toHaveAttribute('aria-checked', 'false');
    expect(agentButton.className).not.toContain('is-active');
  });

  test('changing AutonomyLevel updates the active segment and helper text', () => {
    render(<ChatHarness />);
    const permissive = screen.getByRole('radio', { name: 'Autonome' });

    fireEvent.click(permissive);

    expect(permissive).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Applique et exécute le terminal sans confirmation.')).toBeInTheDocument();
  });

  test('sending a message displays it in the conversation log', () => {
    const onUserMessage = jest.fn();
    render(<ChatHarness onUserMessage={onUserMessage} />);

    const textbox = screen.getByLabelText('Message à envoyer');
    fireEvent.change(textbox, { target: { value: 'Peux-tu corriger ce bug ?' } });
    fireEvent.click(screen.getByLabelText('Envoyer le message'));

    expect(onUserMessage).toHaveBeenCalledWith('Peux-tu corriger ce bug ?');
    const log = screen.getByRole('log');
    expect(within(log).getByText('Peux-tu corriger ce bug ?')).toBeInTheDocument();
    // composer clears after send
    expect(textbox).toHaveValue('');
  });

  test('Enter submits (without Shift), Shift+Enter does not', () => {
    render(<ChatHarness />);
    const textbox = screen.getByLabelText('Message à envoyer');

    fireEvent.change(textbox, { target: { value: 'Ligne 1' } });
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });
    expect(textbox).toHaveValue('Ligne 1'); // not submitted, composer keeps its content

    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: false });
    expect(textbox).toHaveValue(''); // submitted and cleared
  });

  test('streaming reveals the reply character by character before it lands in history', async () => {
    jest.useFakeTimers();
    try {
      render(<ChatHarness />);
      const textbox = screen.getByLabelText('Message à envoyer');
      fireEvent.change(textbox, { target: { value: 'Explique la fonction add' } });
      fireEvent.click(screen.getByLabelText('Envoyer le message'));

      const live = screen.getByLabelText('Messages streaming');

      // Partial reveal: some prefix of the canned reply, not yet the full text.
      act(() => {
        jest.advanceTimersByTime(30); // ~3 characters at 10ms/char
      });
      expect(live.textContent).toBe(CANNED_REPLY.slice(0, 3));
      expect(live.textContent!.length).toBeGreaterThan(0);
      expect(live.textContent).not.toBe(CANNED_REPLY);

      // A later, longer prefix strictly extends the earlier one.
      const earlier = live.textContent;
      act(() => {
        jest.advanceTimersByTime(30);
      });
      expect(live.textContent).not.toBe(earlier);
      expect(live.textContent!.startsWith(earlier!)).toBe(true);

      // Finish the reveal.
      act(() => {
        jest.advanceTimersByTime(CANNED_REPLY.length * 10 + 50);
      });

      expect(screen.queryByLabelText('Messages streaming')?.className).toContain('--hidden');
      const log = screen.getByRole('log');
      expect(within(log).getByText(CANNED_REPLY)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('copying a rendered code block writes its exact source to the clipboard', async () => {
    jest.useFakeTimers();
    try {
      render(<ChatHarness />);
      fireEvent.change(screen.getByLabelText('Message à envoyer'), { target: { value: 'go' } });
      fireEvent.click(screen.getByLabelText('Envoyer le message'));
      act(() => {
        jest.advanceTimersByTime(CANNED_REPLY.length * 10 + 50);
      });
    } finally {
      jest.useRealTimers();
    }

    const copyButton = screen.getByRole('button', { name: 'Copier le code' });
    fireEvent.click(copyButton);

    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(CANNED_CODE));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copié' })).toBeInTheDocument());
  });

  test('uploading an attachment lists it, and it can be removed', () => {
    const { container } = render(<ChatHarness />);
    const file = new File(['console.log(1)'], 'snippet.js', { type: 'text/javascript' });

    fireEvent.change(getFileInput(container), { target: { files: [file] } });

    expect(screen.getByText('snippet.js')).toBeInTheDocument();
    expect(screen.getByLabelText('Fichiers joints')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Retirer snippet.js'));
    expect(screen.queryByText('snippet.js')).not.toBeInTheDocument();
  });

  test('multiple attachments can be uploaded in one selection', () => {
    const { container } = render(<ChatHarness />);
    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });

    fireEvent.change(getFileInput(container), { target: { files: [fileA, fileB] } });

    const list = screen.getByLabelText('Fichiers joints');
    expect(within(list).getByText('a.png')).toBeInTheDocument();
    expect(within(list).getByText('b.png')).toBeInTheDocument();
  });

  test('the composer and autonomy switches disable while a run is busy (isBusy)', () => {
    const noop = jest.fn();
    render(
      <ChatInterface
        executionMode="agent"
        onExecutionModeChange={noop}
        autonomyLevel="normal"
        onAutonomyLevelChange={noop}
        messages={[]}
        inputValue=""
        onInputChange={noop}
        onSubmit={noop}
        isBusy
      />
    );

    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
    expect(screen.getByLabelText('Message à envoyer')).toBeDisabled();
    expect(screen.getByLabelText('Joindre un fichier')).toBeDisabled();
  });
});
