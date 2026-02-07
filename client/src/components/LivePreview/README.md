# LivePreview Component

Composant React pour afficher une application web en temps réel dans une iframe sécurisée, idéal pour les IDE type Lovable/Replit.

## 🎯 Objectif

Afficher le rendu d'une application web (React/Vite/Next) dans un environnement isolé avec gestion des états et auto-reload.

## 📁 Structure

```
client/src/components/LivePreview/
├── index.js           # Composant React
└── LivePreview.css    # Styles
```

## 🔧 Props

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `projectId` | string | required | ID unique du projet |
| `status` | 'running' \| 'stopped' \| 'error' | 'stopped' | État du serveur de preview |
| `previewUrl` | string \| null | null | URL custom (sinon /preview/{projectId}) |
| `onRefresh` | function | null | Callback appelé au refresh manuel |
| `className` | string | '' | Classes CSS additionnelles |

## 🎨 États UI

### 1. **Loading** (Skeleton)
- Affiché pendant le chargement initial
- Animation shimmer sur des éléments placeholder

### 2. **Running**
- Iframe visible avec l'application
- Indicateur vert pulsatif
- Bouton refresh actif

### 3. **Stopped**
- Overlay gris avec icône pause
- Message "Serveur arrêté"
- Bouton pour démarrer

### 4. **Error**
- Overlay rouge avec icône alerte
- Message d'erreur détaillé
- Bouton "Réessayer"

## 🔒 Sécurité Iframe

```javascript
sandbox="allow-scripts allow-forms allow-same-origin"
```

- ✅ `allow-scripts` : Exécution JavaScript
- ✅ `allow-forms` : Soumission de formulaires
- ✅ `allow-same-origin` : Accès same-origin (pour les cookies/localStorage)
- ❌ Pas de `allow-top-navigation` : Empêche la navigation top-level

## 🚀 Utilisation

### Exemple basique

```jsx
import LivePreview from './components/LivePreview';

function App() {
  const [status, setStatus] = useState('stopped');
  
  return (
    <LivePreview
      projectId="mon-projet-123"
      status={status}
      onRefresh={() => console.log('Preview rafraîchie')}
    />
  );
}
```

### Exemple avec contrôle

```jsx
function IDE() {
  const [previewStatus, setPreviewStatus] = useState('stopped');
  const [projectId] = useState('project-' + Date.now());

  const togglePreview = () => {
    setPreviewStatus(prev => 
      prev === 'running' ? 'stopped' : 'running'
    );
  };

  return (
    <div className="ide-layout">
      {/* Contrôles */}
      <button onClick={togglePreview}>
        {previewStatus === 'running' ? 'Arrêter' : 'Démarrer'} Preview
      </button>
      
      {/* Preview */}
      <LivePreview
        projectId={projectId}
        status={previewStatus}
        previewUrl={`http://localhost:3001/preview/${projectId}`}
        onRefresh={() => {
          // Recharger les données du projet
          reloadProject();
        }}
      />
    </div>
  );
}
```

## 🔄 Auto-reload

Le composant gère automatiquement le reload quand :
- Le `status` passe de `'stopped'` à `'running'`
- Le `status` passe de `'error'` à `'running'`
- L'utilisateur clique sur le bouton refresh

```javascript
// Dans le composant
useEffect(() => {
  if (isRunning && (wasStopped || hadError)) {
    // Auto-reload après 500ms
    setTimeout(handleManualRefresh, 500);
  }
}, [status]);
```

## 🛠️ Intégration dans l'IDE

### Layout recommandé

```
┌─────────────────────────────────────────────────────────┐
│  File Explorer  │   Code Editor   │   AI Chat (50%)    │
│    (25%)        │    (50%)        ├────────────────────┤
│                 │                 │   LivePreview(50%) │
└─────────────────────────────────────────────────────────┘
```

### Code d'intégration

```jsx
// App.js
import LivePreview from './components/LivePreview';

const App = () => {
  const [previewStatus, setPreviewStatus] = useState('stopped');
  
  const handleTogglePreview = () => {
    setPreviewStatus(prev => 
      prev === 'running' ? 'stopped' : 'running'
    );
  };

  return (
    <div className="flex h-screen">
      {/* File Explorer */}
      <div className="w-1/4">
        <FileExplorer />
      </div>
      
      {/* Code Editor */}
      <div className="w-1/2">
        <CodeEditor />
      </div>
      
      {/* Right Panel: AI + Preview */}
      <div className="w-1/4 flex flex-col">
        <div className="h-1/2">
          <AIChat />
        </div>
        <div className="h-1/2">
          <LivePreview
            projectId={currentProject}
            status={previewStatus}
          />
        </div>
      </div>
    </div>
  );
};
```

## 🎨 Personnalisation

### Modifier les couleurs

```css
/* LivePreview.css */
.status-running {
  color: #10b981; /* Vert */
}

.status-error {
  color: #ef4444; /* Rouge */
}
```

### Modifier le skeleton

```css
.skeleton-line {
  background: linear-gradient(90deg, #custom 25%, #color 50%, #custom 75%);
}
```

## 🔌 Backend nécessaire

Le composant attend une route qui sert l'application :

```javascript
// Express.js exemple
app.get('/preview/:projectId', (req, res) => {
  const { projectId } = req.params;
  
  // Vérifier si le projet existe et est buildé
  const projectPath = `./projects/${projectId}/dist`;
  
  if (!fs.existsSync(projectPath)) {
    return res.status(404).send('Project not built yet');
  }
  
  // Servir les fichiers statiques
  express.static(projectPath)(req, res);
});
```

## 📱 Responsive

Le composant s'adapte automatiquement :
- Desktop : Hauteur fixe ou flexible
- Tablet/Mobile : S'adapte au conteneur parent

```css
@media (max-width: 768px) {
  .live-preview-header {
    padding: 0.5rem;
  }
}
```

## ✅ Bonnes pratiques

1. **Toujours utiliser `sandbox`** sur l'iframe
2. **Ne jamais** exposer de tokens/credentials dans la preview
3. **Nettoyer** les ressources quand le composant unmount
4. **Gérer** les erreurs réseau gracieusement
5. **Limiter** la fréquence des refresh manuels

## 🐛 Debug

### La preview ne charge pas
- Vérifier que `status` est bien `'running'`
- Vérifier que l'URL est accessible
- Vérifier les logs réseau (F12)

### L'iframe reste blanche
- Vérifier que le serveur répond (200 OK)
- Vérifier les CSP (Content Security Policy)
- Vérifier les erreurs CORS

### Refresh infini
- Vérifier que `status` ne change pas en boucle
- Ajouter un debounce sur le refresh

## 📝 Changelog

**v1.0.0**
- ✅ Composant LivePreview
- ✅ Gestion des 4 états (loading, running, stopped, error)
- ✅ Skeleton loader animé
- ✅ Auto-reload on status change
- ✅ Iframe sandbox sécurisée
- ✅ Bouton refresh manuel
- ✅ Gestion des erreurs iframe
