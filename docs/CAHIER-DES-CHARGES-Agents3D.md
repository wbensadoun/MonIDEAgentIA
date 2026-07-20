# Cahier des charges — Produit « Agents IA visuels GBA-style » (EXE vendable)

> **Statut** : étude / avant-projet — aucune ligne de code engagée.
> **Date** : 2026-06-14 (mis à jour : clarification graphisme → GBA pixel art)
> **Porteur** : MonIDEAgentIA (Electron + React, module AgentVerse existant)

---

## 0. Pivot graphique : GBA-style (ajout 2026-06-14)

### Décision
Le graphisme cible est **pixel art GBA** (style Pokémon FireRed/LeafGreen, Advance Wars, Fire Emblem,
Mother 3) — **pas** de 3D photoréaliste. Ce choix est optimal à tous les niveaux.

### Pourquoi c'est la meilleure décision possible

| Critère | Pixel art GBA | 3D photoréaliste (UE5) |
|---|---|---|
| Machine dev CPU-only | ✅ parfaitement supporté | ❌ quasi inutilisable |
| GPU client exigé | ✅ zéro — tourne sur n8080 | ❌ GPU dédié préférable |
| Taille EXE | ✅ < 100 Mo | ❌ 2–15+ Go |
| Stack existante | ✅ Phaser 3 déjà en place | ❌ greffe lourde |
| « À couper le souffle » | ✅ via art direction (FireRed !) | ❌ pas sur cette cible hw |
| Budget assets | ✅ 0–5k€ (packs + freelance pixel) | ❌ 20–60k€ + OPEX |
| Résonance marché | ✅ Nostalgie GBA = huge audience | limité |

### Ce qui fait le « wow » en pixel art GBA
Le rendu FireRed est beau non pas grâce au hardware mais grâce à :
1. **Palettes couleur cohérentes** (16–256 couleurs max par tileset, tonalités chaudes et saturées)
2. **Tiles soignés** (ombres douces, variation de texture, transitions fluides herbe↔chemin)
3. **Sprites avec animations complètes** (idle bounce, walk cycle 4 directions, talk, emote)
4. **Éclairage semi-dynamique** : day/night cycle via teinte overlay, lumière des fenêtres la nuit
5. **UI GBA authentique** : boîtes de dialogue avec border animée, icônes de type, polices bitmap
6. **Effets d'écran** : scanlines légères, vignette, palette shift pour intérieur/extérieur

### État actuel vs cible « FireRed quality »

| Élément | Actuel (AgentVerse) | Cible GBA premium |
|---|---|---|
| Tileset sol | Kenney CC0 (correct) | Tileset custom ou LPC (richer) |
| Transitions tiles | Hard edge | Bitmask autotile (coin arrondis) |
| Sprites agents | 16×20 procéduraux Phaser | 16×24 ou 24×32 animés (4 dir) |
| Animations | idle basique + walk | idle bounce, walk 4 dir, talk, emote |
| UI dialogues | Bulles CSS | Boîtes GBA avec border bitmap |
| Éclairage | Aucun | Overlay color cycle (day/night) |
| Effets écran | Aucun | Scanlines légères + vignette |
| Audio | Aucun | Chiptune ambiance + SFX 8-bit |
> **Objet** : transformer AgentVerse en produit installable (.exe) vendable, avec des agents IA
> incarnés dans un monde visuel « à couper le souffle ».

---

## 1. Contexte & objectif

Le module **AgentVerse** existe déjà (React/TypeScript, 6 thèmes 2D : Town/Kenney, Cyberpunk,
Isométrique, Campus, Synthwave, Tamers). Les agents (PM Aria + 5 devs) sont déjà branchés sur
un vrai bridge LLM (`window.electronAPI.get{Gemini,Claude,Kimi,Ollama}Completion`).

**Objectif produit** : passer d'un module 2D interne à un **produit autonome installable et payant**,
avec un rendu **3D spectaculaire**, où les agents IA sont des personnages vivants dans un monde.

**Question centrale posée** : Unreal Engine, ou une alternative plus simple à brancher (MCP) ?

---

## 2. ⚠️ Verdict technologique (à lire avant tout)

