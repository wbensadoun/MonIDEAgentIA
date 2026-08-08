# Neven Code Companion : socle BYOK

Version 2.0.0 introduit le socle technique, sans activer BYOK comme parcours par défaut.

## Politique

- Le parcours standard reste facturé par Neven.
- Une clé personnelle est enregistrée par fournisseur et par workspace.
- `prioritizeUserKeys: true` permet de l'utiliser avant la capacité Neven.
- Le fallback vers Neven est contrôlé par la politique, jamais implicite dans l'interface.
- Ollama/local est comptabilisé séparément avec l'origine `local`.

## Sécurité

Les clés sont chiffrées par `electron.safeStorage` dans `provider-secrets.vault.json`. Le renderer reçoit uniquement des métadonnées via `provider:list-credentials`. Les valeurs ne doivent pas être ajoutées aux prompts, logs ou objets renvoyés par IPC.

Le module actuel fournit le coffre, la révocation, la résolution de politique et le ledger d'usage. La migration complète des anciens champs `*ApiKey` de `settings.json` et le branchement de chaque provider au resolver sont une étape suivante obligatoire avant l'activation publique de BYOK.

## Agents

- Sol : orchestration et planification
- Luna : implémentation
- Terra : QA indépendante
