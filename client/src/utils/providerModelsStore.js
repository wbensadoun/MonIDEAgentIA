import { PROVIDER_CATALOG } from './remoteModels';

// Cache partage entre l'app (rafraichissement silencieux au demarrage) et
// l'ecran Settings (affichage + redetection sur frappe de cle) : une seule
// requete reseau par fournisseur, meme si plusieurs composants la demandent
// en meme temps. Diffusion par CustomEvent, meme pattern que 'settings-updated'
// et 'ollama-models-refreshed' deja utilises dans le projet.
export const PROVIDER_MODELS_UPDATED_EVENT = 'provider-models-updated';

const EMPTY_DETECTION = Object.freeze({ status: 'idle', models: [], error: null });

const state = {};
const inFlight = {};

const emitUpdate = () => {
  window.dispatchEvent(new CustomEvent(PROVIDER_MODELS_UPDATED_EVENT));
};

export const getProviderModelsState = (providerId) => state[providerId] || EMPTY_DETECTION;

export const refreshProviderModel = async (provider) => {
  if (provider.supportsModelDiscovery === false) {
    state[provider.id] = EMPTY_DETECTION;
    return state[provider.id];
  }
  if (!window.electronAPI?.listProviderModels) return getProviderModelsState(provider.id);

  // Deux composants (ex: startup + Settings ouvert simultanement) ne doivent
  // pas declencher deux requetes concurrentes pour le meme fournisseur.
  if (inFlight[provider.id]) return inFlight[provider.id];

  const run = (async () => {
    try {
      const response = await window.electronAPI.listProviderModels(provider.id);
      state[provider.id] = response?.success && response?.valid
        ? { status: 'ok', models: response.models || [], error: null }
        : { status: 'error', models: [], error: response?.error || 'Détection impossible' };
    } catch (error) {
      state[provider.id] = { status: 'error', models: [], error: error.message };
    }
    emitUpdate();
    return state[provider.id];
  })();

  inFlight[provider.id] = run;
  try {
    return await run;
  } finally {
    delete inFlight[provider.id];
  }
};

// Appelee une fois au demarrage de l'app (des que les settings sont charges) :
// aucun retour visuel, juste peupler le cache pour que la premiere ouverture
// de Settings affiche des modeles deja a jour au lieu du repli hors-ligne.
export const refreshAllProviderModels = (settings = {}) => {
  PROVIDER_CATALOG.forEach((provider) => {
    const hasKey = provider.keyField ? settings.providerKeyStatus?.[provider.id] === true : true;
    if (provider.keyField && !hasKey) return;
    refreshProviderModel(provider).catch(() => {});
  });
};

// Reservee aux tests : evite qu'une detection mockee dans un test fuite vers
// le suivant via le cache module-level (Jest ne reinitialise pas les modules
// entre les `test()` d'un meme fichier).
export const resetProviderModelsStore = () => {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.keys(inFlight).forEach((key) => delete inFlight[key]);
};
