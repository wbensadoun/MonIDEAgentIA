/**
 * InputArea — message composer with file upload.
 *
 * Kept deliberately dumb (controlled value + callbacks) so it can sit
 * under either the legacy AIChat/index.js state machine or the new
 * ChatInterface composition without caring which one owns state.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import './InputArea.css';

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
}

export interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  attachments?: AttachedFile[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  textareaProps?: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'onKeyDown' | 'onPaste' | 'disabled'>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  dropHint?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  canSubmit?: boolean;
  showAttachButton?: boolean;
  /** Shown when autonomy level requires acknowledging risk before sending
   *  (e.g. permissive mode + terminal access). */
  warning?: string;
}

export const InputArea: React.FC<InputAreaProps> = ({
  value,
  onChange,
  onSubmit,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  disabled = false,
  isSending = false,
  placeholder = 'Écrire un message… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)',
  warning,
  textareaRef: externalTextareaRef,
  textareaProps,
  onKeyDown: externalOnKeyDown,
  onPaste,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  dropHint,
  onCancel,
  cancelLabel = 'Arrêter la génération',
  canSubmit,
  showAttachButton = true
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = externalTextareaRef ?? textareaRef;

  // COD-70 A.1 — autosize : le champ grandit avec son contenu (cap ~200 px),
  // la ref textarea etait declaree mais jamais exploitree.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // COD-70 A.2 — Enter pendant une composition IME = fin de composition,
      // pas d'envoi.
      if (event.nativeEvent && (event.nativeEvent as WindowEventMap['keydown']).isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!disabled && !isSending && value.trim()) onSubmit();
      }
    },
    [disabled, isSending, value, onSubmit]
  );

  const handleFilePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        onAttach?.(event.target.files);
      }
      event.target.value = '';
    },
    [onAttach]
  );

  const canSend = !disabled && !isSending && (canSubmit ?? value.trim().length > 0);
  const isCancelAction = isSending && typeof onCancel === 'function';

  return (
    <div
      className="input-area"
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropHint}
      {warning && (
        <div className="input-area__warning" role="alert">
          {warning}
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="input-area__attachments" aria-label="Fichiers joints">
          {attachments.map((file) => (
            <li key={file.id} className="input-area__attachment">
              <span className="input-area__attachment-name">{file.name}</span>
              <button
                type="button"
                className="input-area__attachment-remove"
                data-focus-ring
                aria-label={`Retirer ${file.name}`}
                onClick={() => onRemoveAttachment?.(file.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="input-area__row">
        {showAttachButton && <button
          type="button"
          className="input-area__attach-btn"
          data-focus-ring
          disabled={disabled}
          aria-label="Joindre un fichier"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilePick}
          aria-hidden="true"
          tabIndex={-1}
        />

        <textarea
          ref={resolvedTextareaRef}
          className="input-area__textarea focus-ring"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={externalOnKeyDown ?? handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message à envoyer"
          {...textareaProps}
        />

        <button
          type="button"
          className="input-area__send-btn"
          data-focus-ring
          disabled={isCancelAction ? false : !canSend}
          onClick={isCancelAction ? onCancel : onSubmit}
          aria-label={isCancelAction ? cancelLabel : 'Envoyer le message'}
        >
          {isCancelAction ? 'Arrêter' : (isSending ? '…' : '↑')}
        </button>
      </div>
    </div>
  );
};

export default InputArea;
