// This CRA base ships no react-app-env.d.ts (app code is plain JS, checkJs:false,
// so it never needed ambient module declarations). AgentVerse is TS/TSX and does
// side-effect CSS imports, so it needs its own minimal declaration.
declare module '*.css';
