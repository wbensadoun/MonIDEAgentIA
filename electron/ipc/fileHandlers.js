'use strict';

const { ipcMain } = require('electron');
const {
  getAllFiles,
  getFolderChildren,
  listProjectFiles,
  searchInProject,
  searchSymbols,
  readFile,
  writeFile,
  deleteFile,
  createNewFile,
  createDirectory,
  deleteDirectory,
  editFile,
  renameFile,
  copyFile,
  moveFile,
  getAllProjectFiles,
} = require('../services/file.service');

const registerFileHandlers = () => {
  ipcMain.handle('get-all-files', (_event, folderPath) => getAllFiles(folderPath));
  ipcMain.handle('get-folder-children', (_event, projectPath, folderPath) => getFolderChildren(projectPath, folderPath));
  ipcMain.handle('list-project-files', (_event, projectPath, options) => listProjectFiles(projectPath, options));
  ipcMain.handle('search-in-project', (_event, projectPath, query, options) => searchInProject(projectPath, query, options));
  ipcMain.handle('search-symbols', (_event, projectPath, query, options) => searchSymbols(projectPath, query, options));
  ipcMain.handle('read-file', (_event, projectPath, filename) => readFile(projectPath, filename));
  ipcMain.handle('write-file', (_event, projectPath, filename, content, writeOptions) => writeFile(projectPath, filename, content, writeOptions));
  ipcMain.handle('delete-file', (_event, projectPath, filename, deleteOptions) => deleteFile(projectPath, filename, deleteOptions));
  ipcMain.handle('createNewFile', (_event, projectPath, filename, initialContent) => createNewFile(projectPath, filename, initialContent));
  ipcMain.handle('createDirectory', (_event, projectPath, dirname) => createDirectory(projectPath, dirname));
  ipcMain.handle('deleteDirectory', (_event, projectPath, dirname) => deleteDirectory(projectPath, dirname));
  ipcMain.handle('editFile', (_event, projectPath, filename, searchText, replaceText) => editFile(projectPath, filename, searchText, replaceText));
  ipcMain.handle('renameFile', (_event, projectPath, oldFilename, newFilename) => renameFile(projectPath, oldFilename, newFilename));
  ipcMain.handle('copyFile', (_event, projectPath, sourceFilename, destFilename) => copyFile(projectPath, sourceFilename, destFilename));
  ipcMain.handle('moveFile', (_event, projectPath, sourceFilename, destFilename) => moveFile(projectPath, sourceFilename, destFilename));
  ipcMain.handle('getAllProjectFiles', (_event, projectPath, options) => getAllProjectFiles(projectPath, options));
};

module.exports = { registerFileHandlers };
