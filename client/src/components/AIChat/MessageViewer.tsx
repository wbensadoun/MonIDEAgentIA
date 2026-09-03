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

/**
 * `text`      — Markdown rendu (reponse assistant).
 * `plain`     — texte litteral, aucun parsing : ce que l'utilisateur a tape
 *               doit rester tel quel, asterisques comprises.
 * `reasoning` — segment <think>, replie par defaut.
 * `empty`     — garde-fou reponse vide (un provider peut repondre success
 *               avec zero texte) ; sans lui la bulle s'affiche blanche.
 * `code`      — bloc de code structure, rendu par CodeBlock.
 */
export interface ChatMessageBlock {
  type: 'text' | 'code' | 'plain' | 'reasoning' | 'empty';
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
  /** Libellé opaque de rôle, quand une réponse spécialisée doit être signalée. */
  agentLabel?: string;
  /** Position dans l'historique brut. Les actions par message d'index.js
   *  (copier/relancer) sont indexees dessus — cf. utils/chatMessages.js. */
  sourceIndex?: number;
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
  /** Action « Copier la réponse » par message assistant. Absent ⇒ pas de bouton. */
  onCopyMessage?: (message: ChatMessage) => void;
  /** Action « Relancer cette requête ». Absent ⇒ pas de bouton. */
  onRerunMessage?: (message: ChatMessage) => void;
  /** Desactive les actions par message pendant une generation. */
  actionsDisabled?: boolean;
  /** Contenu additionnel rendu sous une bulle : images collees et cartes
   *  terminal archivees sont rattachees au message dans index.js, mais ne
   *  font pas partie du modele de message. Le conteneur les fournit. */
  renderMessageExtras?: (message: ChatMessage) => React.ReactNode;
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const BlockContent: React.FC<{
  block: ChatMessageBlock;
  onCopyCode?: MessageViewerProps['onCopyCode'];
  onApplyCode?: MessageViewerProps['onApplyCode'];
}> = ({ block, onCopyCode, onApplyCode }) => {
  if (block.type === 'code') {
    return (
      <CodeBlock
        code={block.content}
        language={block.language}
        filename={block.filename}
        pendingApproval={block.pendingApproval}
      />
    );
  }

  if (block.type === 'reasoning') {
    // Meme balisage que ReasoningBlock (index.js:33) : replie par defaut, le
    // raisonnement ne doit pas pousser la reponse hors de l'ecran.
    return (
      <details className="ai-reasoning">
        <summary className="ai-reasoning-summary">Raisonnement du modèle</summary>
        <pre className="ai-reasoning-body">{block.content.trim()}</pre>
      </details>
    );
  }

  if (block.type === 'empty') {
    return <p className="ai-message-empty">(réponse vide — le modèle n&apos;a rien renvoyé)</p>;
  }

  if (block.type === 'plain') {
    return <p className="message-viewer__text message-viewer__text--plain">{block.content}</p>;
  }

  return (
    <div className="message-viewer__text">
      <MarkdownRenderer text={block.content} onCopy={onCopyCode} onApply={onApplyCode} />
    </div>
  );
};

const MessageBubble = memo<{
  message: ChatMessage;
  onCopyCode?: MessageViewerProps['onCopyCode'];
  onApplyCode?: MessageViewerProps['onApplyCode'];
  onCopyMessage?: MessageViewerProps['onCopyMessage'];
  onRerunMessage?: MessageViewerProps['onRerunMessage'];
  actionsDisabled?: boolean;
  renderMessageExtras?: MessageViewerProps['renderMessageExtras'];
  /** 1.4 — la barre d'actions de la derniere reponse assistant reste visible
   *  en permanence (voir .message-viewer__bubble--pinned-actions), au lieu de
   *  n'apparaitre qu'au survol/focus comme les messages plus anciens. */
  isLastAssistant?: boolean;
}>(({ message, onCopyCode, onApplyCode, onCopyMessage, onRerunMessage, actionsDisabled, renderMessageExtras, isLastAssistant }) => (
  <div
    className={[
      'message-viewer__bubble',
      `message-viewer__bubble--${message.role}`,
      isLastAssistant && 'message-viewer__bubble--pinned-actions'
    ]
      .filter(Boolean)
      .join(' ')}
    role="group"
    aria-label={`Message de ${message.role === 'user' ? "l'utilisateur" : "l'agent"} à ${formatTime(message.timestamp)}`}
  >
    <div className="message-viewer__bubble-header">
      {message.agentLabel && <span className="message-viewer__agent-label">{message.agentLabel}</span>}
      <span className="message-viewer__time">{formatTime(message.timestamp)}</span>
    </div>
    <div className="message-viewer__bubble-content">
      {message.blocks.map((block, i) => (
        <BlockContent key={i} block={block} onCopyCode={onCopyCode} onApplyCode={onApplyCode} />
      ))}
    </div>
    {/* Actions reservees aux reponses de l'agent : « relancer » n'a pas de
        sens sur son propre message, et un message systeme n'est pas une
        reponse a rejouer. */}
    {message.role === 'assistant' && (onCopyMessage || onRerunMessage) && (
      <div className="message-viewer__actions">
        {onCopyMessage && (
          <button
            type="button"
            className="message-viewer__action"
            data-focus-ring
            onClick={() => onCopyMessage(message)}
            aria-label="Copier la réponse"
          >
            Copier
          </button>
        )}
        {onRerunMessage && (
          <button
            type="button"
            className="message-viewer__action"
            data-focus-ring
            disabled={actionsDisabled}
            onClick={() => onRerunMessage(message)}
            aria-label="Relancer cette requête"
          >
            Relancer
          </button>
        )}
      </div>
    )}
    {renderMessageExtras && renderMessageExtras(message)}
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
  onApplyCode,
  onCopyMessage,
  onRerunMessage,
  actionsDisabled,
  renderMessageExtras
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

  // 1.4 — epingle la barre d'actions de la derniere reponse assistant (motif
  // VS Code / AIChat.css:407-419) : c'est la seule dont les actions restent
  // visibles sans survol ni focus.
  let lastAssistantId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      lastAssistantId = messages[i].id;
      break;
    }
  }

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
            onCopyMessage={onCopyMessage}
            onRerunMessage={onRerunMessage}
            actionsDisabled={actionsDisabled}
            renderMessageExtras={renderMessageExtras}
            isLastAssistant={message.id === lastAssistantId}
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
