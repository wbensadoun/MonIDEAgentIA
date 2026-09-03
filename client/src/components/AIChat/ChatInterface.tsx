/**
 * ChatInterface — composition root for the chat panel.
 *
 * Enforces the mandated hierarchy:
 *
 *     AutonomyControls
 *          ↓
 *     MessageViewer   (flex: 1, scrollable)
 *          ↓
 *     InputArea
 *
 * This component owns NO business logic (no fetch, no streaming
 * transport, no provider/model resolution) — all of that stays in the
 * existing hooks (useAI, useAIPendingChanges, useFileOperations) and in
 * AIChat/index.js for now. ChatInterface is the composition + layout
 * layer those hooks should render through; see implementation_order in
 * the design-system report for the phased swap-in plan (this file is
 * additive today, not yet wired into App.js).
 *
 * Composition over inheritance: every child is a plain, independently
 * testable component (AutonomyControls, MessageViewer, CodeBlock,
 * InputArea) — ChatInterface only arranges them and forwards typed
 * props. No component subclasses another.
 */
import React from 'react';
import AutonomyControls, { AgentPersona, AutonomyLevel, ExecutionModeId } from './AutonomyControls';
import MessageViewer, { ChatMessage } from './MessageViewer';
import InputArea, { AttachedFile } from './InputArea';
import './ChatInterface.css';

export interface ChatInterfaceProps {
  // Autonomy
  executionMode: ExecutionModeId;
  onExecutionModeChange: (mode: ExecutionModeId) => void;
  autonomyLevel: AutonomyLevel;
  onAutonomyLevelChange: (level: AutonomyLevel) => void;
  isDeveloperMode?: boolean;
  agents?: AgentPersona[];
  activeAgent?: AgentPersona | null;
  onActiveAgentChange?: (agent: AgentPersona | null) => void;
  onOpenAgentManager?: () => void;

  // Messages
  messages: ChatMessage[];
  streamingText?: string;
  isStreaming?: boolean;
  emptyState?: React.ReactNode;
  onCopyCode?: (code: string) => void;
  onApplyCode?: (code: string, language: string, filePath: string) => void;
  onCopyMessage?: (message: ChatMessage) => void;
  onRerunMessage?: (message: ChatMessage) => void;

  /** Emplacements d'extension. Le conteneur existant (AIChat/index.js) porte
   *  des surfaces que ChatInterface ne modelise pas — pills provider/modele,
   *  cartes terminal, panneau de modifications en attente. Plutot que de les
   *  absorber (et de recreer un composant monolithique), ChatInterface les
   *  accepte comme enfants a placer, ce qui rend le swap possible sans perte
   *  de fonctionnalite. Voir docs/1.4c-swap-gard.md. */
  toolbarExtra?: React.ReactNode;
  aboveInput?: React.ReactNode;

  // Input
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  attachments?: AttachedFile[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  inputWarning?: string;

  /** True while a run is in flight — disables autonomy switches and the composer alike. */
  isBusy?: boolean;
  className?: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  executionMode,
  onExecutionModeChange,
  autonomyLevel,
  onAutonomyLevelChange,
  isDeveloperMode = false,
  agents,
  activeAgent,
  onActiveAgentChange,
  onOpenAgentManager,
  messages,
  streamingText,
  isStreaming = false,
  emptyState,
  onCopyCode,
  onApplyCode,
  onCopyMessage,
  onRerunMessage,
  toolbarExtra,
  aboveInput,
  inputValue,
  onInputChange,
  onSubmit,
  attachments,
  onAttach,
  onRemoveAttachment,
  inputWarning,
  isBusy = false,
  className
}) => {
  return (
    <div className={['chat-interface', className].filter(Boolean).join(' ')}>
      <AutonomyControls
        executionMode={executionMode}
        onExecutionModeChange={onExecutionModeChange}
        autonomyLevel={autonomyLevel}
        onAutonomyLevelChange={onAutonomyLevelChange}
        isDeveloperMode={isDeveloperMode}
        agents={agents}
        activeAgent={activeAgent}
        onActiveAgentChange={onActiveAgentChange}
        onOpenAgentManager={onOpenAgentManager}
        disabled={isBusy}
      />

      {toolbarExtra}

      <MessageViewer
        messages={messages}
        streamingText={streamingText}
        isStreaming={isStreaming}
        emptyState={emptyState}
        className="chat-interface__viewer"
        onCopyCode={onCopyCode}
        onApplyCode={onApplyCode}
        onCopyMessage={onCopyMessage}
        onRerunMessage={onRerunMessage}
        actionsDisabled={isBusy}
      />

      {aboveInput}

      <InputArea
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        attachments={attachments}
        onAttach={onAttach}
        onRemoveAttachment={onRemoveAttachment}
        disabled={isBusy}
        isSending={isStreaming}
        warning={inputWarning}
      />
    </div>
  );
};

export default ChatInterface;
