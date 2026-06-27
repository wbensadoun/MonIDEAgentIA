import { useCallback, useEffect, useState } from 'react';

const useAgentLibrary = ({ currentProjectPath, isElectronApiAvailable }) => {
  const [libraryNonce, setLibraryNonce] = useState(0);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [activeSkill, setActiveSkill] = useState(null);

  const bumpLibraryNonce = useCallback(() => {
    setLibraryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const loadLibraries = async () => {
      if (!isElectronApiAvailable || !window.electronAPI?.listAgents || !window.electronAPI?.listSkills) {
        setAvailableAgents([]);
        setAvailableSkills([]);
        setActiveAgent(null);
        setActiveSkill(null);
        return;
      }

      try {
        const [agentsRes, skillsRes] = await Promise.all([
          window.electronAPI.listAgents(currentProjectPath),
          window.electronAPI.listSkills(currentProjectPath),
        ]);

        const agents = agentsRes?.success && Array.isArray(agentsRes.agents) ? agentsRes.agents : [];
        const skills = skillsRes?.success && Array.isArray(skillsRes.skills) ? skillsRes.skills : [];

        setAvailableAgents(agents);
        setAvailableSkills(skills);

        setActiveAgent((prev) => {
          if (!prev) return null;
          const exists = agents.some((agent) => agent.name === prev.name && agent.scope === prev.scope);
          return exists ? prev : null;
        });

        setActiveSkill((prev) => {
          if (!prev) return null;
          const exists = skills.some((skill) => skill.name === prev.name && skill.scope === prev.scope);
          return exists ? prev : null;
        });
      } catch {
        setAvailableAgents([]);
        setAvailableSkills([]);
      }
    };

    loadLibraries();
  }, [isElectronApiAvailable, currentProjectPath, libraryNonce]);

  return {
    availableAgents,
    availableSkills,
    activeAgent,
    activeSkill,
    setActiveAgent,
    setActiveSkill,
    bumpLibraryNonce
  };
};

export default useAgentLibrary;