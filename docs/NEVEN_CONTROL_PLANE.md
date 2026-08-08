# Control plane Neven — contrat backend

Version 2.2.0.

Cette couche prépare la future interface admin Neven sans donner au client les clés Claude, Gemini, Kimi ou autres. Code Companion conserve uniquement, dans le **main process**, un grant court vers la passerelle Neven.

## Flux cible

```mermaid
sequenceDiagram
    participant Admin as Interface admin Neven
    participant CP as Control plane Neven
    participant App as Code Companion main process
    participant GW as Passerelle IA Neven
    participant Model as Fournisseurs IA

    Admin->>CP: configure providers, profils, forfaits et scopes
    App->>CP: POST /v1/control-plane/access/resolve
    CP-->>App: grant court + expiration + gatewayUrl
    App->>GW: requête avec grant Neven
    GW->>Model: clé fournisseur conservée côté Neven
    Model-->>GW: réponse
    GW-->>App: réponse normalisée
```

## Contrat provisoire

`POST /v1/control-plane/access/resolve`

```json
{
  "workspaceId": "workspace-123",
  "profile": "haiku | luna | sol | opus",
  "capability": "completion"
}
```

Réponse minimale attendue :

```json
{
  "granted": true,
  "gatewayUrl": "https://gateway.neven.example",
  "accessToken": "short-lived-token",
  "expiresAt": "2026-08-09T12:00:00.000Z",
  "scopes": ["completion"]
}
```

Le client Electron refuse un grant sans expiration, sans passerelle valide ou déjà expiré. Le token est gardé en mémoire, jamais écrit dans les settings, jamais envoyé au renderer et jamais journalisé.

`POST /v1/control-plane/access/revoke` reçoit uniquement `workspaceId` et invalide les grants côté Neven.

Le contrat est derrière des variables d'environnement : l'URL réelle et les routes pourront être remplacées quand l'interface admin sera disponible. Aucun faux endpoint de production n'est activé par défaut.