### 2.1 La contrainte qui change tout
La machine de dev est **CPU-only** (i5-1335U, **pas de GPU dédié**). C'est documenté dans la mémoire
projet. Conséquence directe :

- **Unreal Engine 5 est quasi inutilisable pour DÉVELOPPER sur cette machine** (Nanite/Lumen exigent
  un GPU ; l'éditeur rame, les builds prennent des heures, l'itération est cassée).
- Pour **VENDRE** un EXE UE5 « photoréaliste », **les acheteurs eux-mêmes auraient besoin d'un GPU dédié** →
  on ampute 60–80 % du marché grand public (la plupart des PC portables ont un iGPU).
- Un build UE5 packagé pèse **2 à 15+ Go**. Un EXE de cette taille est un frein commercial majeur.

### 2.2 Le malentendu sur « le graphisme à couper le souffle »
Le « wow » visuel ne vient **pas** du nombre de polygones ni du moteur. Il vient de la
**direction artistique + éclairage + post-processing**. Des jeux comme *Monument Valley*, *Sky:
Children of the Light*, *Gris*, *Alto's Odyssey* tournent sur mobile/iGPU et coupent le souffle —
parce qu'ils sont **stylisés**, pas photoréalistes. **Viser le photoréalisme AAA sur cette cible
hardware est un piège.** Viser un style 3D affirmé est la bonne stratégie : plus beau, moins cher,
tourne partout.

### 2.3 Le malentendu sur MCP
MCP **n'est pas le transport runtime** d'un produit vendu. C'est un outil de **temps de dev** :
il permet à Claude (moi) de piloter le moteur pour **construire les scènes** pendant la production.
Dans l'EXE livré au client, les agents parlent au LLM via le **bridge applicatif existant**
(Ollama/Claude/Gemini), **pas** via MCP. Donc « brancher MCP » = accélérer la production, pas une
brique livrée.

| Phase | Rôle de MCP |
|---|---|
| **Production (dev)** | Claude pilote le moteur (spawn scènes, place assets, génère shaders) via MCP |
| **Runtime (client)** | ❌ pas de MCP — le LLM est appelé par le bridge interne de l'app |

---

## 3. Comparatif des moteurs (cible : EXE vendable, beau, iGPU-friendly, MCP dispo)

