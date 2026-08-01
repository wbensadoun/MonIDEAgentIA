# Cahier des Charges & Business Plan : Code Companion

Ce document rassemble les spécifications fonctionnelles, l'architecture technique, le modèle économique et le budget prévisionnel pour le logiciel "Code Companion" (nom de code provisoire).

---

## 1. Vision et Proposition de Valeur

**Le Problème :** Les outils d'automatisation IA (AutoGPT, Devin) sont des boîtes noires coûteuses et effrayantes pour la majorité des développeurs, DSI et non-techniciens. L'hébergement de modèles locaux ou la configuration de clés API (OpenAI/Anthropic) imposent une friction technique massive bloquant l'adoption grand public.

**La Solution :** Un IDE (Environnement de Développement Intégré) visuel et interactif, propulsé par un système multi-agents IA **clé en main**. 
- Aucune installation complexe (Ollama ou clés API non requises par défaut).
- Les processus métiers complexes s'assemblent visuellement (drag & drop) et s'exécutent de façon transparente en coulisses.
- Une expérience SaaS "Plug & Play" où l'IA travaille pour l'utilisateur dès la première seconde.

---

## 2. Piliers Fonctionnels de l'Application

### 2.1 Interface et Espace de Travail (Frontend)
- **Tableau de Bord Principal (IDE) :** Un affichage multi-panneaux personnalisable (Explorateur de fichiers, Éditeur de Code, Terminal, Editeur de Workflows).
- **Le "Terminal Animé" :** Visualisation en temps réel de la "pensée" de l'IA. L'utilisateur voit l'IA taper des commandes, lire les erreurs, et se corriger elle-même via les "Cartes ReAct" (Reasoning+Acting).
- **Chat Contextuel (Omniscient) :** Un assistant IA (Gemini/Claude) conscient du projet global, des onglets ouverts et de la ligne de code en surbrillance. Suggestions proactives via des "Chips" (ex: "Ajouter des tests", "Refactorer cette fonction").

### 2.2 Moteur de Workflows Visuels (No-Code/Low-Code)
- **Éditeur Drag & Drop :** Interface intuitive (basée sur React Flow) pour relier des tâches.
- **Nœuds Spécialisés :**
  - *Déclencheurs (Triggers)* : Bouton manuel, webhook, cron job.
  - *Actions (Exécution)* : Commandes terminal (npm, bash), Git, lecture/écriture système de fichiers.
  - *Intelligence (IA)* : Envoi de prompts dynamiques aux LLM (extraction de données, traduction, analyse).
  - *Logique* : Conditions (If/Else), Boucles de réessai (Fallback).
- **Catalogue Communautaire (n8n compatible) :** Importation en un clic de milliers de workflows open-source existants (Salesforce -> Slack, GitHub -> Notion, etc.).
- **Génération Magique (AI-to-Workflow) :** L'utilisateur décrit son besoin ("Fais un script de backup tous les soirs") et l'agent construit le diagramme visuel 100% fonctionnel automatiquement.

### 2.3 Système Multi-Agents "Emergent" (Backend)
L'intelligence de l'application repose sur la division du travail :
- **Agent Chef d'Orchestre (Premium LLM) :** Qualité de raisonnement absolue (ex: Gemini 2.5 Pro ou Claude 3.5 Sonnet) pour la planification, l'architecture logicielle et la compréhension du besoin humain.
- **Agents "Ouvriers" (Local/Dedicated LLM) :** Modèles plus petits, très rapides et économiques (ex: Llama 3 ou Qwen via des API serverless) pour le parsing de logs, la rédaction de petits tests unitaires ou la manipulation de fichiers de base.
- **Système de "Skills" Autonomes :** Lorsqu'un agent échoue et trouve finalement la solution (ex: corriger un bug de configuration Webpack obscure), l'insight est enregistré sous forme de "Skill". Les autres agents s'en serviront pour ne plus faire l'erreur.

---

## 3. Architecture Technique (SaaS Hybride "Clé en Main")

Contrairement à la version prototype (où l'utilisateur lance l'IDE sur les API de sa machine), le modèle "Clé en main" impose une architecture client-serveur robuste.

