'use strict';

const {
  WANSIA_RETRIEVAL_ERRORS,
  createWansiaRetrievalCapability,
  WansiaRetrievalError
} = require('../services/wansia-retrieval-capability.service');

const registerWansiaRetrievalHandlers = ({
  ipcMain,
  capability = createWansiaRetrievalCapability()
} = {}) => {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain requis');
  if (!capability || typeof capability.negotiate !== 'function' || typeof capability.retrieve !== 'function') {
    throw new Error('Capability retrieval Wansia requise');
  }
  const handle = (channel, listener) => {
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };
  const publicError = (error) => {
    const code = error?.code || WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST;
    const messages = {
      [WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST]: 'Requête retrieval Wansia invalide.',
      [WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE]: 'Identité retrieval Wansia indisponible.',
      [WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH]: 'Accès retrieval Wansia refusé.',
      [WANSIA_RETRIEVAL_ERRORS.PROTOCOL_UNSUPPORTED]: 'Version retrieval Wansia non supportée.',
      [WANSIA_RETRIEVAL_ERRORS.UNAVAILABLE]: 'Retrieval Wansia indisponible.',
      [WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID]: 'Réponse retrieval Wansia invalide.'
    };
    return { success: false, code, error: messages[code] || 'Retrieval Wansia refusé.' };
  };
  handle('wansia:retrieval:metadata', async () => ({ success: true, ...capability.metadata() }));
  handle('wansia:retrieval:negotiate', async (_event, payload = {}) => {
    try {
      const selectedVersion = capability.negotiate(payload.peerVersions);
      return { success: true, contract: capability.metadata().contract, selectedVersion };
    } catch (error) {
      return publicError(error);
    }
  });
  handle('wansia:retrieval:query', async (_event, payload = {}) => {
    try {
      return { success: true, data: await capability.retrieve(payload) };
    } catch (error) {
      return publicError(error instanceof WansiaRetrievalError ? error : {
        code: WANSIA_RETRIEVAL_ERRORS.UNAVAILABLE
      });
    }
  });
};

module.exports = { registerWansiaRetrievalHandlers };
