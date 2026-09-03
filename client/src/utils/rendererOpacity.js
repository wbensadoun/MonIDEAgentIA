/**
 * Libellés réservés aux surfaces renderer où le routage interne ne doit pas
 * devenir une information produit. Les valeurs techniques restent dans les
 * contrats IPC et les Settings BYOK ; seules les valeurs affichées ici sont
 * opaques.
 */
export const OPAQUE_AI_LABEL = 'IA';
export const OPAQUE_AGENT_LABEL = 'Assistant spécialisé';
export const OPAQUE_WORKING_LABEL = 'Traitement en cours...';

export const opaqueStepLabel = (index) => `Rôle ${index + 1}`;
