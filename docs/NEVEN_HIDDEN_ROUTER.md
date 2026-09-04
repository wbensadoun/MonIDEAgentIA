# Routeur intelligent invisible Neven

Version 2.1.0.

Le parcours normal ne demande jamais à l'utilisateur de choisir un fournisseur ou un modèle. Le routeur sélectionne une capacité interne, puis la traduit côté Electron vers le modèle physique disponible.

| Profil interne | Usage | Exécution | Repli |
|---|---|---|---|
| `lumen` | question courte, résumé, classification, autocomplete | agent rapide | modèle léger |
| `luna` | correction ou fonctionnalité bornée | agent | lumen |
| `sol` | architecture, repository large, plan multi-étapes | orchestrateur | luna |
| `zenith` | sécurité, migration critique, risque élevé, multi-agent réel | multi-agent | sol puis luna |

Ces profils sont des données internes. L'interface affiche seulement `Neven · Auto` et un statut générique. Les paramètres techniques et BYOK restent réservés aux réglages avancés.

Le L1 ne tranche automatiquement que les signaux forts. Les demandes ambiguës sont envoyées au L2, qui doit retourner un profil strictement validé. Les valeurs incohérentes entre `profile`, `mode` et `complexity` sont normalisées côté backend.
