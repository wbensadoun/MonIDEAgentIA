# Neven Core Lite

Version 2.3.0.

Ce socle ne remplace pas le routeur invisible existant. Il le compacte et lui donne une colonne vertebrale explicite pour les futurs agents, les futurs plugins et les futures politiques admin Neven.

## Principe

- Le client ne voit jamais le fournisseur ni le modele reel.
- Le backend choisit d'abord une intention interne, puis un role, puis un profil.
- Le routeur ne charge plus un catalogue brut si un sous-ensemble pertinent suffit.
- Sol porte le plan et l'orchestration.
- Luna porte l'implementation.
- Terra porte la QA, l'analyse et la verification.

## Contrat du core

- `haiku` : rapide, court, triviale.
- `luna` : code courant et correctifs bornes.
- `sol` : architecture, plan, coordination multi-etapes.
- `opus` : risque critique, securite, migration sensible.

## Capabilites de base

- `context-pack`
- `planning`
- `implementation`
- `qa`
- `git`
- `terminal`
- `byok`
- `preview`

## Ce qui est fait dans cette branche

- Un manifeste versionne `2.3.0`.
- Un plan interne qui choisit le role et le profil sans exposer le modele.
- Une selection compacte du catalogue agents/skills pour le prompt de classification.
- Des tests unitaires sur le role, le profil et la reduction du contexte.

## Ce qui reste a faire

- Brancher ce meme noyau sur les providers de completion pour reduire aussi les prompts d'execution.
- Brancher un rapport d'economie de tokens exploitable par l'admin Neven.
- Mettre en place les vraies politiques de priorisation BYOK par workspace et par capability.

## Critere de validation

- Le routeur continue de retourner le meme schema.
- Le prompt de classification devient plus compact.
- Les roles internes restent invisibles cote client.
- Les tests passent avant merge.