| Critère | **Unreal Engine 5** | **Unity (URP/HDRP)** | **Godot 4** | **React Three Fiber / Three.js** (dans l'Electron actuel) |
|---|---|---|---|---|
| Qualité max | AAA photoréaliste | Très haute | Haute (stylisée++) | Haute stylisée (PBR + post-FX bloom/DoF/SSAO) |
| Taille EXE | 2–15+ Go | 100 Mo–2 Go | 50–150 Mo | **+0 à ~200 Mo** (Electron déjà présent) |
| GPU requis (client) | Dédié | Dédié (HDRP) / iGPU (URP) | iGPU OK | **iGPU OK** (WebGL2/WebGPU) |
| Dev sur machine CPU-only | ❌ impossible | ⚠️ pénible | ✅ acceptable | ✅ **OK (stack actuelle)** |
| Langage / courbe | C++/Blueprint, raide | C#, moyenne | GDScript/C#, douce | **TS/JS — déjà ta stack** |
| Intégration à l'app | greffe externe lourde | greffe externe | greffe externe (fenêtre séparée) | **natif, même runtime, agents déjà câblés** |
| MCP dispo | UnrealClaudeMCP | unity-mcp | godot-mcp | n/a (c'est ton propre code) |
| Licence / royalties | 5 % > 1 M$ (jeux) ou licence/siège | abonnement si CA élevé | **MIT — 0 €** | **MIT — 0 €** |
| Pixel Streaming cloud | possible (cher) | possible | limité | n/a |
| Délai 1er prototype | semaines | semaines | jours–semaines | **jours (réutilise l'existant)** |

### 3.1 Recommandation
1. **Choix recommandé — React Three Fiber (Three.js) dans l'Electron existant.**
   Friction minimale : même runtime, agents déjà branchés, EXE déjà packagé (electron-builder),
   auto-update déjà là (`UpdateChecker`). Tourne sur iGPU. « Wow » via direction artistique +
   post-processing. Zéro royalties. **Permet de livrer un produit vendable vite, sur ta machine actuelle.**

2. **Alternative crédible — Godot 4** si tu veux un vrai pipeline « moteur de jeu » et une fenêtre
   3D dédiée (rendu Vulkan plus poussé que WebGL). MIT, léger, MCP dispo. Coût : un runtime séparé
   à embarquer/synchroniser avec l'app React.

3. **UE5 — uniquement en palier « Premium » futur**, si : (a) upgrade matériel (workstation GPU
   ~2 000 €), (b) cible clients pro avec GPU, (c) budget cloud pour Pixel Streaming. Pas le bon
   premier pas.

---

## 4. Périmètre (scope)

### Inclus (v1)
- Monde 3D stylisé avec 6 agents incarnés (réutilise les rôles/personas existants).
- Click-to-talk, bulles, task board Todo/In-Progress/Done (déjà spécifiés en 2D → portage 3D).
- Bridge LLM existant (Ollama local + cloud Claude/Gemini/Kimi).
- Installeur Windows (.exe NSIS), signé, avec auto-update.
- Système de licence (clé d'activation) + page de vente.

### Exclus (v1)
- Photoréalisme AAA / Pixel Streaming cloud.
- Multijoueur temps réel.
- Édition de niveau par l'utilisateur final.
- macOS/Linux (envisageable v2).

---

## 5. Spécifications fonctionnelles

| ID | Fonction | Priorité |
|---|---|---|
| F1 | Monde 3D chargé au lancement, caméra orbitale/iso, 6 agents animés | Must |
| F2 | Click sur un agent → dialogue ; réponse LLM via bridge | Must |
| F3 | Task board synchronisé (une tâche Done anime/déplace l'agent) | Must |
| F4 | Mode équipe (cascade PM Aria → délégation) — déjà spécifié | Must |
| F5 | Sélecteur de thèmes/skins (skins vendables séparément) | Should |
| F6 | Réglages : provider LLM, modèle, clé API | Must |
| F7 | Onboarding + activation de licence | Must |
| F8 | Économie iGPU : qualité graphique adaptative (low/med/high) | Should |

---

## 6. Spécifications techniques & non-fonctionnelles

- **Cible matérielle client** : Windows 10/11, 8 Go RAM, **iGPU Intel/AMD** (pas de GPU dédié exigé).
- **Perf** : ≥ 30 FPS sur iGPU en qualité « medium ». Détection auto + fallback.
- **Taille installeur** : objectif < 300 Mo (R3F) ; < 500 Mo (Godot embarqué).
- **Démarrage à froid** : < 8 s.
- **Offline** : fonctionne 100 % hors-ligne avec Ollama local (cohérent avec contrainte CPU/Ollama).
- **Sécurité** : clés API chiffrées au repos ; EXE signé (anti-SmartScreen).

---

## 7. Pipeline de production graphique (« à couper le souffle »)

Le budget « wow » se joue ici, pas dans le moteur :
- **Direction artistique stylisée** (low-poly chic / cel-shading / vaporwave selon le skin).
- **Post-processing** : bloom, depth-of-field, vignette, color grading, SSAO léger.
- **Éclairage** : lightmaps bakées + 1–2 lumières dynamiques (économe iGPU).
- **Assets** : packs CC0 (Kenney, Poly Pizza, Quaternius) en v1 → artiste 3D freelance pour skins premium.
- **Animations** : Mixamo (gratuit) pour les agents humanoïdes ; rigs simples pour Tamers.
- **Audio** : ambiances + SFX (banques libres / freelance).

---

## 8. Packaging, distribution & monétisation (le « vendable »)

| Brique | Solution | Coût |
|---|---|---|
| Installeur Windows | electron-builder (NSIS) — **déjà en place** | 0 € |
| **Signature de code** (anti-alerte Windows) | Certificat EV/OV (Sectigo, DigiCert…) | ~300–600 €/an |
| Auto-update | `UpdateChecker` existant + serveur de release | héberg. faible |
| Gestion de licence / DRM | LemonSqueezy License, Keygen, Cryptolens, Gumroad | 5 % ventes / abo |
| Paiement + TVA UE | **LemonSqueezy / Paddle (Merchant of Record)** gère la TVA | ~5 % + frais |
| Distribution alternative | Steam (reach énorme, gère tout) | 30 % + 100 $ dépôt |

> **Recommandation** : LemonSqueezy ou Paddle (Merchant of Record → ils gèrent la TVA UE, gros
> avantage en France) + clés de licence intégrées. Steam en canal secondaire si cible gaming.

---

## 9. Budget (3 scénarios)

### Scénario A — **Lean** (R3F sur stack existante, toi + assets CC0)
| Poste | Coût |
|---|---|
| Moteur/licence | 0 € (MIT) |
| Assets CC0 + quelques packs payants | 0–2 000 € |
| Certificat signature code | ~400 €/an |
| Plateforme vente + licence | % sur ventes |
| Dev | ton temps (réutilise l'existant) |
| **Total cash initial** | **~0,5–3 k€** |

### Scénario B — **Pro** (Godot **ou** R3F + freelances art/audio)
| Poste | Coût |
|---|---|
| Artiste 3D freelance (skins premium) | 5 000–15 000 € |
| Audio (ambiances + SFX) | 1 000–3 000 € |
| Signature + infra release + licence | ~1 000 €/an |
| Dev (toi + éventuel renfort) | variable |
| **Total** | **~10–25 k€** |

### Scénario C — **Premium UE5 + cloud**
| Poste | Coût |
|---|---|
| Workstation GPU (dev) | ~2 000 € |
| Dev UE5 (C++/Blueprint, contrat) | 20 000–60 000 € |
| Cloud GPU Pixel Streaming (OPEX à l'échelle) | 500–3 000 €/mois |
| Licence/royalties UE | 5 % > 1 M$ |
| **Total** | **30 k€+ initial + OPEX lourd** |

---

## 10. Planning indicatif (Scénario A recommandé)

| Jalon | Contenu | Durée |
|---|---|---|
| J1 — Spike 3D | R3F dans l'Electron, 1 agent animé + caméra | 1 sem |
| J2 — Portage agents | 6 agents, dialogue, task board en 3D | 2–3 sem |
| J3 — Direction artistique | post-FX, éclairage, 1 skin « wow » complet | 2 sem |
| J4 — Packaging vendable | signature, licence, page de vente, auto-update | 1–2 sem |
| J5 — Beta + perf iGPU | qualité adaptative, tests machines réelles | 1–2 sem |
| **Total v1** | | **~7–10 semaines** |

---

## 11. Risques & contraintes

| Risque | Impact | Mitigation |
|---|---|---|
| **Machine dev CPU-only** | UE5 impossible, 3D web limitée au dev | Choix R3F/Godot ; tests perf sur machines tierces |
| Marché GPU-dépendant (si UE5) | Marché réduit 60–80 % | Stylisé iGPU-friendly |
| Taille EXE (UE5) | Frein commercial | R3F/Godot léger |
| Faux « wow » photoréaliste | Coûts élevés, perf KO | Direction artistique stylisée |
| Signature/SmartScreen | EXE bloqué → ventes nulles | Certificat EV dès le départ |
| TVA / facturation UE | Risque légal | Merchant of Record (LemonSqueezy/Paddle) |

---

## 12. Recommandation finale (TL;DR)

- **Ne pars PAS sur Unreal Engine maintenant.** Mauvais fit avec ta machine, ton EXE, ton marché.
- **Pars sur React Three Fiber (Three.js) dans l'Electron existant** → produit vendable, beau,
  léger, qui tourne sur iGPU, sur ta machine actuelle, en réutilisant tout le câblage agents/LLM.
- **« À couper le souffle » = direction artistique stylisée + post-processing**, pas le moteur.
- **MCP = accélérateur de production**, pas une brique du produit livré.
- **Budget d'entrée réaliste : ~0,5–3 k€** (Scénario A), montée en gamme possible ensuite.
- **UE5 = palier Premium futur** seulement après upgrade matériel + cible client GPU + cloud.
