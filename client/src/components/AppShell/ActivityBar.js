import React from 'react';
import './ActivityBar.css';
import { IconFolder, IconSearch, IconChat, IconAgents, IconGit, IconSettings } from '../ComponentLibrary/icons';

/**
 * ActivityBar — fixed 48px vertical icon rail, always visible at the far
 * left edge regardless of viewMode (ide / chat / agents). Replaces the
 * horizontal AppViewSwitcher previously embedded in AppTopbar.js and the
 * plain-text 'Fichiers'/'Projets' tabs previously in WorkspaceSidebar.js.
 *
 * Unlike the left/right resizable panels (leftWidth/rightWidth, see
 * useWorkspaceSessionLayout), this rail never resizes — same contract as
 * VS Code's Activity Bar.
 *
 * Top group: Explorer / Search switch the *content* of the left sidebar
 * while staying in 'ide' viewMode. AI Chat / Agents switch the whole-page
 * viewMode (mirrors the previous IDE/Chat/Agents behavior). Git jumps to
 * the existing center 'git' tab (WorkspaceLayout already owns a working
 * Git view — this avoids duplicating GitPanel wiring into the sidebar).
 * Bottom: Settings, pinned with margin-top: auto.
 */
const ActivityBar = ({
  viewMode = 'ide',
  onViewModeChange = () => {},
  activeSidebarSection = 'explorer',
  onSidebarSectionChange = () => {},
  isLeftCollapsed = false,
  onExpandLeftPanel = () => {},
  onOpenSettings = () => {},
}) => {
  const goToSidebarSection = (section) => {
    onViewModeChange('ide');
    onSidebarSectionChange(section);
    if (isLeftCollapsed) onExpandLeftPanel();
  };

  const items = [
    {
      id: 'explorer',
      label: 'Explorateur',
      icon: IconFolder,
      isActive: viewMode === 'ide' && activeSidebarSection === 'explorer',
      onClick: () => goToSidebarSection('explorer'),
    },
    {
      id: 'search',
      label: 'Recherche',
      icon: IconSearch,
      isActive: viewMode === 'ide' && activeSidebarSection === 'search',
      onClick: () => goToSidebarSection('search'),
    },
    {
      id: 'chat',
      label: 'AI Chat',
      icon: IconChat,
      isActive: viewMode === 'chat',
      onClick: () => onViewModeChange('chat'),
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: IconAgents,
      isActive: viewMode === 'agents',
      onClick: () => onViewModeChange('agents'),
    },
    {
      id: 'git',
      label: 'Source Control',
      icon: IconGit,
      isActive: viewMode === 'ide' && activeSidebarSection === 'git',
      onClick: () => goToSidebarSection('git'),
    },
  ];

  return (
    <nav className="activity-bar" aria-label="Navigation principale">
      <div className="activity-bar-group">
        {items.map(({ id, label, icon: Icon, isActive, onClick }) => (
          <button
            key={id}
            type="button"
            className={`activity-bar-btn ${isActive ? 'is-active' : ''}`}
            onClick={onClick}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <Icon size={20} />
          </button>
        ))}
      </div>

      <div className="activity-bar-spacer" />

      <div className="activity-bar-group">
        <button
          type="button"
          className="activity-bar-btn"
          onClick={onOpenSettings}
          title="Paramètres"
          aria-label="Paramètres"
        >
          <IconSettings size={20} />
        </button>
      </div>
    </nav>
  );
};

export default ActivityBar;
