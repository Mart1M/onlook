# ADR-001 — Réutilisation du moteur Onlook et plan de fork

- **Statut** : Accepted
- **Date** : 2026-10-22
- **Issue** : [SID-16](https://linear.app/side-projects-mart1/issue/SID-16/adr-001-reutilisation-du-moteur-onlook-et-plan-de-fork)
- **Épic parent** : [SID-5](https://linear.app/side-projects-mart1/issue/SID-5/epic-fondations-du-fork-onlook-phase-0-1) (Phase 0–1)
- **Base de code** : monorepo Onlook ≥ `423e2e92` (correctif IDOR tRPC #3129)
- **PRD** : §19 Phase 0, §24 ADR-001

## Contexte

Le fork vise un éditeur visuel **local-first** (React Visual Studio) : canvas + écriture dans le code utilisateur, runtime projet sur la machine, sans plateforme SaaS Onlook (billing, publication hébergée, growth).

L’audit (révision `423e2e92`) confirme qu’une grande partie du moteur d’édition est réutilisable, mais que le runtime CodeSandbox, le mapping `data-oid` et les modules Stripe/growth/publish sont hors cible ou à remplacer.

Ce document tranche **garder / retirer / réécrire** et fixe l’**ordre du plan de fork** avant les épics Runtime et Moteur de synchronisation.

## Décision

### 1. Réutiliser tel quel (avec adaptations mineures)

| Zone | Emplacement | Raison |
|------|-------------|--------|
| Canvas / frames | `apps/web/client/.../store/editor/{canvas,frames,frame-events,overlay,snap}` | Cœur UX multipaneaux ; indépendant du provider de sandbox |
| Stores MobX éditeur | `apps/web/client/.../store/editor/*` (`EditorEngine`, actions, style, AST, history, etc.) | Boucle d’édition déjà structurée ; conserver `makeAutoObservable` / patterns AGENTS.md |
| Bridge iframe | `packages/penpal`, `apps/web/preload` | RPC penpal parent↔preload déjà en place |
| Parser JSX/TSX | `packages/parser` | AST Babel, édition de code ; la couche *ids* sera découplée (voir §3) |
| Couture `Provider` | `packages/code-provider` (`Provider` abstrait, factory, types) | Contrat unique FS / terminaux / tâches ; brancher `NodeFs` au lieu de CodeSandbox |
| Modèles / UI / utilitaires de base | `packages/models`, `packages/ui`, `packages/utility`, `packages/constants`, `packages/types`, `packages/fonts` | Socle partagé ; élaguer les symboles Stripe/usage au fil de SID-17 |
| FS navigateur (cache éditeur) | `packages/file-system` | Abstraction utile côté client ; à coupler au provider serveur |
| Git helpers | `packages/git` (et usage ciblé de `packages/github` si clone local) | Utile en local ; pas de dépendance SaaS obligatoire |

### 2. Retirer ou isoler (hors périmètre PRD §3.2)

Exécution : [SID-17](https://linear.app/side-projects-mart1/issue/SID-17/retirer-ou-isoler-stripe-growth-usage-subscription-et). Ne pas modifier les lockfiles à la main ; ne pas lancer `db:gen`.

| Module | Emplacement | Action |
|--------|-------------|--------|
| Stripe | `packages/stripe`, callbacks Stripe, seeds Stripe | Retirer / stub ; plus d’env Stripe requise dans `env.ts` |
| Growth | `packages/growth` | Retirer |
| Subscription / usage | routers `subscription`, `usage` ; schéma `packages/db/src/schema/subscription` | Isoler puis retirer des chemins runtime ; schéma DB à traiter sans `db:gen` agent |
| Publish / domaines | routers `publish`, `domain` (Freestyle) ; store `hosting` | Retirer du fork produit |
| Email transactionnel SaaS | `packages/email` (si uniquement billing/onboarding cloud) | Isoler ; garder seulement si besoin auth locale minimal |
| Marketing / landing SaaS | pages features / landing lourdes dans `apps/web/client` | Hors chemin critique ; rebrand / simplification (SID-18, basse prio) |
| Admin cloud | `apps/admin` | Hors scope Phase 0–1 ; laisser hors workspaces actifs du fork si possible |

Critère : `bun run typecheck` (et build client) sans ces modules ni leurs variables d’environnement obligatoires.

### 3. Remplacer / réécrire

| Capacité aujourd’hui | Remplacement | Issues |
|----------------------|--------------|--------|
| Runtime **CodeSandbox** (`CodesandboxProvider`, router `sandbox`, `EditorEngine.activeSandbox`) | **NodeFsProvider** + pont client↔serveur + runtime Vite local (port, logs, HMR) | SID-23, SID-24, SID-25, SID-26, SID-27 |
| Mapping DOM↔source via **`data-oid`** injecté dans le JSX utilisateur (`packages/parser` ids, preload, prompts AI) | Stratégie **sans écrire dans le code utilisateur** (plugin Babel/SWC build-time fichier:ligne:colonne privilégié ; fiber `_debugSource` non retenu sans preuve React 19) | SID-33 |
| Sandbox distante comme source de vérité projet | Projet = **répertoire local** ; provider FS serveur | SID-23+ |
| Auth / multi-tenant cloud obligatoire pour éditer | Auth allégée ou mode local ; autorisation projet conservée si API partagée (base ≥ IDOR fix) | SID-20, fondations |

`NodeFsProvider` existe déjà (`packages/code-provider/src/providers/nodefs`) mais est un **squelette** (stubs) : à implémenter réellement (SID-23), pas à réécrire le contrat `Provider`.

### 4. Extraire / clarifier les frontières de packages

Sans big-bang :

1. Garder `createCodeProviderClient` / `CodeProvider.NodeFs` comme point d’extension unique.
2. Ne pas fusionner parser + preload ; le mapping (SID-33) pourra vivre en plugin build séparé consommé par le preload.
3. Les stores canvas/frames restent dans l’app client tant qu’aucun second shell UI n’existe ; extraction package seulement si un second consommateur apparaît.

## Plan de fork (ordre)

Ordre imposé avant les épics Runtime et Sync moteurs :

| Étape | Contenu | Issues | Dépendances |
|-------|---------|--------|-------------|
| **A0** | ADR-001 (ce document) + politique sync upstream | SID-16, SID-20 | — |
| **A1** | Audit licences deps ; baseline `typecheck` / lint / tests / Bun | SID-19, SID-22 | — |
| **A2** | Isoler/retirer Stripe, growth, usage, subscription, publish/domain | SID-17 | Soft avec A1 |
| **A3** | ADR mapping DOM↔source (sans `data-oid` durable) | SID-33 | Soft SID-16 |
| **B1** | Implémenter `NodeFsProvider` (FS local réel) | SID-23 | A0 |
| **B2** | Pont navigateur ↔ provider serveur (tRPC/WS, auth projet) | SID-24 | B1 |
| **B3** | Détection framework / scripts `package.json` | SID-27 | Peut fusionner tôt avec B4 |
| **C1** | Runtime Vite local (port, logs, HMR, URL canvas) | SID-25 | B1, idéalement B2 |
| **C2** | Bridge/preload Vite (sans layout Next imposé au projet utilisateur) | SID-26 | Soft C1 |

**Politique git (détail SID-20)** : fork long terme à partir de ≥ `423e2e92` ; rebases/cherry-picks ciblés pour correctifs sécurité amont ; dossiers « proches d’upstream » = `packages/{parser,penpal,code-provider,ui,utility,models}` et stores éditeur ; dossiers « fork-owned » = runtime local, mapping, suppression SaaS.

## Conséquences

### Positives

- Réutilise le cœur d’édition (canvas, actions, parser, penpal) sans réécrire un DevTools from scratch.
- Remplace uniquement le **runtime** et le **mapping**, alignés local-first.
- Clarifie le découpage pour le parallélisme Linear (Vague A vs B/C).

### Négatives / risques

- Couplage fort canvas ↔ `SandboxManager` : migration NodeFs touchera branches/sandbox stores.
- Retrait Stripe/subscription peut traverser `packages/db` et `env.ts` (conflits avec SID-17).
- SID-33 peut imposer des changements parser/preload après Phase 1 — accepter une période où `data-oid` reste en mode dégradé jusqu’au bascule.

### Hors scope de cet ADR

- Rebrand produit (SID-18), app PoC large (SID-21), collaboration temps réel, hébergement production.

## Critère d’acceptation

- [x] Modules **conservés / supprimés / remplacés** listés avec chemins monorepo
- [x] **Ordre** de fork documenté et rattaché aux issues Linear
- [x] Document versionné sous `adr/` (hors app Fumadocs `docs/`)
- [ ] Revue humaine / merge PR avant démarrage massif Runtime (SID-25+) et Sync (post SID-33)

## Références

- Architecture amont : `docs/content/docs/developers/architecture.mdx`
- `AGENTS.md` (Bun only, frontières client/serveur, MobX)
- Package provider : `packages/code-provider`
- Constante oid : `packages/constants` → `DATA_ONLOOK_ID = 'data-oid'`
