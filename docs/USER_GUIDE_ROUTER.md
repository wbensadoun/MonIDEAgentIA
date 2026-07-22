# Guide : Mode Auto-Routeur Intelligent

## Les 4 modes d'exécution

### 💬 Ask (Discussion)

- Lisez, explorez, posez des questions.
- L'IA ne propose jamais de modifications de fichier.
- Idéal pour : comprendre le code, brainstorm, recherche.

### 📋 Plan (Planification)

- Concevez une architecture ou un plan d'action.
- L'IA propose du contenu (texte, schémas, pseudo-code).
- Si elle génère du code, une notification vous invite à passer en `Agent`.
- Idéal pour : designs, stratégies, démonstration.

### 🔧 Agent (Action)

- Modifiez votre code directement.
- Vous voyez les diffs dans l'onglet "AI Changes".
- Vous approuvez ou rejetez avant application.
- Idéal pour : développement actif, refactoring, bug fix.

### 🤝 Collective (Équipe multi-agents manuelle)

- 4ᵉ mode, distinct des trois précédents : au lieu de laisser l'Auto-Routeur décider seul de déclencher une équipe (Swarm), vous configurez et lancez vous-même une équipe multi-agents (« Collective »).
- Vous choisissez la **profondeur** de l'équipe (Rapide ou Profond), la **formation** (le roster/template d'agents à utiliser) et pouvez activer/désactiver certains rôles de l'équipe individuellement.
- Idéal pour : garder la main sur la composition de l'équipe IA plutôt que de subir la décision automatique du routeur, par exemple pour forcer une équipe légère ou, à l'inverse, mobiliser volontairement plusieurs agents sur une tâche que le routeur aurait jugée simple.

**Accès :** ce mode est manuel, il apparaît donc uniquement quand vous reprenez le contrôle sur le choix du mode :
- soit en désactivant l'Auto-Routeur (sélecteur d'agent sur autre chose que « Auto »), le bouton `Collective` apparaît alors directement à côté de `Ask` / `Plan` / `Agent` ;
- soit en laissant l'Auto-Routeur activé et en dépliant le panneau **« ▸ Avancé »**, qui affiche les mêmes boutons de mode manuels sans désactiver l'Auto-Routeur.

## Auto-Routeur (⚡ Mode Intelligent)

Quand l'Auto-Routeur est **activé** :

- L'IDE analyse votre demande automatiquement.
- Pour les tâches **simples** (ex: "Explique cette ligne"), il utilise 1 agent.
- Pour les tâches **complexes** (ex: "Conçois une app complète"), il active l'équipe multi-agents.

Avantages :

- ⚡ Réponses instantanées pour les demandes simples.
- 🎯 Équipes expertes pour les défis complexes.
- 💰 Réduction des coûts token (pas d'overkill pour des tâches triviales).

Quand l'Auto-Routeur est **désactivé** :

- Vous choisissez manuellement le mode (Ask, Plan, Agent, Collective).
- Vous restez maître du contrôle total.

## Providers disponibles

- Gemini
- Claude
- Kimi / Together
- Ollama (local)
- Multi-IA (équipe via le roster)

Le provider **Multi-IA** n'est plus une catégorie spéciale : il s'agit simplement du mode multi-agent qui utilise le roster configuré dans les Settings.
