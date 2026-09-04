# Neven Core Lite

Version 2.4.1.

Ce socle ne remplace pas le routeur invisible existant. Il le compacte et lui donne une colonne vertebrale explicite pour les futurs agents, les futurs plugins et les futures politiques admin Neven.

## Principe

- Le client ne voit jamais le fournisseur ni le modele reel.
- Le backend choisit d'abord une intention interne, puis un role, puis un profil.
- Le routeur ne charge plus un catalogue brut si un sous-ensemble pertinent suffit.
- Sol porte le plan et l'orchestration.
- Luna porte l'implementation.
- Terra porte la QA, l'analyse et la verification.

## Contrat du core

- `lumen` : rapide, court, triviale.
- `luna` : code courant et correctifs bornes.
- `sol` : architecture, plan, coordination multi-etapes.
- `zenith` : risque critique, securite, migration sensible.

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

- Un manifeste versionne `2.4.1`.
- Un plan interne qui choisit le role et le profil sans exposer le modele.
- Une selection compacte du catalogue agents/skills pour le prompt de classification.
- Le meme plan est branche sur les completions normales ainsi que les chemins inline/ghost, dans le main process.
- Le contexte d execution transmet seulement profil, roles, capabilities et selection compacte ; aucun provider ou modele physique.
- Le branchement est desactive par defaut et s active uniquement cote backend avec `NEVEN_CORE_LITE_EXECUTION_ENABLED=true`, `1`, `on` ou `yes`.
- Si le catalogue agents/skills est vide ou indisponible, les options de completion restent inchangees et aucun appel LLM auxiliaire n est lance.
- La telemetrie d usage est explicitement hors perimetre COD-28 : ce ticket ne cree aucun evenement reseau ni stockage de tokens. Elle devra etre instrumentee et consentie dans un ticket dedie.
- Des tests unitaires sur le role, le profil et la reduction du contexte.

## Ce qui reste a faire

- Brancher un rapport d'economie de tokens exploitable par l'admin Neven.
- Mettre en place les vraies politiques de priorisation BYOK par workspace et par capability.
- Les completions normales imposent le provider du canal IPC cote main ; inline/ghost normalisent leur provider cote main avant la resolution profil-vers-modele. La politique de selection cross-provider (fallback, cout, disponibilite) reste hors perimetre et depend de COD-9.

## Critere de validation

- Le routeur continue de retourner le meme schema.
- Le prompt de classification devient plus compact.
- Les roles internes restent invisibles cote client.
- Les tests passent avant merge.
