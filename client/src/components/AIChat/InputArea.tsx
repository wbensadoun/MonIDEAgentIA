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
  warning
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const canSend = !disabled && !isSending && value.trim().length > 0;

  return (
    <div className="input-area">
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
        <button
          type="button"
          className="input-area__attach-btn"
          data-focus-ring
          disabled={disabled}
          aria-label="Joindre un fichier"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
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
          ref={textareaRef}
          className="input-area__textarea focus-ring"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message à envoyer"
        />

        <button
          type="button"
          className="input-area__send-btn"
          data-focus-ring
          disabled={!canSend}
          onClick={onSubmit}
          aria-label={isSending ? 'Envoi en cours' : 'Envoyer le message'}
        >
          {isSending ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
};

export default InputArea;
