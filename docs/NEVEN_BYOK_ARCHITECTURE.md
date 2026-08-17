# Neven Code Companion : socle BYOK

Version 2.7.0 introduit la policy backend BYOK, sans activer de parcours renderer.

## Politique

- `byok` vaut strictement `disabled`, `non_priority`, `priority` ou `mandatory`.
- La décision pure ordonne les origines : Neven seul, Neven→BYOK, BYOK→Neven ou BYOK seul.
- Un fallback n'est tenté qu'après une erreur opérationnelle autorisée (timeout, indisponibilité, réseau, passerelle ou rate limit).
- Les refus, révocations et permissions ne déclenchent jamais de contournement de policy.
- Le ledger écrit l'origine effectivement tentée, après chaque tentative, succès ou échec.
- Ollama/local est comptabilisé séparément avec l'origine `local`.

## Sécurité

Les clés sont chiffrées par `electron.safeStorage` dans `provider-secrets.vault.json`. La révocation retire le ciphertext et conserve seulement un tombstone de métadonnées. Le renderer ne peut plus provisionner ni fournir policy, origine ou credential aux complétions. Les valeurs ne doivent pas être ajoutées aux prompts, logs ou objets renvoyés par IPC.

Le module fournit le coffre, la révocation, la décision de policy et le ledger d'usage. L'exécuteur reçoit ses dépendances managed par injection afin d'être testé sans passerelle. L'origine `neven` est explicitement indisponible et ne consulte aucune variable d'environnement tant que COD-26 ne branche pas la passerelle réelle ; le raccordement managed reste donc différé à COD-26.

## Agents

- Sol : orchestration et planification
- Luna : implémentation
- Terra : QA indépendante
