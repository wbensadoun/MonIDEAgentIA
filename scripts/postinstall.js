'use strict';

// Wrapper autour de `electron-builder install-app-deps`, qui recompile en
// natif tout module trouve dans node_modules sans savoir reconnaitre les
// modules N-API (ABI-stable, donc pas besoin de recompilation) — c'est le cas
// de node-pty, qui casse cette etape avec "Could not find any Visual Studio
// installation" des qu'aucun toolchain C++ n'est present sur la machine, alors
// meme que node-pty fonctionne deja tel quel dans le vrai runtime Electron.
//
// `build.npmRebuild: false` (package.json) desactive ce rebuild pendant le
// PACKAGING (`npm run build`), mais pas pendant cette etape postinstall — les
// deux chemins de code sont distincts cote electron-builder. Ce wrapper couvre
// donc le second cas : ne jamais faire echouer `npm install` pour une
// recompilation dont ce projet n'a pas besoin aujourd'hui.
//
// Garde volontairement best-effort pour un futur module natif qui, lui,
// aurait vraiment besoin d'etre recompile : on tente toujours le rebuild,
// on avertit juste au lieu de faire planter l'installation s'il echoue.

const { spawnSync } = require('child_process');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', 'install-app-deps'],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  process.stdout.write(
    '\n[postinstall] electron-builder install-app-deps a echoue (probablement '
    + 'l\'absence d\'outils de compilation C++ sur cette machine).\n'
    + '[postinstall] Sans effet sur node-pty (module N-API, deja fonctionnel '
    + 'sans recompilation). npm install continue normalement.\n\n'
  );
}

process.exit(0);
