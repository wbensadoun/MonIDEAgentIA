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

## Configuration utilisateur

> Statut actuel : il n'existe pas encore d'onglet Settings dédié au routeur. Ce qui suit décrit uniquement ce qui est réellement implémenté aujourd'hui.

- Le routeur est piloté par un simple booléen `autoRoute` (état local dans `useRunConfiguration.js`, activé par défaut).
- Il est exposé via le sélecteur d'agent dans AIChat (`client/src/components/AIChat/index.js`) : l'option **Auto (Sélection intelligente)** en haut de la liste active `autoRoute`, choisir un agent précis le désactive.
- Il n'y a pas de choix du modèle de classification par l'utilisateur.
- Il n'y a pas de seuil de complexité ajustable.

Si un onglet Settings → « Routeur Intelligent » avec choix du modèle de classification et seuil ajustable est implémenté par la suite, cette section devra être mise à jour pour refléter l'UI réelle (id d'onglet, noms de champs, valeur de seuil par défaut).

## Roster multi-agents

Chaque rôle (Frontend, API, QA, etc.) peut être configuré avec son propre provider (Ollama local ou cloud) et son propre modèle dans l'onglet **Multi-agents** des Settings. Le routeur ne force jamais une redirection globale : il délègue chaque agent à sa configuration de roster.

## Sécurité des données

- Le mode `ollama-multi` a été supprimé.
- Le drapeau `localPrivate` global a été supprimé.
- L'utilisateur contrôle entièrement la confidentialité via le roster : un agent peut utiliser Ollama local tand qu'un autre utilise Gemini/Claude.
