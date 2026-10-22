# ADR-005 — Mapping DOM ↔ source sans écrire dans le code utilisateur

- **Status** : Accepted (proposition validée pour le fork)
- **Date** : 2026-10-22
- **Issue** : [SID-33](https://linear.app/side-projects-mart1/issue/SID-33/adr-mapping-domsource-sans-ecrire-dans-le-code-utilisateur)
- **Epic** : [SID-7](https://linear.app/side-projects-mart1/issue/SID-7/epic-moteur-de-synchronisation-code-et-mapping-source-f08) (F08)
- **Suite** : [SID-34](https://linear.app/side-projects-mart1/issue/SID-34/plugin-de-build-injectant-la-localisation-source-vite-puis-next) (plugin Vite puis Next)
- **Soft-dep** : [SID-16](https://linear.app/side-projects-mart1/issue/SID-16/adr-001-reutilisation-du-moteur-onlook-et-plan-de-fork) (ADR-001) — absent du dépôt au moment de la rédaction ; ce document reste self-contained. Si ADR-001 liste déjà le mapping `data-oid` comme « à remplacer », s’y aligner sans contradiction.

## Contexte

Le moteur Onlook actuel mappe un nœud DOM vers le JSX source via un attribut `data-oid` **écrit sur disque** dans chaque fichier TSX/JSX importé (`packages/parser/src/ids.ts` → `addOidsToAst`, appelé depuis `packages/file-system/src/code-fs.ts` à chaque `writeFile`).

Conséquences constatées :

1. **Diff Git pollué** — l’import ou toute resynchronisation ajoute/modifie des `data-oid` sans intention produit.
2. **Contradit PRD §4.4 / §27.2** — le code utilisateur ne doit pas porter de métadonnées éditeur.
3. **Instances de composants** — l’`oid` posé sur `<Child data-oid="…" />` n’apparaît pas dans le DOM si le composant ne propage pas ses props ; l’éditeur compensait avec un algo AST+DOM (voir `apps/web/client/src/components/store/editor/ast/README.md`).
4. **React 19** — le client est en `react@19.2.0`. React a retiré `__source` / `_debugSource` des fibers ([facebook/react#28265](https://github.com/facebook/react/pull/28265)). Toute stratégie fondée uniquement sur le fiber est invalide sans preuve contraire.

## Décision

**Adopter un plugin de build (Babel pour Vite en premier ; SWC/Babel pour Next ensuite) qui injecte une localisation stable `fichier:ligne:colonne` uniquement dans le graphe de modules transformé (mémoire / HMR), jamais dans les fichiers sources sur disque.**

Attribut proposé (dev only) : `data-onlook-loc="<relpath>:<line>:<column>"`.

Le moteur de sync (parser Babel existant, commandes apply/undo) continue de lire/écrire le **vrai** code utilisateur, adressé par cette localisation (ou par un index dérivé), sans réintroduire d’oids persistés.

## Options comparées

| Critère | A. `data-oid` (status quo) | B. Plugin build (choisi) | C. Fiber `_debugSource` |
|---|---|---|---|
| Écrit sur disque | Oui | Non | Non |
| Diff Git propre | Non | Oui | Oui |
| React 19 | OK | OK | **Cassé** (API retirée) |
| Stabilité de l’API | Interne Onlook | Contrôlée (notre plugin) | Interne React, non contractuelle |
| Éléments intrinsèques (`div`, …) | OID sur DOM | Loc sur DOM | N/A |
| Instances de composants | Algo AST+DOM si props non propagées | Même problème structurel : loc sur l’ouverture JSX custom n’atteint le DOM que si spread ; résolution d’instance via index AST (réutiliser l’algo actuel, clé = loc ou symbole) | Owner chain + stacks lazy (imprécis, dépend source maps) |
| Coût build | N/A (écriture FS) | Transform JSX en dev | Nul côté build, fragile runtime |
| Prod | Oids souvent laissés | Transform **désactivée** hors dev/éditeur | N/A |
| Effort fork | Zéro court terme, dette PRD | SID-34 (Vite → Next) | Preuve négative déjà établie |

### A — `data-oid` (rejeté pour le mapping durable)

- **Pour** : déjà câblé ; index OID → template node mature ; tests nombreux.
- **Contre** : viole l’exigence « ne pas écrire dans le code utilisateur » ; pollue Git ; couple l’identité éditeur au contenu versionné.
- **Rôle résiduel** : éventuellement migration / compat lecture seule le temps du bascule ; pas de nouvelles écritures d’oids à l’import.

### B — Plugin de build (retenu)

- **Pour** : source disque intacte ; loc exacte du site JSX ; pattern éprouvé post-React 19 (écosystème click-to-component / code-inspector) ; aligné SID-34.
- **Contre** : doit s’intégrer au pipeline Vite (puis Next/SWC) ; resync des locs après edits (HMR / re-transform) ; instances custom à résoudre hors attribut DOM.
- **Mitigations** :
  - Dev/éditeur only ; zero overhead prod.
  - Index côté éditeur : `loc → TemplateNode` construit en parseant les sources (sans mutation), en parallèle du DOM annoté.
  - Instances : conserver l’algorithme parent/index/nom de composant du README AST, en remplaçant la clé `oid` par `(file, line, col)` ou un hash dérivé non persisté.

### C — Fiber / `_debugSource` (rejeté comme fondation)

- **Pour** : zéro transform si l’API existait.
- **Contre** : retiré en React 19 ; DevTools bascule sur stacks lazy + source maps ([#28351](https://github.com/facebook/react/pull/28351)) — précision JSX call-site dégradée ; dépend d’internals non stables.
- **Usage éventuel** : heuristique secondaire (nom de composant via `_debugOwner` / stacks) **après** localisation primaire par plugin — jamais seule source de vérité.

## Prototype minimal

Preuve hors runtime F01 (pas de câblage Vite/Next ici) :

- Transform : `packages/parser/src/loc-inject.ts` — `addSourceLocToAst(ast, filename)`
- Tests : `packages/parser/test/loc-inject.test.ts`
- Démo script : `adr/prototypes/dom-source-loc/README.md`

Propriétés démontrées :

1. L’entrée source (string disque) reste inchangée.
2. La sortie transformée contient `data-onlook-loc` avec `file:line:column`.
3. Les fragments React ne sont pas annotés.
4. Les éléments déjà annotés ne sont pas dupliqués.

## Conséquences

1. **SID-34** implémente le plugin Vite (Babel/esbuild) puis Next (SWC ou Babel), activé seulement en mode éditeur/dev.
2. **`CodeFileSystem.processJsxFile`** doit cesser d’appeler `addOidsToAst` à l’écriture (suivi d’implémentation hors SID-33) ; l’index template s’appuie sur locs / parse source.
3. **Bridge / preload** lit `data-onlook-loc` (et éventuellement un id DOM volatile `data-odid` runtime-only, jamais persisté).
4. **ADR-001 (SID-16)** : noter « mapping `data-oid` → remplacé par plugin loc (ADR-005) » quand il sera rédigé.
5. Pas d’implémentation runtime F01 dans ce livrable.

## Alternatives non retenues (rappel)

| Idée | Pourquoi non |
|---|---|
| Source maps seuls au clic | Pas d’adresse stable élément ↔ nœud JSX sans stack/symbolication coûteuse |
| Wrappers runtime `jsxDEV` custom | Fragile multi-bundler ; collision avec le jsxImportSource utilisateur |
| Oids uniquement en mémoire virtuelle (overlay FS) | Complexe ; fuites possibles vers Git ; toujours un modèle identité opaque vs loc stable |

## Références code

- Injection actuelle : `packages/parser/src/ids.ts`, `packages/file-system/src/code-fs.ts`
- Résolution d’instances : `apps/web/client/src/components/store/editor/ast/README.md`
- Constante OID : `EditorAttributes.DATA_ONLOOK_ID` (`packages/constants/src/editor.ts`)
