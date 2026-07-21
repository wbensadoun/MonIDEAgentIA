# Guide : Mode Auto-Routeur Intelligent

## Les 3 intentions principales

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

- Vous choisissez manuellement le mode (Ask, Plan, Agent).
- Vous restez maître du contrôle total.

## Providers disponibles

- Gemini
- Claude
- Kimi / Together
- Ollama (local)
- Multi-IA (équipe via le roster)

Le provider **Multi-IA** n'est plus une catégorie spéciale : il s'agit simplement du mode multi-agent qui utilise le roster configuré dans les Settings.
