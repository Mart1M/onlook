# ADR-002 — Base de fork et politique de synchronisation upstream

- **Statut** : Accepted
- **Date** : 2026-10-22
- **Issue** : [SID-20](https://linear.app/side-projects-mart1/issue/SID-20/definir-la-base-de-fork-et-la-politique-de-synchronisation-upstream)
- **Épic parent** : [SID-5](https://linear.app/side-projects-mart1/issue/SID-5/epic-fondations-du-fork-onlook-phase-0-1) (Phase 0–1)
- **Dépend de** : [ADR-001](./001-reutilisation-moteur-onlook-plan-fork.md) ([SID-16](https://linear.app/side-projects-mart1/issue/SID-16/adr-001-reutilisation-du-moteur-onlook-et-plan-de-fork) / [PR #1](https://github.com/Mart1M/onlook/pull/1))
- **Upstream** : [`onlook-dev/onlook`](https://github.com/onlook-dev/onlook)
- **Fork** : [`Mart1M/onlook`](https://github.com/Mart1M/onlook)

## Contexte

ADR-001 fixe *quoi* réutiliser (garder / retirer / réécrire). SID-20 fixe *comment* ancrer le dépôt et le maintenir face à l’amont :

1. Quelle révision minimale comme base de fork ?
2. Fork long terme ou rebases périodiques de tout l’arbre ?
3. Quels dossiers restent « proches d’upstream » vs « fork-owned » ?
4. Comment intégrer les correctifs de sécurité amont sans réimporter le SaaS ?

Sans cette politique, les PR Runtime (SID-23+) et le retrait SaaS (SID-17) risquent des merges chaotiques ou une dérive incontrôlée.

## Décision

### 1. Base de fork (révision minimale)

| Champ | Valeur |
|-------|--------|
| SHA court | `423e2e92` |
| SHA complet | `423e2e924366419e418ee049093872d535eea41a` |
| Message | `fix(security): enforce project-membership authorization across all tRPC routers (IDOR) (#3129)` |
| Upstream | [onlook-dev/onlook#3129](https://github.com/onlook-dev/onlook/pull/3129) |
| Contrainte | Toute branche de travail / release du fork **doit** être un descendant de ce commit (ou d’un ancêtre plus récent qui l’inclut). |

**État au 2026-10-22** : `main` du fork pointe déjà sur `423e2e92` — la base est satisfaite ; pas de reset historique requis.

Interdiction : cherry-pick ou rebase qui **retire** le correctif IDOR des routers tRPC conservés. Si un router SaaS est retiré (SID-17), le correctif peut disparaître *avec* le fichier ; les routers projet / user / chat conservés doivent garder les gardes d’appartenance.

### 2. Modèle : fork long terme + sync sélective

**Choix** : **fork long terme** (historique propre au fork), **pas** de rebase périodique de tout `main` sur `upstream/main`.

| Approche | Verdict | Raison |
|----------|---------|--------|
| Rebase / merge fréquent de tout upstream | **Rejeté** | Conflits massifs avec NodeFs, mapping sans `data-oid`, retrait Stripe/publish, rebrand |
| Mirror passif (aucune sync) | **Rejeté** | Manque les correctifs sécurité / parser / penpal utiles |
| **Fork long terme + cherry-picks / merges ciblés** | **Retenu** | Aligne ADR-001 : cœur éditeur proche amont, runtime et SaaS fork-owned |

Conséquences opérationnelles :

- Remote recommandé : `upstream` → `https://github.com/onlook-dev/onlook.git` (lecture seule pour agents).
- Remote `origin` → fork `Mart1M/onlook` (écriture).
- `main` du fork **n’est pas** un tracking branch d’`upstream/main`.
- Pas de `git merge upstream/main` « à blanc » sur `main` sans revue par zones (§3).

### 3. Classification des dossiers

Alignée sur ADR-001 §1–3. La sync amont privilégie les zones « proches » ; les zones « fork-owned » n’absorbent l’amont que pour un correctif sécurité critique explicitement justifié.

#### Proches d’upstream (sync favorisée)

Cherry-picks / reprises de patch **autorisés et attendus** après revue légère (conflits, types, Bun).

| Zone | Chemins typiques |
|------|------------------|
| Parser / AST | `packages/parser` |
| Bridge iframe | `packages/penpal`, `apps/web/preload` |
| Contrat provider | `packages/code-provider` (sauf implémentation `providers/nodefs`) |
| UI / modèles / utilitaires | `packages/ui`, `packages/models`, `packages/utility`, `packages/constants`, `packages/types`, `packages/fonts` |
| FS navigateur | `packages/file-system` |
| Git helpers | `packages/git` |
| Stores canvas / frames / overlay | `apps/web/client/src/components/store/editor/{canvas,frames,frame-events,overlay,snap}` et cœur `EditorEngine` **hors** sandbox/hosting |

#### Fork-owned (sync refusée par défaut)

N’intégrer l’amont que si un CVE / IDOR / fuite de secrets l’exige, et alors **patch minimal** (idéalement extrait, pas merge de dossier).

| Zone | Chemins / thèmes | Issues |
|------|------------------|--------|
| Runtime local | `NodeFsProvider`, pont client↔serveur, Vite local, bridge Vite | SID-23…27 |
| Mapping DOM↔source | stratégie sans `data-oid` durable | SID-33 |
| Retrait / isolation SaaS | Stripe, growth, usage, subscription, publish, domain, hosting | SID-17 |
| Auth / multi-tenant allégé | chemins locaux vs cloud obligatoire | fondations |
| Marketing / admin cloud | landings SaaS, `apps/admin` | SID-18 (basse prio) |

#### Zone grise (revue au cas par cas)

| Zone | Règle |
|------|--------|
| `apps/web/client/src/server/api/routers/**` | Sécurité / auth projet : **oui** (surtout post-IDOR). Routers publish/subscription/usage : **non** si SID-17 les retire. |
| `packages/db` / schémas | Sync schéma SaaS **non** ; migrations sécurité locales uniquement ; **pas** de `db:gen` agent (AGENTS.md). |
| `apps/web/client/src/env.ts` | Ne pas réintroduire d’env Stripe/SaaS obligatoires. |
| Lockfiles / `bun.lock` | Ne jamais merger lockfiles amont « pour sync » ; régénérer via Bun après changements de deps locaux. |

### 4. Intégration des correctifs de sécurité amont

Processus obligatoire pour tout correctif classé sécurité (CVE, IDOR, authz, XSS, secret leak) publié sur `onlook-dev/onlook` :

1. **Détecter** : veille manuelle ou Dependabot/GitHub Security sur le fork ; surveiller les releases / PR `security` amont.
2. **Classer** la zone touchée (§3) : proche / fork-owned / grise.
3. **Extraire** le patch minimal (`git fetch upstream` puis `git cherry-pick -x <sha>` ou `git show <sha> -- <paths>`).
4. **Adapter** si les chemins ont divergé (ex. helper d’auth projet déplacé) — conserver l’intention (membership check, pas de fuite cross-tenant).
5. **Ne pas** réimporter modules SaaS, seeds Stripe, ni routers retirés « parce que le commit amont les touche ».
6. **Vérifier** : `bun run typecheck` (et tests ciblés si le patch en a) ; pas de `db:gen`.
7. **Tracer** : commit avec `cherry-picked from` / lien PR amont + issue Linear (sécurité ou SID-20 follow-up) ; noter le SHA amont dans le message.

SLA indicatif Phase 0–1 : correctifs touchant routers / auth projet ou deps runtime **sous 7 jours** après connaissance ; le reste sécuritaire non bloquant entre dans le cycle suivant.

### 5. Cadence et outils (non sécurité)

| Activité | Cadence | Action |
|----------|---------|--------|
| Revue `upstream/main` sur zones proches | Au moins 1× / cycle Linear (~2 semaines) | Lister commits intéressants ; cherry-pick ciblés ou issue « sync parser/penpal » |
| Merge massif `upstream/main` | **Jamais** sans ADR / issue dédiée | — |
| Tags / versions amont | Optionnel | Documenter le dernier SHA amont **évalué** (pas nécessairement intégré) dans le ticket de sync |
| Remotes agents | Bun only ; pas npm/yarn | `git remote add upstream …` si absent |

Exemple de message de commit sync :

```text
chore(sync): cherry-pick upstream <sha12> into packages/parser

Upstream: onlook-dev/onlook@<fullsha>
Reason: <bugfix|perf|security>
Refs: SID-XX
```

### 6. Ce qui n’est pas décidé ici

- Licence / attribution deps → SID-19.
- Baseline CI typecheck/lint/tests → SID-22.
- Liste exacte des fichiers à supprimer (Stripe…) → SID-17.
- Stratégie mapping → SID-33 / ADR ultérieur.

## Conséquences

### Positives

- Ancrage clair : plus bas que `423e2e92` = hors politique.
- Évite les guerres de merge Runtime vs SaaS amont.
- Canal explicite pour les correctifs IDOR-like sans réouvrir le monolithe cloud.

### Négatives / risques

- Dérive fonctionnelle sur `packages/parser` / penpal si la cadence de revue est négligée.
- Cherry-picks manuels : coût humain ; accepter des issues « sync » dédiées plutôt que de tout automatiser en Phase 0.
- Confusion remotes si un agent pousse sur upstream (droits normalement absents) — documenter `origin` = fork.

## Critère d’acceptation

- [x] Base ≥ `423e2e92` documentée (SHA complet + motif IDOR #3129)
- [x] Modèle **fork long terme + sync sélective** tranché (rebases totales rejetées)
- [x] Dossiers **proches d’upstream** vs **fork-owned** listés
- [x] Processus d’intake **correctifs sécurité** amont décrit
- [x] Document versionné sous `adr/` et indexé dans `adr/README.md`

## Références

- [ADR-001](./001-reutilisation-moteur-onlook-plan-fork.md) — réutilisation moteur / plan de fork
- Correctif base : `423e2e92` / upstream #3129
- `AGENTS.md` — Bun only, pas de `db:gen`, frontières client/serveur
