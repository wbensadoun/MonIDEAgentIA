# Audit concurrentiel Code companion vs Claude Code

Date: 4 mai 2026

## Perimetre

Comparaison entre:

- les capacites actuelles visibles dans Code companion
- les fonctionnalites officielles de Claude Code verifiees jusqu'au changelog du 1 mai 2026

Code local examine:

- `client/src/hooks/useWorkflowRunner.js`
- `client/src/hooks/useAIPendingChanges.js`
- `client/src/components/Settings/index.js`
- `client/src/components/WorkflowManager/index.js`
- `client/src/components/AIChat/index.js`
- `main.js`
- `docs/cahier_des_charges.md`

Sources officielles Claude Code:

- Product page: <https://www.anthropic.com/product/claude-code>
- Changelog: <https://code.claude.com/docs/en/changelog>
- What's new: <https://code.claude.com/docs/en/whats-new>
- Claude Code on the web: <https://code.claude.com/docs/en/claude-code-on-the-web>
- VS Code integration: <https://code.claude.com/docs/en/ide-integrations>
- Checkpointing: <https://code.claude.com/docs/en/checkpointing>
- Subagents: <https://code.claude.com/docs/en/sub-agents>
- Settings / permissions: <https://code.claude.com/docs/en/settings>
- GitHub Actions: <https://code.claude.com/docs/en/github-actions>
- Agent SDK: <https://code.claude.com/docs/en/agent-sdk/overview>
- Monitoring: <https://code.claude.com/docs/en/monitoring-usage>
- Plugins: <https://code.claude.com/docs/en/plugins>
- Plugin announcement: <https://claude.com/blog/claude-code-plugins>
- Web announcement: <https://claude.com/blog/claude-code-on-the-web>
- Autonomy announcement: <https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously>

## Synthese executive

Le retard commercial ne vient pas seulement du modele.

Il vient surtout du fait que Claude Code a transforme l'agent de code en produit complet, lisible et rassurant:

- plusieurs surfaces d'execution: terminal, VS Code, web, mobile
- plusieurs niveaux d'autonomie: plan, auto, background, cloud
- plusieurs couches de confiance: permissions, checkpoints, rewind, worktrees, PR review
- plusieurs couches d'extension: plugins, MCP, subagents, hooks, SDK
- plusieurs couches d'industrialisation: GitHub Actions, auto-fix PR, monitoring, politiques d'entreprise

La bonne nouvelle: Code companion a deja beaucoup de briques de base.

Vous avez deja:

- un vrai shell desktop AI-native
- un terminal agentique avec confirmations
- des pending changes
- des snapshots IA
- des quality gates
- du multi-agent
- des skills
- des packs/catalogues
- un workflow visuel
- une preview live

Le probleme est donc moins "il manque 100 features" que:

- les briques ne sont pas encore assemblees en surfaces produit evidentes
- l'autonomie n'est pas encore vendue comme un systeme coherent
- l'extension et le cloud ne sont pas encore des produits de premier plan

Conclusion:

- ne copiez pas Claude Code partout
- rattrapez Claude Code sur les couches visibles de confiance, autonomie et distribution
- utilisez votre avantage: IDE desktop visuel + orchestration locale + workflows orientes code

## Ce que Claude Code fait maintenant

Ce point est verifie contre les docs officielles et le changelog public jusqu'au 1 mai 2026.

### 1. Agent code "project-level", pas simple chat code

La page produit Anthropic positionne Claude Code comme un systeme qui:

- lit la codebase complete
- modifie plusieurs fichiers
- lance des commandes
- relance tests et builds
- produit du code committable

Ce n'est pas vendu comme un copilote de ligne, mais comme un executant de taches entieres.

### 2. Execution locale, IDE, cloud et mobile

Claude Code ne vit plus uniquement dans le terminal.

Anthropic pousse maintenant:

- terminal natif
- extension VS Code native
- sessions cloud sur `claude.ai/code`
- suivi mobile des sessions cloud

La doc "Claude Code on the web" decrit un mode `--remote` / `--teleport` pour envoyer une tache dans le cloud puis la rapatrier localement.

Le billet du 20 octobre 2025 insiste aussi sur l'execution parallele de plusieurs taches cloud avec creation de PR.

### 3. Planification, delegation et sous-agents

Claude Code a pousse fortement le modele "agent manager + workers".

Les docs et le changelog montrent:

