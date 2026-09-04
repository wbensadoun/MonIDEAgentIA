import React from 'react';
import Dialog from '../ComponentLibrary/Dialog';

const CommandCenterOverlays = ({
  commandOpen,
  commandInputRef,
  commandQuery,
  setCommandQuery,
  handleCommandKey,
  filteredCommands,
  commandIndex,
  runCommand,
  closeCommand,
  filePaletteOpen,
  filePaletteInputRef,
  filePaletteQuery,
  setFilePaletteQuery,
  handleFilePaletteKey,
  isProjectFileListLoading,
  filteredFiles,
  filePaletteIndex,
  runFilePick,
  closeFilePalette,
  searchOpen,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  handleSearchKey,
  isSearchLoading,
  searchResults,
  searchIndex,
  runSearchPick,
  closeSearch,
  symbolOpen,
  symbolInputRef,
  symbolQuery,
  setSymbolQuery,
  handleSymbolKey,
  isSymbolLoading,
  symbolResults,
  symbolIndex,
  runSymbolPick,
  closeSymbol
}) => (
  <>
    {commandOpen && (
      <Dialog
        onClose={closeCommand}
        ariaLabel="Palette de commandes"
        initialFocusRef={commandInputRef}
        overlayClassName="command-overlay"
        className="command-modal"
      >
          <div className="command-input-row">
            <input
              ref={commandInputRef}
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              onKeyDown={handleCommandKey}
              placeholder="Chercher une commande, une vue, une action..."
              aria-label="Rechercher une commande"
              className="command-input"
            />
            <span className="command-hint">Ctrl+K</span>
          </div>
          <div className="command-list custom-scrollbar">
            {filteredCommands.length === 0 && (
              <div className="command-empty">Aucune commande</div>
            )}
            {filteredCommands.map((cmd, index) => (
              <button
                type="button"
                key={cmd.id}
                className={`command-item ${index === commandIndex ? 'is-active' : ''}`}
                onClick={() => runCommand(cmd)}
              >
                <span className="command-label">{cmd.label}</span>
                {cmd.hint && <span className="command-shortcut">{cmd.hint}</span>}
              </button>
            ))}
          </div>
      </Dialog>
    )}

    {filePaletteOpen && (
      <Dialog
        onClose={closeFilePalette}
        ariaLabel="Ouverture rapide de fichier"
        initialFocusRef={filePaletteInputRef}
        overlayClassName="command-overlay"
        className="command-modal"
      >
          <div className="command-input-row">
            <input
              ref={filePaletteInputRef}
              value={filePaletteQuery}
              onChange={(e) => setFilePaletteQuery(e.target.value)}
              onKeyDown={handleFilePaletteKey}
              placeholder="Ouvrir un fichier (fuzzy)..."
              aria-label="Rechercher un fichier"
              className="command-input"
            />
            <span className="command-hint">Ctrl+P</span>
          </div>
          <div className="command-list custom-scrollbar">
            {isProjectFileListLoading && (
              <div className="command-empty">Indexation...</div>
            )}
            {!isProjectFileListLoading && filteredFiles.length === 0 && (
              <div className="command-empty">Aucun fichier</div>
            )}
            {!isProjectFileListLoading && filteredFiles.length > 0 && filteredFiles.map((item, index) => {
              const full = String(item.id || '');
              const base = full.split(/[\\/]/).pop() || full;
              const hint = item.hint === 'tab' ? 'tab' : full.replace(/\\/g, '/');
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`command-item ${index === filePaletteIndex ? 'is-active' : ''}`}
                  onClick={() => runFilePick(item.id)}
                >
                  <span className="command-label">{base}</span>
                  <span className="command-shortcut">{hint}</span>
                </button>
              );
            })}
          </div>
      </Dialog>
    )}

    {searchOpen && (
      <Dialog
        onClose={closeSearch}
        ariaLabel="Recherche dans le projet"
        initialFocusRef={searchInputRef}
        overlayClassName="command-overlay"
        className="command-modal is-wide"
      >
          <div className="command-input-row">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Rechercher dans le projet..."
              aria-label="Rechercher dans le projet"
              className="command-input"
            />
            <span className="command-hint">Ctrl+Shift+F</span>
          </div>

          <div className="command-list custom-scrollbar is-tall">
            {isSearchLoading && (
              <div className="command-empty">Recherche...</div>
            )}
            {!isSearchLoading && searchQuery.trim() && searchResults.length === 0 && (
              <div className="command-empty">Aucun résultat</div>
            )}
            {!isSearchLoading && searchResults.length > 0 && searchResults.map((result, index) => {
              const loc = `${result.file}:${result.line}:${result.column}`;
              const snippet = String(result.text || '');
              return (
                <button
                  type="button"
                  key={`${loc}-${index}`}
                  className={`command-item search-item ${index === searchIndex ? 'is-active' : ''}`}
                  onClick={() => runSearchPick(result)}
                >
                  <div className="search-left">
                    <div className="search-meta">{loc}</div>
                    <div className="search-snippet">{snippet}</div>
                  </div>
                  <span className="command-shortcut">Entrée</span>
                </button>
              );
            })}
          </div>
      </Dialog>
    )}

    {symbolOpen && (
      <Dialog
        onClose={closeSymbol}
        ariaLabel="Recherche de symboles"
        initialFocusRef={symbolInputRef}
        overlayClassName="command-overlay"
        className="command-modal is-wide"
      >
          <div className="command-input-row">
            <input
              ref={symbolInputRef}
              value={symbolQuery}
              onChange={(e) => setSymbolQuery(e.target.value)}
              onKeyDown={handleSymbolKey}
              placeholder="Rechercher un symbole..."
              aria-label="Rechercher un symbole"
              className="command-input"
            />
            <span className="command-hint">Ctrl+T</span>
          </div>

          <div className="command-list custom-scrollbar is-tall">
            {isSymbolLoading && (
              <div className="command-empty">Indexation des symboles...</div>
            )}
            {!isSymbolLoading && symbolQuery.trim() && symbolResults.length === 0 && (
              <div className="command-empty">Aucun symbole</div>
            )}
            {!isSymbolLoading && symbolResults.length > 0 && symbolResults.map((result, index) => (
              <button
                type="button"
                key={`${result.file}:${result.line}:${result.column}:${result.symbol}`}
                className={`command-item search-item ${index === symbolIndex ? 'is-active' : ''}`}
                onClick={() => runSymbolPick(result)}
              >
                <div className="search-left">
                  <div className="search-meta">{result.kind} · {result.file}:{result.line}</div>
                  <div className="search-snippet">{result.symbol} — {result.text}</div>
                </div>
                <span className="command-shortcut">Entrée</span>
              </button>
            ))}
          </div>
      </Dialog>
    )}
  </>
);

export default CommandCenterOverlays;
