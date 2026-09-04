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

## Authentification (2 couches — ACTIVES)

1. **Cloudflare Access** (Zero Trust) : application `wansia-agents-api`
   (uid `eea13418-9207-4284-b612-9e3ad4d0529b`, destination `worker` = tag
   `cad934f1a1f9432c9a02e0cd8bf23891`), policy `non_identity` incluant le service
   token **`api`** (`fdbad29f-6450-4207-b336-bac277bf78b5`). Le client envoie les
   headers `CF-Access-Client-Id` / `CF-Access-Client-Secret` du `.env`.
   Access fonctionne aussi sur les URLs `*.workers.dev` (destination type `worker`).
2. **Bearer applicatif** : `Authorization: Bearer <AGENTS_API_TOKEN>` — secret du
   worker, comparé en temps constant, échoue fermé si absent.

Vérifié en live : les deux couches ensemble → 200 ; bearer seul → 403 ; Access
seul → 401 ; aucune → 403.

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
