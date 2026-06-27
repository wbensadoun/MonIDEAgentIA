'use strict';

const { ipcMain } = require('electron');
const { saveConversation, listConversations, loadConversation } = require('../services/conversation.service');

const registerConversationHandlers = () => {
  ipcMain.handle('saveConversation', async (_event, projectPath, conversationHistory) => {
    try {
      const result = await saveConversation(projectPath, conversationHistory);
      return { success: true, ...result };
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('listConversations', async (_event, projectPath) => {
    try {
      if (!projectPath) return { success: false, error: 'Aucun chemin de projet fourni.' };
      const conversations = await listConversations(projectPath);
      return { success: true, conversations };
    } catch (error) {
      console.error('Erreur lors du listing des conversations :', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('loadConversation', async (_event, projectPath, fileName) => {
    try {
      if (!projectPath || !fileName) {
        return { success: false, error: 'Chemin de projet ou fichier de conversation manquant.' };
      }
      const result = await loadConversation(projectPath, fileName);
      return { success: true, ...result };
    } catch (error) {
      console.error('Erreur lors du chargement de la conversation :', error);
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerConversationHandlers };
