import React from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import AIChat from '../AIChat';

/**
 * ChatLayout — Full-page flex row layout for chat-focused UI
 *
 * Structure:
 * - Left sidebar: WorkspaceSidebar (projects only, no file explorer)
 * - Right main: Full-screen AIChat interface
 *
 * Props:
 *   - workspacePanelProps: Object with WorkspacePanel configuration
 *   - aiChatProps: Object with AIChat configuration
 */
const ChatLayout = ({
  workspacePanelProps,
  aiChatProps
}) => {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Left Sidebar: Projects/Workspace Panel */}
      <WorkspaceSidebar
        sidebarVisibility="projectsOnly"
        width="20%"
        workspacePanelProps={workspacePanelProps}
      />

      {/* Right Main: Full-screen Chat */}
      <main
        className="chat-fullscreen"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          overflow: 'hidden'
        }}
      >
        <AIChat {...aiChatProps} />
      </main>
    </div>
  );
};

export default ChatLayout;
