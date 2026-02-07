import React from 'react';
import './FileExplorer.css';

const FileIcon = () => (
  <svg className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const FolderIcon = () => (
  <svg className="h-4 w-4 mr-2 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const ChevronIcon = ({ isExpanded }) => (
  <svg
    className={`h-3 w-3 text-gray-400 transition-transform duration-200 ${isExpanded ? 'transform rotate-90' : ''}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const FileItem = ({ item, depth = 0, activeFile, expandedFolders, onToggleFolder, onFileClick, onDelete }) => {
  const isExpanded = expandedFolders.has(item.path);
  const isActive = activeFile === (item.path || item.name);
  const paddingLeft = depth * 20;

  return (
    <div key={item.path || item.name}>
      <div
        className="file-item flex items-center justify-between group rounded-lg transition-all duration-200 ease-in-out"
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        <div className="flex items-center flex-grow">
          {item.type === 'directory' && (
            <button
              onClick={() => onToggleFolder(item)}
              className="p-1 mr-1 hover:bg-gray-600 rounded transition-colors"
            >
              <ChevronIcon isExpanded={isExpanded} />
            </button>
          )}

          <button
            onClick={() => {
              if (item.type === 'file') {
                onFileClick(item.path || item.name);
              } else {
                onToggleFolder(item);
              }
            }}
            className={`flex-grow text-left p-2 rounded-lg text-sm flex items-center ${
              isActive
                ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg'
                : 'hover:bg-gray-700/50 text-gray-200'
            }`}
          >
            {item.type === 'directory' ? <FolderIcon /> : <FileIcon />}
            <span className="truncate">{item.name}</span>
          </button>
        </div>

        <button
          onClick={() => onDelete(item.name, item.type)}
          className="ml-2 p-1 rounded-full text-gray-500 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {item.type === 'directory' && isExpanded && item.children && item.children.length > 0 && (
        <div className="ml-2">
          {item.children.map(child => (
            <FileItem
              key={child.path || child.name}
              item={child}
              depth={depth + 1}
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onFileClick={onFileClick}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileExplorer = ({
  projectItems,
  currentProjectPath,
  activeFile,
  expandedFolders,
  newItemName,
  isElectronApiAvailable,
  onOpenFolder,
  onCreateItem,
  onDeleteItem,
  onToggleFolder,
  onFileClick,
  onNewItemNameChange
}) => {
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && newItemName) {
      onCreateItem(newItemName.includes('.') ? 'file' : 'directory');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-cyan-400 rounded-lg flex items-center justify-center shadow-lg">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
          Projet
        </h3>
      </div>

      <button
        onClick={onOpenFolder}
        className="btn-hover-effect focus-ring w-full bg-gradient-to-r from-sky-600 to-cyan-500 hover:from-sky-700 hover:to-cyan-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all duration-300 ease-in-out transform hover:scale-105 mb-4 text-md flex items-center justify-center space-x-2"
        disabled={!isElectronApiAvailable}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 9l5-5 5 5M12 4v12" />
        </svg>
        <span>Ouvrir un Dossier</span>
      </button>

      {currentProjectPath && (
        <div className="mb-4 p-3 glass-effect rounded-xl text-gray-300 text-sm break-words border border-gray-700">
          <div className="flex items-center space-x-2 mb-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-400">
              Dossier Actif
            </span>
          </div>
          <div className="text-white font-medium truncate">
            {currentProjectPath.split(window.electronAPI?.pathSeparator || '/').pop()}
          </div>
        </div>
      )}

      <div className="flex-grow flex flex-col overflow-hidden">
        {currentProjectPath && (
          <div className="mb-4 border-t border-gray-700 pt-4">
            <div className="relative mb-2">
              <input
                type="text"
                className="focus-ring w-full p-3 pl-10 rounded-xl glass-effect text-gray-100 border border-gray-600 placeholder-gray-400 text-sm"
                placeholder="Nouveau fichier/dossier..."
                value={newItemName}
                onChange={(e) => onNewItemNameChange(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <svg className="w-5 h-5 text-gray-400 absolute top-1/2 left-3 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => onCreateItem('file')}
                className="btn-hover-effect focus-ring flex-1 bg-gradient-to-r from-green-500 to-teal-500 text-white font-bold py-2 px-2 rounded-lg shadow-md text-xs flex items-center justify-center space-x-1"
                disabled={!isElectronApiAvailable || !newItemName}
              >
                <span>Fichier</span>
              </button>
              <button
                onClick={() => onCreateItem('directory')}
                className="btn-hover-effect focus-ring flex-1 bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold py-2 px-2 rounded-lg shadow-md text-xs flex items-center justify-center space-x-1"
                disabled={!isElectronApiAvailable || !newItemName}
              >
                <span>Dossier</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex-grow overflow-y-auto custom-scrollbar pr-2">
          {!currentProjectPath ? (
            <div className="text-center text-gray-400 p-6 rounded-lg">
              <p>Ouvrez un dossier</p>
            </div>
          ) : projectItems.length === 0 ? (
            <div className="text-center text-gray-400 p-6 rounded-lg">
              <p>Dossier vide</p>
            </div>
          ) : (
            <div className="tree-view">
              {projectItems.map(item => (
                <FileItem
                  key={item.path || item.name}
                  item={item}
                  activeFile={activeFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onFileClick={onFileClick}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileExplorer;
