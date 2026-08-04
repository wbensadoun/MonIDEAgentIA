# Code companion

Un IDE desktop intelligent avec agent IA intgr (Google Gemini) pour dvelopper plus rapidement.

##  Architecture

- **Frontend** : React 18 + Tailwind CSS
- **Desktop** : Electron 37
- **IA** : Google Gemini API (`gemini-3-flash-preview`) avec support Claude, Kimi et Ollama
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

###  Agent IA
- Prompts avec contexte projet complet
- Modification automatique de fichiers
- Cration de nouveaux fichiers
- Sauvegarde des conversations

### 🧭 Routeur Intelligent
- Trois modes d'exécution : Ask 💬 (discussion), Plan 📋 (planification) et Agent 🔧 (action, avec diffs à approuver)
- Toggle Auto-Route ⚡ : l'IDE choisit lui-même le mode et le nombre d'agents
- Décision en 2 niveaux : L1 = heuristique locale instantanée pour les demandes triviales ; L2 = classification par un modèle léger pour les cas ambigus, qui tranche entre un agent unique et une équipe multi-agents
- Guide complet : [docs/USER_GUIDE_ROUTER.md](docs/USER_GUIDE_ROUTER.md)

##  Installation

```bash
# 1. Cloner le projet
git clone <repo>
cd Code Companion

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
| `npm run whatsapp-bridge` | Webhook WhatsApp -> Ollama (Qwen) |
| `npm run build` | Build complet pour production |
| `npm run build:win-installer` | Gnre un vrai installateur Windows (`Setup.exe`) |
| `npm run postinstall` | Installation des deps Electron |

### Installer Windows (Setup.exe)

Pour une installation "comme une vraie app", utilise :
```bash
npm run build:win-installer
```

Le fichier d'installation sera dans `dist/` (type `Setup.exe`).

Important: les dpendances npm sont intgres au build. L'utilisateur final n'a pas besoin d'excuter `npm install`.

## Ollama + WhatsApp (commandes)

1. Installer et verifier Ollama.
```bash
ollama list
ollama pull qwen3:latest
```

2. Dans l'app, ouvrir `Settings` puis choisir `Provider IA par defaut = Ollama`, et selectionner un modele Qwen.

3. Configurer `.env` (Meta WhatsApp Cloud API):
```env
WHATSAPP_VERIFY_TOKEN=ton_token_verification
WHATSAPP_ACCESS_TOKEN=ton_token_temp_ou_long_lived
WHATSAPP_PHONE_NUMBER_ID=ton_phone_number_id
WHATSAPP_APP_SECRET=ton_app_secret_meta
WHATSAPP_ALLOWED_NUMBERS=33612345678
WHATSAPP_OLLAMA_MODEL=qwen3:latest
WHATSAPP_EXEC_ENABLED=true
WHATSAPP_EXEC_ALLOWLIST=ollama list,git status,git diff
```

4. Lancer le bridge:
```bash
npm run whatsapp-bridge
```

5. Exposer le webhook en dev:
```bash
ngrok http 3030
```
Configurer dans Meta le webhook `https://<ngrok>/webhook` avec le meme `WHATSAPP_VERIFY_TOKEN`.

6. Commandes WhatsApp disponibles:
```text
/help
/model
/model qwen3:latest
/ask explique ce bug...
/exec ollama list
```

Note securite: par defaut, le bridge refuse les numeros absents de `WHATSAPP_ALLOWED_NUMBERS` et les POST non signes (`x-hub-signature-256`). En dev seulement, `WHATSAPP_ALLOW_ALL_SENDERS=true` ou `WHATSAPP_DISABLE_SIGNATURE_VERIFY=true` permettent de lever ces garde-fous explicitement. Ne mets jamais une allowlist trop large pour `/exec`.

##  Structure du projet

```
Code Companion/
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
