# Architecture du Routeur Intelligent

## Vue d'ensemble

L'application utilise désormais un routeur unique et intelligent qui analyse les demandes de l'utilisateur en 2 couches avant de décider du mode d'exécution optimal.

## Couche 1 (L1) : Classification locale ultra-rapide

- Analyse heuristique des mots-clés de la demande.
- Détecte les tâches triviales en moins de 100 ms.
- Décision : mode simple (`single_agent`) ou indécis (passe en L2).
- Aucun appel réseau n'est effectué à ce stade.

## Couche 2 (L2) : Classification par LLM léger

- Si L1 est indécis, appelle un modèle léger (Gemini Flash, Claude Haiku, etc.) via le provider actif.
- Température ultra-basse (0.1) pour des décisions cohérentes.
- Résolution du modèle approprié (`light` vs `premium`) selon le provider et la complexité détectée.

## Décisions du routeur

| Complexité | Mode d'exécution | Profondeur | Usage |
|---|---|---|---|
| `light` | `single_agent` | `fast` | Une seule IA simple et rapide |
| `premium` | `multi_agent` | `deep` | Une équipe complète pour les tâches complexes |

## Convergence avec l'interface

Le routeur renvoie :

- `decision.mode` : `single_agent` | `orchestrator` | `multi_agent`
- `decision.complexity` : `light` | `premium`
- `execution.executionMode` : `agent` | `multi-agent`
- `execution.depth` : `fast` | `deep`
- `model.resolved` : le modèle physique à utiliser pour le provider actif

L'interface transforme ces valeurs en variables d'exécution (`effExecutionMode`, `effDepth`, `routerModelOverride`).

## Effort de raisonnement (v3.4.0)

L'utilisateur dispose d'un sélecteur d'effort de raisonnement (pill dans la barre de saisie du chat, façon Codex / Claude Code) qui **aiguille le routeur vers un profil interne plancher**, sans jamais voir ces profils : il ne voit que « Neven IA » (auto-route) ou son BYOK + modèle.

| Effort | Plancher de profil interne | Effet |
|---|---|---|
| `auto` (défaut) | — | Le routeur décide seul (comportement historique) |
| `low` | `luna` | Réponses rapides, tâches simples |
| `medium` | `sol` | Équilibre vitesse / profondeur |
| `high` | `opus` | Raisonnement approfondi |
| `ultra` | `opus` | Puissance maximale, multi-agents |

**Sémantique plancher (floor)** : le routeur peut monter au-dessus du niveau demandé (ex. prompt critique → `opus` même en `low`), jamais descendre en dessous. Le plancher s'applique sur les 4 chemins de décision : repli sans catalogue, L1 trivial, L2 classification LLM, et repli d'erreur.

**Circuit** :

1. UI : `ReasoningEffortPill` (AIChat) → `onReasoningEffortChange` (App.js) → `saveSettingsPatch({ reasoningEffort })` persiste dans le fichier de settings du main process (source de vérité) + localStorage (cache d'affichage).
2. Routeur BYOK/local : `resolveTrustedRouterConfiguration` (main.js) passe `reasoningEffort` au handler `route-request` → `raiseDecisionProfile` rehausse la décision.
3. Chemin managed Neven : `resolveProviderExecutionContext` (main.js) applique `applyReasoningEffortFloor` au profil dérivé du prompt avant l'appel gateway — le control plane choisit ensuite le modèle physique pour ce profil.

**Sécurité** : l'effort n'est ni un modèle ni une clé ; le renderer ne peut pas l'injecter dans les options de completion (source de vérité = settings backend, liste fermée `auto|low|medium|high|ultra` validée dans `normalizeSettings`). Les profils internes restent une métadonnée backend.

## Configuration utilisateur

> Statut actuel : il n'existe pas encore d'onglet Settings dédié au routeur. Ce qui suit décrit uniquement ce qui est réellement implémenté aujourd'hui.

- Le routeur est piloté par un simple booléen `autoRoute` (état local dans `useRunConfiguration.js`, activé par défaut).
- Il est exposé via le sélecteur d'agent dans AIChat (`client/src/components/AIChat/index.js`) : l'option **Auto (Sélection intelligente)** en haut de la liste active `autoRoute`, choisir un agent précis le désactive.
- L'effort de raisonnement (`reasoningEffort`) est exposé via la pill dédiée dans la barre de saisie du chat (voir section ci-dessus).
- Il n'y a pas de choix du modèle de classification par l'utilisateur.
- Il n'y a pas de seuil de complexité ajustable.

Si un onglet Settings → « Routeur Intelligent » avec choix du modèle de classification et seuil ajustable est implémenté par la suite, cette section devra être mise à jour pour refléter l'UI réelle (id d'onglet, noms de champs, valeur de seuil par défaut).

## Roster multi-agents

Chaque rôle (Frontend, API, QA, etc.) peut être configuré avec son propre provider (Ollama local ou cloud) et son propre modèle dans l'onglet **Multi-agents** des Settings. Le routeur ne force jamais une redirection globale : il délègue chaque agent à sa configuration de roster.

## Sécurité des données

- Le mode `ollama-multi` a été supprimé.
- Le drapeau `localPrivate` global a été supprimé.
- L'utilisateur contrôle entièrement la confidentialité via le roster : un agent peut utiliser Ollama local tand qu'un autre utilise Gemini/Claude.
