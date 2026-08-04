/**
 * MessageViewer — streaming-ready message list.
 *
 * Renders chat history plus, optionally, an in-flight streaming message.
 * Auto-scroll follows the existing behavior implicit in AIChat/index.js
 * (a ref-based scroll-to-bottom on new content) but adds the two things
 * that implementation lacks: an `aria-live` region for streaming text so
 * screen reader users get incremental updates, and a pause-on-scroll-up
 * affordance so a user reading earlier history isn't yanked back down.
 *
 * Les blocs `text` des messages termines passent par MarkdownRenderer — le
 * meme moteur que la production (AIChat/index.js:1465), pour que le rendu soit
 * identique des le branchement. La bulle de streaming reste en texte brut :
 * voir le commentaire sur la region aria-live plus bas.
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import CodeBlock from './CodeBlock';
// Moteur Markdown partage avec la production (AIChat/index.js:1465). JS non type :
// tsconfig a allowJs/checkJs=false, l'import resout en `any` sans bruit TS.
import MarkdownRenderer from './MarkdownRenderer';
import './MessageViewer.css';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessageBlock {
  type: 'text' | 'code';
  content: string;
  language?: string;
  filename?: string;
  pendingApproval?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  blocks: ChatMessageBlock[];
  timestamp: number;
  /** Provider/model badge, e.g. "gemini/2.5-pro" — mirrors the existing
   *  badgeClass/bubbleClass convention in AIChat/index.js:772. */
  agentLabel?: string;
}

export interface MessageViewerProps {
  messages: ChatMessage[];
  /** Text currently streaming in, rendered as a trailing assistant bubble. */
  streamingText?: string;
  isStreaming?: boolean;
  emptyState?: React.ReactNode;
  className?: string;
  /** Transmis aux blocs de code Markdown (bouton « Copier »). */
  onCopyCode?: (code: string) => void;
  /** Transmis aux blocs de code Markdown (bouton « Appliquer »), actif
   *  uniquement quand le bloc porte un marqueur **FICHIER:**. */
  onApplyCode?: (code: string, language: string, filePath: string) => void;
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const MessageBubble = memo<{
  message: ChatMessage;
  onCopyCode?: MessageViewerProps['onCopyCode'];
  onApplyCode?: MessageViewerProps['onApplyCode'];
}>(({ message, onCopyCode, onApplyCode }) => (
  <div
    className={`message-viewer__bubble message-viewer__bubble--${message.role}`}
    role="group"
    aria-label={`Message de ${message.role === 'user' ? "l'utilisateur" : "l'agent"} à ${formatTime(message.timestamp)}`}
  >
    <div className="message-viewer__bubble-header">
      {message.agentLabel && <span className="message-viewer__agent-label">{message.agentLabel}</span>}
      <span className="message-viewer__time">{formatTime(message.timestamp)}</span>
    </div>
    <div className="message-viewer__bubble-content">
      {message.blocks.map((block, i) =>
        block.type === 'code' ? (
          <CodeBlock
            key={i}
            code={block.content}
            language={block.language}
            filename={block.filename}
            pendingApproval={block.pendingApproval}
          />
        ) : (
          <div key={i} className="message-viewer__text">
            <MarkdownRenderer text={block.content} onCopy={onCopyCode} onApply={onApplyCode} />
          </div>
        )
      )}
    </div>
  </div>
));

MessageBubble.displayName = 'MessageBubble';

export const MessageViewer: React.FC<MessageViewerProps> = ({
  messages,
  streamingText,
  isStreaming = false,
  emptyState,
  className,
  onCopyCode,
  onApplyCode
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    if (!autoFollow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText, autoFollow]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom < 48);
  };

  return (
    <div
      ref={scrollRef}
      className={['message-viewer', className].filter(Boolean).join(' ')}
      onScroll={handleScroll}
      role="log"
      aria-label="Historique de conversation"
    >
      {messages.length === 0 && !isStreaming ? (
        <div className="message-viewer__empty">{emptyState ?? 'Aucun message pour le moment.'}</div>
      ) : (
        messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onCopyCode={onCopyCode}
            onApplyCode={onApplyCode}
          />
        ))
      )}

      <div
        className={`message-viewer__bubble message-viewer__bubble--assistant ${isStreaming ? 'message-viewer__bubble--streaming' : 'message-viewer__bubble--hidden'}`}
        role="status"
        aria-live="polite"
        aria-label="Messages streaming"
        aria-atomic="false"
      >
        {/* Texte brut volontairement, PAS de Markdown ici — contrairement aux
            messages termines ci-dessus. Deux raisons :
            1. a11y : c'est une region aria-live. Un noeud texte qui s'allonge
               produit une annonce incrementale ; re-generer tout l'arbre DOM a
               chaque token ferait re-annoncer le message entier par le lecteur
               d'ecran, ce qui annulerait la raison d'etre de ce composant.
            2. perf : reparser le Markdown a chaque token est quadratique. La
               production contourne via `throttledStreamingText` (index.js:737).
               Tant que le throttling n'est pas remonte ici (cf. plan §5.4), on
               ne prend pas ce cout. Le Markdown apparait des la fin du stream,
               quand le message rejoint `messages`. */}
        <div className="message-viewer__bubble-content">
          <p className="message-viewer__text">
            {isStreaming && streamingText}
            {isStreaming && <span className="message-viewer__cursor" aria-hidden="true" />}
          </p>
        </div>
      </div>

      {!autoFollow && (
        <button
          type="button"
          className="message-viewer__jump-to-latest"
          data-focus-ring
          onClick={() => {
            setAutoFollow(true);
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}
        >
          ↓ Nouveaux messages
        </button>
      )}
    </div>
  );
};

export default MessageViewer;
