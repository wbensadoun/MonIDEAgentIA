import React, { useRef, useEffect } from 'react';
import './CodeEditor.css';

const CodeEditor = ({
  activeFile,
  code,
  lineNumbers,
  previousCode,
  onCodeChange,
  onUndo
}) => {
  const codeEditorRef = useRef(null);

  useEffect(() => {
    if (codeEditorRef.current) {
      codeEditorRef.current.scrollTop = codeEditorRef.current.scrollHeight;
    }
  }, [code]);

  const handleChange = (e) => {
    onCodeChange(e.target.value);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-black bg-opacity-20 text-gray-300 p-3 text-center font-semibold text-md border-b border-gray-700">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-400 to-white">
          Éditeur :
        </span>
        <span className="text-cyan-400 ml-2">
          {activeFile ? activeFile : 'Aucun fichier ouvert'}
        </span>
      </div>

      <div className="flex flex-row flex-grow overflow-hidden">
        <textarea
          className="w-14 line-numbers text-gray-500 p-4 text-right resize-none outline-none font-mono text-sm leading-6 custom-scrollbar"
          value={lineNumbers}
          readOnly
        />
        <textarea
          ref={codeEditorRef}
          className="flex-grow p-4 bg-transparent text-gray-100 outline-none font-mono text-sm leading-6 resize-none custom-scrollbar"
          value={code}
          onChange={handleChange}
          placeholder="Sélectionnez un fichier..."
          disabled={!activeFile}
          spellCheck={false}
        />
      </div>

      {activeFile && previousCode && (
        <button
          onClick={onUndo}
          className="btn-hover-effect focus-ring bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 text-sm transition-colors"
        >
          Annuler la modif. IA
        </button>
      )}
    </div>
  );
};

export default CodeEditor;
