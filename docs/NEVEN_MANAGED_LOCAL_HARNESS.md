# Harness managed local

`npm run test:managed-harness` exécute, dans le main process simulé, le chemin managed complet : résolution du droit, appel gateway et texte retourné. Les clients control plane et gateway sont réutilisés avec un `fetch` injecté localement ; aucun provider, service distant ou credential réel n'est contacté.

Le harness couvre également un provider absent de la réponse, les grants expirés ou révoqués, le refus d'appareil, le timeout et une réponse gateway invalide. Il vérifie que provider, modèle, grant et clé ne sont pas exposés au renderer, à l'IPC ni au payload gateway.

Ce mock local ne valide ni le déploiement staging, ni le contrat Neven réellement servi, ni un provider réel. Ces niveaux nécessitent une validation séparée dans leur environnement autorisé.