### Le Client Lourd (Desktop App)
- **Technologie :** Electron + React + Node.js
- **Distribution :** Exécutables natifs (.exe Windows, .dmg macOS, AppImage Linux).
- **Fonctionnement :** Lit et manipule le code source sur l'ordinateur de l'utilisateur (manipulation de fichiers, exécution shell native) avec les privilèges appropriés.

### L'Infrastructure Cloud (Backend SaaS)
- **Le rôle :** Héberger les cerveaux de l'application (les LLMs) pour faire tomber la barrière de l'installation ("Zéro Configuration"). L'app cliente envoie le *prompt* et le *contexte nécessaire*, le serveur cloud renvoie la *décision/l'action*.
- **Avantage "Privacy Option" :** Pour les grands comptes, le client peut être configuré pour pointer vers *leur* propre serveur d'IA interne (au lieu du vôtre).

---

## 4. Business Model (Modèle Économique)

### Le Produit : Freemium + Abonnement (SaaS Tier)

1. **Tier "Découverte" (Gratuit)**
   - Accès à l'IDE et à l'éditeur de workflows.
   - Mode "Bring Your Own Key" (L'utilisateur doit utiliser son propre `ollama` local ou sa clé OpenAI perso).
   - Limité en nombre de workflows actifs simultanés (ex: 3).

2. **Tier "Pro" - Clé en Main (Abonnement mensuel : ~19€ - 29€ / mois)**
   - **Le cœur de l'offre :** Pas de configuration. Utilise vos serveurs dédiés cloud, rapides et pré-configurés pour ce produit.
   - IA de très haute qualité garantie (accès proxyfié à vos quotas enterprise Gemini/Anthropic).
   - Génération de workflows par l'IA illimitée.
   - Synchronisation Cloud des Skills de l'utilisateur (ses agents apprennent de projet en projet de façon centralisée).

3. **Tier "Team / Entreprise" (Licence Annuelle par siège : ~49€ / mois)**
   - Tout le Pro + Partage sécurisé des Workflows au sein d'une organisation.
   - Bibliothèque de Skills partagée (L'agent de Bob apprend de la résolution de bug de l'agent d'Alice).
   - Option Zero-Data Retention certifiée par contrat (On-Prem / Déploiement Cloud Privé).

---

## 5. Exigences Techniques et Dimensionnement Cloud

Pour offrir l'expérience SaaS fluide ("Tier Pro"), vous devez héberger la partie inférence IA. Voici l'état des lieux technologique :

### A. Si vous optez pour du Serverless Inference (Hautement Recommandé pour démarrer)
Ne montez pas vos propres serveurs physiques GPU immédiatement. Achetez de l'intelligence "à la demande" très performante.
- **Fournisseurs (Ouvriers / Modèles Open-Source rapides) :**
  - **Groq** ou **Together AI**. Spécialisés dans les Llama 3 à une vitesse hallucinante (jusqu'à 800 tokens/seconde). C'est parfait pour les micro-tâches des "agents ouvriers" qui regardent le terminal.
  - *Coût estime :* Extrêmement faible (ex: 0.15$ à 0.50$ pour 1 million de tokens traités). Marge énorme sur un abonnement à 20$/mois.
- **Fournisseurs (Chefs d'Orchestre / Modèles Premium) :**
  - **Vertex AI (Google)** pour les modèles Gemini 2.5 Pro (les plus capables en code aujourd'hui avec contexte 1M).
  - Ou **Anthropic API** (Claude 3.5 Sonnet).
  - *Coût estime :* Plus cher (ex: 3$ à 15$ par million de tokens). À router intelligemment via l'IDE seulement quand c'est indispensable pour ne pas brûler les 20$/mois d'abonnement du client.

### B. Si vous exigez un serveur Ollama "Dédié" Cloud (Hébergement Brut)
Si vous voulez un contrôle absolu sur les poids des modèles ou fine-tuner un modèle métier spécifique (ex: modèle entraîné spécifiquement sur le format de workflow interne).
- **Hébergement Baremetal GPU :**
  - **RunPod** ou **Hetzner (Serveurs dédiés Cloud avec accélérateur)**.
- **Spécifications requises (Minimum pour servir un Llama-3-8B à des dizaines d'utilisateurs simultanés) :**
  - **GPU :** Au moins 1x NVIDIA A5000 (24GB VRAM) ou RTX 4090/3090. (Ollama/vLLM charge les poids en mémoire VRAM).
  - **RAM Système :** 32GB à 64GB.
  - **CPU :** Au moins 8C/16T modernes (pour la gestion réseau Node.js API Gateway).
  - **Stockage :** 512GB SSD NVMe (les poids des LLMs GGUF lisent massivement le disque au démarrage).
  - *Budget d'infrastructure mensuel de départ :* ~200$ à 500$ CHF par mois. (Trés rapidement rentable dès les 20/30 premiers abonnés s'ils payent 20€/mois).

---

## 6. Budget Prévisionnel Global (Première Année - MVP & Lancement)

Ici nous estimons un budget frugal pour valider le marché et acquérir les premiers 500 abonnés.

| Catégorie | Description de l'Outil / Service | Coût Estimé (12 mois) |
| :--- | :--- | :--- |
| **Infrastructures Cloud (API AI Serverless)** | Appels API Gemini Pro / Groq (pour router les utilisateurs SaaS qui s'abonnent). | Variables (Indexés sur le succès). Budget initial provisionné : ~2 000 € à 5 000 €. |
| **Backend & Base de Données (Moyen)** | Supabase / Firebase / Vercel (Gestion des authentifications, facturation Stripe, et base de données des Workflows partagés entre utilisateurs). | ~300 € (Tier Pro). |
| **Services Applicatifs** | Electron Builder (Certificats de signature Mac/Windows requis par l'OS pour éviter les alertes virus SmartScreen). | ~200 € / an (Certificats OV). |
| **Domaine et Hosting Vitrine** | Hébergement statique du site (Next.js) + Nom de domaine. | ~100 € |
| **Marketing (Acquisition Initiale)** | Publicité nichée (Twitter/X Tech, Reddit ads) + Lancement Product Hunt (Relations presse/Influenceurs tech). | ~2 000 € |
| **Développement (Ressources Humaines)** | Temps passé par le/les fondateurs + Aide d'experts ponctuels (Design UX/UI, Securité API). | *(Investissement personnel en temps non comptabilisé - "Sweat Equity")*. |
| **Total Estimation Bootstrapping** | *Coût fixe pour être crédible et commercialiser le logiciel SaaS Electron.* | **~4 600 € à 7 600 €** |

---

## 7. Plan d'Action (Go-to-Market Strategy)

### Phase 1 : Consolidation (Mois 1)
- L'IDE (Frontend/Electron) est 100% stable localement.
- Sécuriser l'API Gateway (Le backend web/Node.js intermédiaire qui recevra les requêtes de l'application cliente Electron et fera appel aux LLM en utilisant VOS clés secrètes serveur). Jamais les clés API ne doivent être codées dans l'application Electron finale.

### Phase 2 : Alpha Privée & Ajustement Produit (Mois 2)
- Recruter 10 à 50 bêta-testeurs (Sur LinkedIn, Discord de développeurs).
- Leur donner un accès "Premium" gratuit pendant 1 mois ("Clé en main").
- Observer la consommation réelle de tokens par abonné pour affiner la rentabilité des futurs 20€ d'abonnement. (Si l'utilisateur type brûle l'équivalent de 5€ de crédits Gemini par mois, la marge à 20€ est excellente, sinon il faut limiter l'IA chef de projet et déléguer vers Qwen/Groq).

### Phase 3 : Lancement Public "Freemium" (Mois 3)
- Lancement sur **Product Hunt** avec une vidéo percutante : "L'IDE multi-agents visuel qui travaille vraiment pour vous, clés en main".
- Cible : Les freelances web, petites agences de dev, PM/PO techniques, startupers.
- Mise en avant radicale de la facilité visuelle (le comparateur par rapport au terminal pur ou à Cursor).
- Mise en place péage Stripe inside the App (Upgrade to Pro -> Débloque le serveur Cloud AI en un clic).

---

**Conclusion** : Le produit `Code Companion` a un positionnement clair (l'hybridation entre la complexité des agents autonomes textuels via l'IDE, et la vulgarisation visuelle via les pipelines n8n intégrés). En soulageant la charge mentale d'installation et d'hébergement matériel via un SaaS par abonnement, l'outil devient financièrement accessible et surtout viable économiquement pour vous.