- subagents avec prompt dedie
- contexte separe par subagent
- permissions et outils distincts
- execution en background
- delegation automatique ou explicite
- travail parallele

Le point cle commercialement: l'utilisateur percoit une vraie equipe d'agents, pas seulement un prompt plus long.

### 4. Confiance et controle

Claude Code a beaucoup investi dans la sensation de securite:

- permissions fines
- modes de permission
- mode auto avec classifieur de risque
- checkpoints automatiques
- `/rewind` pour revenir en arriere
- worktrees Git pour isoler des runs
- review des plans avant execution dans VS Code

Le changelog et la page "What's new" montrent que ce chantier continue encore en avril et mai 2026.

### 5. PR, CI et boucle GitHub

Claude Code ne s'arrete pas a "editer des fichiers".

Les surfaces officielles couvrent:

- `@claude` dans PR et issues via GitHub Actions
- creation de pull requests
- review automatique
- auto-fix des PR sur echec CI ou commentaire reviewer
- `/autofix-pr`
- `ultrareview` en preview cloud multi-agent

Commercialement, c'est enorme: Claude Code se branche directement sur le flux de livraison, pas seulement sur l'IDE.

### 6. Plateforme d'extensions

Depuis octobre 2025, Claude Code a un vrai systeme de plugins.

Les plugins peuvent embarquer:

- skills
- agents
- hooks
- MCP servers

et ils peuvent etre distribues via des marketplaces.

Ce n'est pas juste une "bibliotheque de prompts". C'est une couche de distribution produit.

### 7. Connecteurs et outils externes

Claude Code s'appuie sur:

- MCP
- Agent SDK
- hooks
- GitHub proxy
- monitoring / OpenTelemetry

Cela lui permet d'etre extensible sans tout reconstruire en dur.

### 8. Nouveautes tres recentes a surveiller

Les digests d'avril 2026 montrent des fonctions qui comptent commercialement:

- auto mode en research preview
- computer use dans le CLI
- `/powerup` pour onboarder les utilisateurs
- `ultraplan`
- `ultrareview`
- routines cloud declenchees par schedule / event / API
- recap de session quand on revient apres absence
- PowerShell tool natif pour Windows

Tout n'est pas prioritaire a copier.
Mais cela montre la direction: Claude Code devient un systeme d'orchestration multi-surface, pas juste un assistant.

## Ou votre produit est deja solide

Il ne faut pas sous-estimer ce que vous avez deja.

### 1. IDE desktop AI-native

Votre produit integre nativement:

- editeur
- terminal
- git
- preview
- workflows visuels
- IA dans le meme shell de travail

C'est une base plus "poste de travail IA" que beaucoup d'outils concurrents.

### 2. Trust primitives deja presentes

Vous avez deja des briques que Claude Code met en avant:

- modes permissions `read_only`, `edit`, `edit_terminal` dans `client/src/components/Settings/index.js:293-305`
- confirmation terminal IA dans `client/src/components/Settings/index.js:282-289`
- quality gates avant application dans `client/src/components/Settings/index.js:367-408`
- snapshot automatique avant application de changements dans `client/src/hooks/useAIPendingChanges.js:92-110`
- stockage et restauration de snapshots dans `main.js:4506-4625`

Autrement dit: la matiere premiere du "safe autonomy" est deja la.

### 3. Multi-agent local

Vous avez deja un vrai pipeline multi-agent local avec:

- Architecte
- Codeur
- Relecteur

visible dans `main.js:6412-6684`.

Ce n'est pas encore package comme Claude Code, mais la logique produit existe deja.

### 4. Packs, skills et subagents

Vous avez deja une pre-version de plateforme d'extensions:

- import de subagents `awesome-claude-code-subagents` dans `client/src/components/WorkflowManager/index.js:502-516`
- catalogues de skills dans `client/src/components/WorkflowManager/index.js:518-620`
- import technique des subagents dans `main.js:5633-5689`

Cela compte beaucoup: vous n'etes pas en train de partir de zero sur ce sujet.

### 5. Streaming de travail et feedback visuel

Le chat affiche deja:

- streaming des tokens
- cartes d'actions terminal
- streaming de code
- streaming de workflow

dans `client/src/components/AIChat/index.js:107-204`.

Vous avez donc deja une UX "l'agent travaille devant moi".

### 6. Differenciation visuelle

Vous avez un angle tres defendable que Claude Code n'occupe pas autant:

- orchestration visuelle
- import de workflows
- generation IA de workflows
- poste de travail desktop AI-first

## Les vrais manques, vus depuis le marche

### 1. Il manque une surface "cloud task / async agent"

C'est probablement le plus grand ecart percu.

Claude Code permet:

- d'envoyer une tache dans le cloud
- de la laisser tourner
- de la suivre ailleurs
- de la transformer en PR
- de passer du web au local et retour

Votre `docs/cahier_des_charges.md` vise deja exactement cette direction:

- client lourd local
- intelligence hebergee
- experience cle en main

Mais aujourd'hui ce n'est pas encore une surface produit visible.

### 2. Il manque une UX de checkpoints/rewind

Vous avez les snapshots.
Mais vous n'avez pas encore l'equivalent d'un:

- historique de checkpoints par session
- timeline
- restore conversation / restore code
- bouton rewind tres visible

Donc la capacite existe plutot comme infrastructure que comme feature vendable.

### 3. Il manque une vraie couche plugin/marketplace unifiee

Vous avez des packs, des skills et des subagents.

Mais commercialement il manque:

- un format manifeste unique
- une notion claire d'extension installable
- activation / desactivation / update
- permissions par extension
- distribution equipe / marketplace

Aujourd'hui, cela ressemble plus a un lot d'imports qu'a une plateforme.

### 4. Il manque une isolation forte des runs

Claude Code a beaucoup renforce:

- worktrees
- branches dediees
- sessions cloud isolees
- subagents a contexte separe

Chez vous, les agents et workflows travaillent encore trop pres de la working tree principale.

Le risque percu reste donc plus eleve.

### 5. Il manque la boucle PR / CI / review

Vous avez Git et quality gates.
Mais il manque encore:

- ouvrir une PR depuis une tache
- surveiller les echec CI
- auto-fix sur commentaire reviewer
- revue de code automatisee exploitable par l'equipe

Pour la vente B2B, c'est decisif.

### 6. Il manque une memoire projet/equipe vraiment produit

Claude Code a structure:

- memoire utilisateur
- memoire projet
- memoire equipe/policy
- auto memory

Chez vous, il y a des skills et des agents, mais pas encore une couche memoire simple a expliquer comme avantage produit central.

### 7. Il manque l'observabilite de l'agent

Claude Code publie:

- metrics
- traces
- evenements
- usage
- cout
- plugins installes
- changements de permission

Chez vous, il y a du feedback runtime, mais pas encore de vision "analytics de l'agent".

## Recommandations prioritaires

Je ne recommande pas de courir derriere chaque nouveaute Claude Code.

Je recommande 5 paris tres visibles.

### P0. Productiser ce que vous avez deja

Objectif: transformer les primitives existantes en surfaces produit lisibles.

Faire:

- renommer les modes en langage produit: `Ask`, `Plan`, `Apply`, `Autonomous`
- exposer les snapshots comme "Checkpoints" avec timeline et bouton `Rewind`
- afficher clairement le resume de quality gates avant application
- stocker une "session recap" a la fin d'une tache
- rendre la vue des pending changes plus orientee "task review"

Pourquoi c'est prioritaire:

- faible cout relatif
- gros gain de perception
- base ideale pour le discours commercial "autonomie sous controle"

### P0. Ajouter un vrai mode `Plan`

Vous avez deja beaucoup de logique de preparation.
Il faut maintenant l'assumer comme mode utilisateur distinct.

Faire:

- lecture et exploration autorisees
- aucune ecriture sans validation
- plan editable avant lancement
- option "executer localement" ou "envoyer dans le cloud"

Claude Code le fait tres bien dans son extension VS Code.
Vous devez avoir votre equivalent.

### P0. Isoler chaque run dans une branche ou un worktree

C'est probablement le meilleur ratio impact / complexite.

Faire:

- un worktree ou une branche dediee par run autonome
- diff clair entre base et proposition
- merge/reject explicite
- nettoyage simple du run

Effet:

- baisse immediate de la peur utilisateur
- meilleur discours enterprise
- fondation pour cloud tasks et subagents paralleles

### P1. Lancer un vrai produit "Cloud Tasks"

C'est la feature la plus importante commercialement.

Faire:

- bouton `Run in cloud`
- execution asynchrone distante
- page sessions/taches
- reprise locale d'une session
- creation de PR
- config reseau autorisee par projet

Et surtout:

- le faire dans votre logique hybride deja decrite dans `docs/cahier_des_charges.md`

Si vous ne mettez qu'une seule grosse feature sur la roadmap pour rattraper la perception marche, c'est celle-ci.

### P1. Transformer Packs en Plugins

Vous avez deja les ingredients.
Il faut les unifier.

Faire:

- manifeste unique pour une extension
- une extension peut contenir `skills`, `agents`, `hooks`, `connectors`
- install / uninstall / enable / disable / update
- scope `project`, `global`, `team`
- permissions explicites par plugin
- un petit marketplace officiel

Au lieu de parler de "packs", parlez de "Plugins" ou "Extensions".
Le marche comprend tout de suite.

### P1. Industrialiser les subagents

Vous avez deja un pipeline Architecte / Codeur / Relecteur.
Passez a l'etape suivante:

- bibliotheque de subagents nommes
- prompt dedie par role
- outils autorises par role
- execution foreground/background
- contexte separe
- worktree optionnel par subagent

Et surtout:

- rendez cela visible dans l'UI

Claude Code ne vend pas seulement la technique des subagents.
Il vend la lisibilite de la delegation.

### P1. Ajouter la boucle PR / CI / review

Faire:

- `Create PR from task`
- `Watch PR`
- `Auto-fix CI`
- `Apply reviewer comments`
- `Summarize review findings`

Vous avez deja:

- Git
- quality gates
- multi-agent

Il vous manque surtout le produit autour.

### P2. Ajouter une couche MCP-style / connectors

Prioriser:

- GitHub
- Jira
- Sentry
- Figma
- Slack
- Postgres

Le but n'est pas seulement d'avoir plus d'outils.
Le but est de faire entrer votre agent dans les workflows reels de l'entreprise.

### P2. Ajouter observabilite et gouvernance

Faire:

- cout par session
- duree par tache
- nombre de fichiers touches
- nombre de rollbacks
- taux de succes des quality gates
- evenements d'agent exportables
- audit de permissions et commandes

Ce point devient indispensable si vous voulez vendre a des equipes.

## Ce qu'il ne faut pas copier en premier

Ne perdez pas du temps trop tot sur:

- themes
- gimmicks cosmetiques de terminal
- `/powerup`
- voice
- computer use desktop
- features experimentales tres "wow"

Ces choses sont utiles pour l'adoption plus tard.
Elles ne resoudront pas votre retard commercial principal.

## Votre meilleur positionnement

Le bon slogan produit n'est probablement pas:

- "un autre Claude Code"

Le bon angle est plutot:

- "la station de travail agentique la plus visible et la plus controlable pour construire, tester et livrer du code"

ou encore:

- "le meilleur poste de travail local+cloud pour orchestrer des agents de dev avec controle humain, workflows visuels et revue de changements"

Autrement dit:

- Claude Code gagne aujourd'hui sur la profondeur de l'autonomie
- vous pouvez gagner sur l'orchestration visible, la confiance et l'hybride local+cloud

## Roadmap recommandee sur 90 jours

### 0 a 30 jours

- sortir `Plan mode`
- sortir `Checkpoints + Rewind` par-dessus l'infra snapshot
- isoler les runs en branche ou worktree
- clarifier les modes de permission et les quality gates dans l'UI
- renommer `Packs` en `Extensions` ou `Plugins (beta)`

### 30 a 60 jours

- subagents nommes et configurables
- execution background
- recap de session
- page `Tasks`
- diff/review de plan et de run
- premier format manifeste pour extensions

### 60 a 90 jours

- `Run in cloud`
- reprise locale d'une session cloud
- `Create PR`
- `Auto-fix CI`
- premier connecteur GitHub enterprise-friendly
- telemetry minimale session/cout/duree/succes

## Verdict

Claude Code va vite, oui.

Mais votre situation n'est pas "trop tard".
Votre situation est plutot:

- vous avez deja les primitives
- Anthropic a deja montre comment les empaqueter
- il faut maintenant choisir les 4 ou 5 surfaces qui changent la perception du produit

Si je devais prioriser brutalement:

1. `Plan mode`
2. `Checkpoints + Rewind`
3. `Run isolation via branch/worktree`
4. `Cloud Tasks`
5. `Plugins`
6. `PR / CI auto-fix`

Le plus important:

- ne vendez plus seulement des "features IA"
- vendez un systeme d'autonomie controlable, visible, reversible et industrialisable

