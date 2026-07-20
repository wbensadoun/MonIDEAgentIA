import { buildLocalAIBudget, buildTeamPlan } from './teamSelector';
import { normalizeMultiAgentRoles } from './multiAgentConfig';

const roles = normalizeMultiAgentRoles();

describe('teamSelector', () => {
  test('does not select API/Data for a frontend-only React UI request', () => {
    const plan = buildTeamPlan({
      userRequest: 'Refais le design de cette app React sans backend',
      rolesConfig: roles,
      localAISettings: { optimizationMode: 'safe' },
      projectFiles: {
        files: {
          'package.json': { content: '{"dependencies":{"react":"latest"}}' },
          'src/App.jsx': { content: 'export default function App() { return null; }' }
        }
      }
    });

    expect(plan.formationKey).toBe('product-ui');
    expect(plan.selectedAgents.map((agent) => agent.key)).toContain('frontend');
    expect(plan.selectedAgents.map((agent) => agent.key)).not.toContain('apiData');
    expect(plan.excludedAgents.find((agent) => agent.key === 'apiData')?.reason)
      .toMatch(/sans backend/i);
  });

  test('selects payment, security and API/Data agents for Stripe work', () => {
    const plan = buildTeamPlan({
      userRequest: 'Ajoute Stripe checkout et securise le paiement',
      rolesConfig: roles,
      localAISettings: { optimizationMode: 'safe' },
      projectFiles: {
        files: {
          'package.json': { content: '{"dependencies":{"react":"latest","express":"latest"}}' },
          'server/routes/payments.js': { content: '' }
        }
      }
    });

    const keys = plan.selectedAgents.map((agent) => agent.key);
    expect(plan.formationKey).toBe('fullstack-useful');
    expect(keys).toContain('domain');
    expect(keys).toContain('apiData');
    expect(keys).toContain('security');
  });

  test('keeps safe local budget conservative by default', () => {
    expect(buildLocalAIBudget({ optimizationMode: 'safe' })).toMatchObject({
      profile: 'Safe',
      maxConcurrentLocal: 1,
      maxConcurrentCloud: 3
    });
  });

  test('uses workstation budget only with consented hardware profile', () => {
    expect(buildLocalAIBudget(
      { optimizationMode: 'auto', localAIHardwareConsent: true },
      { success: true, memory: { totalGb: 64 } }
    )).toMatchObject({
      profile: 'Workstation',
      maxConcurrentLocal: 3
    });
  });
});
