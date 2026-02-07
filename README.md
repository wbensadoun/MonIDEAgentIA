# Mon IDE Agent IA

Un IDE desktop intelligent avec agent IA intgr (Google Gemini) pour dvelopper plus rapidement.

##  Architecture

- **Frontend** : React 18 + Tailwind CSS
- **Desktop** : Electron 37
- **IA** : Google Gemini API (gemini-1.5-flash-latest)
- **Architecture** : 3 panneaux (Explorateur | diteur | Chat IA)

##  Fonctionnalits

###  Gestion de fichiers
- Explorateur avec arborescence rursive
- CRUD complet (fichiers & dossiers)
- Renommage, copie, dplacement
- Chargement la demande des dossiers

###  diteur de code
- dition en temps rel
- Numros de ligne synchroniss
- Auto-save automatique
- Undo spcifique pour modifications IA

###  Agent IA (Gemini)
- Prompts avec contexte projet complet
- Modification automatique de fichiers
- Cration de nouveaux fichiers
- Sauvegarde des conversations

##  Installation

```bash
# 1. Cloner le projet
git clone <repo>
cd MonIDEAgentIA

# 2. Installer les dpendances racine
npm install

# 3. Installer les dpendances client
npm install --prefix client

# 4. Configurer les variables d'environnement
cp .env.example .env
# diter .env avec votre cl API Gemini
```

##  Configuration

Crer un fichier `.env`  la racine :

```env
GEMINI_API_KEY=votre_cle_api_gemini
```

>  Obtenir une cl API : [Google AI Studio](https://makersuite.google.com/app/apikey)

##  Dmarrage

### Mode dveloppement
```bash
# Lancer React + Electron en parallle
npm run dev
```

Ou sparment :
```bash
# Terminal 1 : React dev server
npm run start-react

# Terminal 2 : Electron
npm run electron-dev
```

### Build production
```bash
# Build React + Electron
npm run build

# L'excutable sera dans /dist
```

##  Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | React + Electron en dveloppement |
| `npm run start-react` | Serveur React uniquement (port 3004) |
| `npm run electron-dev` | Electron avec attente du serveur |
| `npm run build` | Build complet pour production |
| `npm run postinstall` | Installation des deps Electron |

##  Structure du projet

```
MonIDEAgentIA/
├── main.js              # Processus principal Electron + IPC + API Gemini
├── preload.js           # Pont scuris entre Electron et React
├── assets/              # Icnes et ressources
├── client/
│   ├── src/
│   │   ├── App.js       # Composant principal (859 lignes  refactoriser)
│   │   ├── App.css      # Styles Tailwind + CSS custom
│   │   └── index.js     # Point d'entre React
│   └── package.json     # Dpendances React
└── package.json         # Dpendances Electron + build config
```

##  Amliorations prvoir

- [ ] Syntax highlighting (PrismJS / Monaco Editor)
- [ ] Autocompltion code
- [ ] Intgration Git (status, diff, commit)
- [ ] Tests unitaires (Jest + React Testing Library)
- [ ] TypeScript
- [ ] Error Boundaries
- [ ] Raccourcis clavier
- [ ] Prfrences utilisateur
- [ ] Systme de plugins

##  Technologies utilises

- [Electron](https://www.electronjs.org/)
- [React](https://reactjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Google Generative AI](https://ai.google.dev/)
- [Axios](https://axios-http.com/)

##  Licence

ISC

##  Auteur

[Dveloppeur]

---

**Note** : Ce projet est en cours de dveloppement actif.
