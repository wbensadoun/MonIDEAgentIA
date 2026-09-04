import React from 'react';
import './ActivityBar.css';
import { IconFolder, IconSearch, IconChat, IconAgents, IconGit, IconAudit, IconFlow, IconPlug, IconSettings } from '../ComponentLibrary/icons';
import Tooltip from '../ComponentLibrary/Tooltip';

/**
 * ActivityBar — fixed 48px vertical icon rail, always visible at the far
 * left edge. Replaces the horizontal AppViewSwitcher previously embedded in
 * AppTopbar.js and the plain-text 'Fichiers'/'Projets' tabs previously in
 * WorkspaceSidebar.js.
 *
 * Unlike the left/right resizable panels (leftWidth/rightWidth, see
 * useWorkspaceSessionLayout), this rail never resizes — same contract as
 * VS Code's Activity Bar.
 *
 * Top group: Explorer / Search / Git / AI Changes switch the *content* of
 * the left sidebar (WorkspaceSidebar owns those views). AI Chat toggles the
 * right panel. Agents opens the agentverse. Flux opens the workflow editor
 * as the center document (VisualWorkflowEditor already owns its own
 * list+canvas, so it needs no sidebar view of its own — see
 * plan-ia-onglets.md §④). Bottom: Settings, pinned with margin-top: auto.
 */
const ActivityBar = ({
  activeSidebarSection = 'explorer',
  onSidebarSectionChange = () => {},
  isLeftCollapsed = false,
  onExpandLeftPanel = () => {},
  onOpenSettings = () => {},
  isAgentverseOpen = false,
  onAgentverseToggle = () => {},
  isRightCollapsed = false,
  onToggleRightPanel = () => {},
  centerView,
  onOpenWorkflows = () => {},
}) => {
  const goToSidebarSection = (section) => {
    onSidebarSectionChange(section);
    if (isLeftCollapsed) onExpandLeftPanel();
  };

  const items = [
    {
      id: 'explorer',
      label: 'Explorateur',
      icon: IconFolder,
      isActive: activeSidebarSection === 'explorer',
      onClick: () => goToSidebarSection('explorer'),
    },
    {
      id: 'search',
      label: 'Recherche',
      icon: IconSearch,
      isActive: activeSidebarSection === 'search',
      onClick: () => goToSidebarSection('search'),
    },
    {
      id: 'chat',
      label: 'AI Chat',
      icon: IconChat,
      isActive: !isRightCollapsed,
      onClick: () => {
        if (isRightCollapsed) onToggleRightPanel();
      },
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: IconAgents,
      isActive: isAgentverseOpen,
      onClick: () => onAgentverseToggle(!isAgentverseOpen),
    },
    {
      id: 'git',
      label: 'Source Control',
      icon: IconGit,
      isActive: activeSidebarSection === 'git',
      onClick: () => goToSidebarSection('git'),
    },
    {
      id: 'ai-changes',
      label: 'AI Changes',
      icon: IconAudit,
      isActive: activeSidebarSection === 'ai-changes',
      onClick: () => goToSidebarSection('ai-changes'),
    },
    {
      id: 'extensions',
      label: 'Extensions & Connecteurs',
      icon: IconPlug,
      isActive: activeSidebarSection === 'extensions',
      onClick: () => goToSidebarSection('extensions'),
    },
    {
      id: 'workflows',
      label: 'Flux',
      icon: IconFlow,
      isActive: centerView === 'workflows',
      onClick: () => onOpenWorkflows(),
    },
  ];

  return (
    <nav className="activity-bar" aria-label="Navigation principale">
      <div className="activity-bar-group">
        {items.map(({ id, label, icon: Icon, isActive, onClick }) => (
          <Tooltip key={id} label={label}>
            <button
              id={`workspace-tab-${id}`}
              type="button"
              className={`activity-bar-btn ${isActive ? 'is-active' : ''}`}
              onClick={onClick}
              title={label}
              aria-label={label}
              aria-pressed={isActive}
            >
              <Icon size={20} />
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="activity-bar-spacer" />

      <div className="activity-bar-group">
        <Tooltip label="Paramètres">
          <button
            type="button"
            className="activity-bar-btn"
            onClick={onOpenSettings}
            title="Paramètres"
            aria-label="Paramètres"
          >
            <IconSettings size={20} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
};

export default ActivityBar;
