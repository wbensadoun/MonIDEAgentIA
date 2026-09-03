# Wansia Agents API — Worker Cloudflare

API back-only de stockage des ressources Code Companion (COD-52) : **agents.md**,
**skills** (SKILL.md) et **workflows Vibe Flow** (remplace la dépendance au repo
GitHub tiers — leçon COD-49/COD-51).

## Ressources

| Méthode | Route | Description |
|---|---|---|
| GET | `/agents` | Liste `{ agents: [{ name, updatedAt, size }] }` |
| GET | `/agents/:name` | `{ name, content, updatedAt }` |
| PUT | `/agents/:name` | Body `{ "content": "..." }` (max 512 Ko) |
| DELETE | `/agents/:name` | Supprime la ressource |

`/agents` est interchangeable avec `/skills` et `/workflows`.

## Authentification

- **Bearer applicatif (actif)** : `Authorization: Bearer <AGENTS_API_TOKEN>` — secret
  du worker, comparé en temps constant, échoue fermé si absent. C'est LA protection
  de l'API sur `workers.dev`.
- **Cloudflare Access (optionnel, plus tard)** : Access **ne peut pas** protéger une
  URL `*.workers.dev` — il exige un custom domain sur une zone Cloudflare activée.
  Quand `wansia.fr` sera activée chez Cloudflare (NS actuellement chez OVH), on
  pourra exposer l'API sur `api.wansia.fr` + application Access Self-hosted avec
  policy Allow + Service Auth (le client envoie déjà les headers `CF-Access-*`
  s'ils sont configurés dans le `.env` — no-op sinon).

## Déploiement

```sh
cd cloudflare/agents-api
npx wrangler kv namespace create AGENTS_KV     # -> copier l'id dans wrangler.toml
npx wrangler secret put AGENTS_API_TOKEN        # valeur = générée toi-même (openssl rand -hex 32)
npx wrangler deploy
```

L'URL publique déployée est `https://wansia-agents-api.<sous-domaine>.workers.dev`
→ à mettre dans `CF_AGENTS_API_URL` du `.env` de Code Companion et dans
`NEVEN_CONTROL_PLANE_URL`/`NEVEN_GATEWAY_URL` si exposés.

## Configuration Cloudflare Access (uniquement après custom domain)

1. Activer la zone `wansia.fr` chez Cloudflare : changer les NS chez le registrar
   (OVH) vers `izabella.ns.cloudflare.com` / `todd.ns.cloudflare.com` — ATTENTION,
   répliquer d'abord tous les enregistrements DNS existants dans Cloudflare.
2. Worker → Domains & Routes : ajouter `api.wansia.fr`.
3. Zero Trust → Access → Applications → Self-hosted : domain `api.wansia.fr`,
   policy Allow + **Service Auth** (service token créé sur CE compte).
4. Pas de policy login navigateur (le client IDE est headless).

## Vérification

```sh
curl -s https://wansia-agents-api.<sous-domaine>.workers.dev/health
curl -s -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" \
     -H "Authorization: Bearer <token>" <base>/agents
```
