import React from 'react';

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
      <div className="command-overlay" onClick={closeCommand}>
        <div className="command-modal" onClick={(e) => e.stopPropagation()}>
          <div className="command-input-row">
            <input
              ref={commandInputRef}
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              onKeyDown={handleCommandKey}
              placeholder="Chercher une commande, une vue, une action..."
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
                key={cmd.id}
                className={`command-item ${index === commandIndex ? 'is-active' : ''}`}
                onClick={() => runCommand(cmd)}
              >
                <span className="command-label">{cmd.label}</span>
                {cmd.hint && <span className="command-shortcut">{cmd.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

    {filePaletteOpen && (
      <div className="command-overlay" onClick={closeFilePalette}>
        <div className="command-modal" onClick={(e) => e.stopPropagation()}>
          <div className="command-input-row">
            <input
              ref={filePaletteInputRef}
              value={filePaletteQuery}
              onChange={(e) => setFilePaletteQuery(e.target.value)}
              onKeyDown={handleFilePaletteKey}
              placeholder="Ouvrir un fichier (fuzzy)..."
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
        </div>
      </div>
    )}

    {searchOpen && (
      <div className="command-overlay" onClick={closeSearch}>
        <div className="command-modal is-wide" onClick={(e) => e.stopPropagation()}>
          <div className="command-input-row">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Rechercher dans le projet..."
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
        </div>
      </div>
    )}

    {symbolOpen && (
      <div className="command-overlay" onClick={closeSymbol}>
        <div className="command-modal is-wide" onClick={(e) => e.stopPropagation()}>
          <div className="command-input-row">
            <input
              ref={symbolInputRef}
              value={symbolQuery}
              onChange={(e) => setSymbolQuery(e.target.value)}
              onKeyDown={handleSymbolKey}
              placeholder="Rechercher un symbole..."
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
        </div>
      </div>
    )}
  </>
);

export default CommandCenterOverlays;
