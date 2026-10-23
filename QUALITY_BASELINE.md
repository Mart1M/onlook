# Baseline qualité (SID-22)

État de référence du monorepo pour distinguer **régressions** vs **dettes déjà présentes**.  
Mesure effectuée le **2026-10-22** sur `main` @ `423e2e924366419e418ee049093872d535eea41a`.

## Environnement

| Élément | Valeur |
| --- | --- |
| Bun requis | **1.3.1** (`packageManager` dans `package.json` ; CI `.github/workflows/ci.yml`) |
| Bun utilisé pour cette mesure | `1.3.1` (`89fa0f34`) |
| Install | `bun install --frozen` (ne **pas** committer un rewrite de `bun.lock`) |

### Avertissement lockfile

Avec un Bun **plus ancien** que 1.3.1, `bun install` peut réécrire `bun.lock`. Même avec 1.3.1, une résolution peut produire un drift local : **restaurer** le lockfile (`git checkout -- bun.lock`) et ne committer que les changements intentionnels.

## Commandes de référence (CI / agents)

Alignées sur `.github/workflows/ci.yml` et les scripts racine :

```bash
bun --version                    # doit être 1.3.1
bun install --frozen
bun run typecheck                # → @onlook/web-client uniquement
bun test --timeout 30000         # suite unitaire monorepo
bun run lint                     # déjà en échec sur la base (job CI lint commenté)
```

**Hors scope volontaire** : `db:gen`, serveur de dev (`bun run dev`).

## Résultats (baseline)

### Typecheck

| Cible | Commande | Résultat baseline |
| --- | --- | --- |
| App cliente (gate CI) | `bun run typecheck` (= `bun --filter @onlook/web-client typecheck`) | **PASS** (exit 0) |
| Package isolé (ex. `@onlook/parser`) | `cd packages/<pkg> && bun run typecheck` | **FAIL** (exit ≠ 0) |

Échecs typiques hors gate CI (préexistants, transverses) :

- `TS6142` : modules `.tsx` (`@onlook/ui/icons`, hooks file-system) sans option `--jsx` dans le `tsc` du package consommateur.
- Alias app (`@/…`) non résolus quand un package tire des sources de `apps/web/client`.

**Interprétation** : une régression typecheck = échec de `bun run typecheck` (web-client). Les `tsc` package-level restent hors gate tant qu’ils ne sont pas corrigés.

### Tests

| Cible | Commande | Résultat baseline |
| --- | --- | --- |
| Monorepo | `bun test --timeout 30000` | **PASS** — 1064 pass, 1 skip, 0 fail (57 fichiers) |
| Parser | `bun test packages/parser --timeout 30000` | **PASS** — 93 pass, 0 fail (7 fichiers) |

Skip connu : `applyCodeChange > should apply code change`.

### Lint

| Cible | Commande | Résultat baseline |
| --- | --- | --- |
| Monorepo | `bun run lint` (= `bun --filter '*' lint`) | **FAIL** (exit 1) |

Le job lint CI est **commenté** (`ci.yml`) précisément à cause de cet état.

#### Packages lint OK (exit 0)

- `@onlook/rpc`
- `@onlook/types`
- `@onlook/penpal`

#### Packages lint en échec (exit 1) — comptes ESLint rapportés

| Package | Problèmes | Errors | Warnings |
| --- | --- | --- | --- |
| `@onlook/ai` | 913 | 0 | 913 |
| `@onlook/db` | 487 | 1 | 486 |
| `@onlook/ui` | 414 | 2 | 412 |
| `@onlook/parser` | 277 | 0 | 277 |
| `@onlook/web-preload` | 227 | 0 | 227 |
| `@onlook/code-provider` | 186 | 0 | 186 |
| `@onlook/utility` | 149 | 0 | 149 |
| `@onlook/web-server` | 66 | 0 | 66 |
| `@onlook/scripts` | 60 | 0 | 60 |
| `@onlook/stripe` | 49 | 0 | 49 |
| `@onlook/file-system` | 40 | 0 | 40 |
| `@onlook/github` | 21 | 0 | 21 |
| `@onlook/models` | 21 | 0 | 21 |
| `@onlook/fonts` | 9 | 7 | 2 |
| `@onlook/image-server` | 5 | 1 | 4 |
| `@onlook/email` | 5 | 0 | 5 |
| `@onlook/git` | 4 | 0 | 4 |
| `@onlook/growth` | 3 | 1 | 2 |
| `@onlook/constants` | 1 | 0 | 1 |

**Total rapporté (packages ci-dessus)** : ~2936 problèmes (~12 errors, reste warnings). Beaucoup de warnings Prettier / `no-explicit-any` / hooks ; plusieurs errors = fichiers de test / configs hors `tsconfig` (« not found by the project service »).

#### Autres échecs lint notables

| Package | Symptôme |
| --- | --- |
| `@onlook/docs` | Crash ESLint (exit 2) — config / setup docs |
| `@onlook/web-client` | **SIGABRT** pendant le lint (processus tué ; souvent OOM / limite mémoire) |
| `@onlook/code-provider` | Warnings répétés `'input' is defined but never used` dans les providers (constat d’audit) |

**Interprétation** : `bun run lint` en échec n’est **pas** une régression tant que le profil reste celui ci-dessus. Une régression lint = nouveaux errors sur un package précédemment clean, ou crash nouveau hors web-client/docs, ou hausse nette non expliquée.

## Comment juger une régression

1. **Bun** ≠ 1.3.1 → corriger l’outil avant de comparer.
2. **Typecheck** : comparer uniquement `bun run typecheck` (PASS attendu).
3. **Tests** : comparer `bun test --timeout 30000` (0 fail attendu ; 1 skip connu).
4. **Lint** : déjà rouge ; ne bloquer que sur **delta** (nouveaux packages cassés, nouveaux errors, ou SIGABRT ailleurs que web-client).

## Suivi

- Issue : [SID-22](https://linear.app/side-projects-mart1/issue/SID-22/etablir-la-baseline-qualite-typecheck-lint-tests-version-de-bun)
- Parent : SID-5
- Remesurer après campagnes lint/typecheck package-level et mettre à jour ce fichier + la date / le SHA.
