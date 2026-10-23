# Audit des licences des dépendances (SID-19)

> Audit Phase 0 — fork Onlook (`Mart1M/onlook`).  
> Date : 2026-10-22 · Scope : **dépendances directes** de tous les workspaces Bun du monorepo · Licence projet : **Apache-2.0**.

## Résumé

| Métrique | Valeur |
|---|---|
| Workspaces scannés | 30 |
| Dépendances directes externes (uniques) | 222 |
| Dont production (`dependencies` / peer / optional) | 183 |
| Dont dev-only | 39 |
| Risque **HIGH** | 2 |
| Risque **MEDIUM** | 2 |
| Risque **LOW** | 218 |

Répartition des licences (toutes deps directes) :

| Licence | Nb packages |
|---|---|
| MIT | 190 |
| Apache-2.0 | 22 |
| LGPL-3.0-or-later | 2 |
| BSD-2-Clause | 1 |
| UNKNOWN | 1 |
| Commercial | 1 |
| BlueOak-1.0.0 | 1 |
| ISC | 1 |
| Unlicense | 1 |
| (Apache-2.0 AND MIT) | 1 |
| (MIT OR CC0-1.0) | 1 |

**Verdict global :** aucune licence copyleft forte (GPL / AGPL / SSPL / BUSL) n’a été trouvée. La grande majorité est permissive (MIT / Apache-2.0) et **compatible** avec la distribution Apache-2.0 du monorepo. Deux points bloquants ou conditionnels restent à traiter (Freestyle, Gleap) ; ZenFS (LGPL) est acceptable sous contraintes.

## Méthodologie

1. Extraction de toutes les clés `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` des `package.json` des workspaces (`packages/*`, `apps/*`, `tooling/*`, `docs`).
2. Exclusion des packages internes `@onlook/*` / références `workspace:`.
3. Résolution de la licence via le registry npm (`package.json.license` / `licenses` de la version latest publiée au moment de l’audit).
4. Classification de risque (heuristique, pas un avis juridique) :

| Risque | Critères |
|---|---|
| LOW | MIT, Apache-2.0, BSD-*, ISC, 0BSD, Unlicense, BlueOak, CC0, duals permissifs |
| MEDIUM | LGPL, MPL, EPL et assimilés (obligations de linking / source) |
| HIGH | GPL/AGPL/SSPL/BUSL, Commercial / Proprietary, UNKNOWN / UNLICENSED |

> Cet audit ne couvre **pas** les dépendances transitives. Un scan lockfile complet (`bun pm ls` + lecture des licences installées) est recommandé en suivi.

## Décisions sur licences à risque

### 1. `freestyle-sandboxes` — UNKNOWN — **HIGH**

| | |
|---|---|
| Utilisé par | `@onlook/web-client` (publish / domaines Freestyle) |
| Constat | Aucun champ `license` sur npm ; pas de fichier LICENSE identifiable sur les dépôts publics Freestyle associés |
| Risque | Redistribution / conformité OSS indéterminée ; dépendance SaaS critique |
| **Décision** | **Non compatible tant que non clarifié.** Usage autorisé uniquement sous les conditions contractuelles Freestyle (client API). **Action :** obtenir une licence SPDX écrite auprès de Freestyle, ou planifier un remplacement (ex. `@codesandbox/sdk` déjà présent, MIT). Ne pas considérer le package comme redistribuable sous Apache-2.0. |

### 2. `gleap` — Commercial (npm) / MIT (fichier LICENSE upstream) — **HIGH** (signal npm)

| | |
|---|---|
| Utilisé par | `@onlook/web-client` (telemetry / feedback, init conditionnelle) |
| Constat | `package.json` npm déclare `Commercial` ; le dépôt [GleapSDK/JavaScript-SDK](https://github.com/GleapSDK/JavaScript-SDK) publie un LICENSE de type MIT |
| Risque | Ambiguïté SPDX ; le **service** Gleap reste commercial |
| **Décision** | **Accepté conditionnellement.** Le SDK peut rester tant que (a) l’init reste gated par env, (b) l’usage cloud respecte le contrat Gleap, (c) on documente l’ambiguïté. **Action :** confirmer auprès de Gleap le SPDX exact du package npm ; sinon forker/vendor le SDK MIT ou retirer la dépendance. |

### 3. `@zenfs/core` & `@zenfs/dom` — LGPL-3.0-or-later — **MEDIUM**

| | |
|---|---|
| Utilisé par | `@onlook/file-system`, `@onlook/web-client` |
| Constat | LGPL v3+ ; bibliothèque FS navigateur, consommée non modifiée |
| Risque | Obligations LGPL si modification ; notices ; possibilité de remplacement de la bibliothèque |
| **Décision** | **Accepté avec conformité LGPL.** Ne pas modifier le code ZenFS sans process LGPL ; conserver les notices ; ne pas relicencier ces fichiers en Apache-2.0. **Action optionnelle :** surveiller une alternative permissive si le couplage augmente. |

## SDKs / services tiers (extrait)

| Package | Licence | Risque |
|---|---|---|
| `stripe` | MIT | LOW |
| `openai` | Apache-2.0 | LOW |
| `@ai-sdk/*` / `@openrouter/ai-sdk-provider` | Apache-2.0 | LOW |
| `@supabase/ssr` / `supabase` | MIT | LOW |
| `posthog-js` | Apache-2.0 AND MIT | LOW |
| `posthog-node` | MIT | LOW |
| `@codesandbox/sdk` | MIT | LOW |
| `octokit` / `@octokit/*` | MIT | LOW |
| `resend` | MIT | LOW |
| `freestyle-sandboxes` | UNKNOWN | HIGH |
| `gleap` | Commercial | HIGH |

## Inventaire complet des dépendances directes

| Package | Version (registry) | Licence | Scope | Workspaces | Risque | Décision |
|---|---|---|---|---|---|---|
| `freestyle-sandboxes` | 0.1.46 | UNKNOWN | prod | web-client | HIGH | Bloquant jusqu’à clarification (voir décisions) |
| `gleap` | 19.3.5 | Commercial | prod | web-client | HIGH | À clarifier / ToS SaaS (voir décisions) |
| `@zenfs/core` | 2.7.7 | LGPL-3.0-or-later | prod | file-system, web-client | MEDIUM | Accepté avec contraintes LGPL (voir décisions) |
| `@zenfs/dom` | 1.2.14 | LGPL-3.0-or-later | prod | file-system, web-client | MEDIUM | Accepté avec contraintes LGPL (voir décisions) |
| `@ai-sdk/provider-utils` | 5.0.66 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `@ai-sdk/react` | 4.0.153 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `@ai-sdk/ui-utils` | 1.2.11 | Apache-2.0 | prod | ui | LOW | Accepté |
| `@babel/standalone` | 8.0.7 | MIT | prod | parser | LOW | Accepté |
| `@babel/types` | 8.0.6 | MIT | prod | parser | LOW | Accepté |
| `@chromatic-com/storybook` | 5.6.0 | MIT | dev | web-client | LOW | Accepté |
| `@codemirror/lang-css` | 6.3.1 | MIT | prod | web-client | LOW | Accepté |
| `@codemirror/lang-html` | 6.4.12 | MIT | prod | web-client | LOW | Accepté |
| `@codemirror/lang-javascript` | 6.2.5 | MIT | prod | web-client | LOW | Accepté |
| `@codemirror/lang-json` | 6.0.2 | MIT | prod | web-client | LOW | Accepté |
| `@codemirror/lang-markdown` | 6.5.2 | MIT | prod | web-client | LOW | Accepté |
| `@codesandbox/sdk` | 2.4.2 | MIT | prod | code-provider | LOW | Accepté |
| `@emotion/react` | 11.14.0 | MIT | prod | ui | LOW | Accepté |
| `@emotion/styled` | 11.14.1 | MIT | prod | ui | LOW | Accepté |
| `@eslint/compat` | 2.1.1 | Apache-2.0 | prod | eslint | LOW | Accepté |
| `@eslint/eslintrc` | 3.3.7 | MIT | dev | web-client | LOW | Accepté |
| `@fastify/websocket` | 11.3.4 | MIT | prod | web-server | LOW | Accepté |
| `@hookform/resolvers` | 6.0.0 | MIT | prod | ui | LOW | Accepté |
| `@ianvs/prettier-plugin-sort-imports` | 4.7.1 | Apache-2.0 | prod | prettier | LOW | Accepté |
| `@mendable/firecrawl-js` | 4.51.0 | MIT | prod | ai | LOW | Accepté |
| `@next/eslint-plugin-next` | 16.4.2 | MIT | prod | eslint | LOW | Accepté |
| `@octokit/app` | 16.1.4 | MIT | prod | github | LOW | Accepté |
| `@octokit/auth-app` | 8.3.1 | MIT | prod | github | LOW | Accepté |
| `@octokit/rest` | 22.0.1 | MIT | prod | github | LOW | Accepté |
| `@openrouter/ai-sdk-provider` | 3.1.0 | Apache-2.0 | prod | ai | LOW | Accepté |
| `@opentelemetry/api-logs` | 0.223.0 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `@opentelemetry/instrumentation` | 0.300.0 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `@opentelemetry/sdk-logs` | 3.0.0 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `@radix-ui/react-accordion` | 1.3.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-alert-dialog` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-aspect-ratio` | 1.2.0 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-avatar` | 1.3.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-checkbox` | 1.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-collapsible` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-context-menu` | 2.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-dialog` | 1.3.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-dropdown-menu` | 2.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-hover-card` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-icons` | 1.3.2 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-label` | 2.1.17 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-menubar` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-navigation-menu` | 1.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-popover` | 1.3.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-progress` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-radio-group` | 1.5.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-scroll-area` | 1.4.0 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-select` | 2.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-separator` | 1.2.0 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-slider` | 1.6.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-slot` | 1.5.0 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-switch` | 1.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-tabs` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-toggle` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-toggle-group` | 1.2.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | prod | ui | LOW | Accepté |
| `@radix-ui/react-use-controllable-state` | 1.3.0 | MIT | prod | ui | LOW | Accepté |
| `@react-email/components` | 1.0.12 | MIT | prod | email | LOW | Accepté |
| `@react-email/preview-server` | 5.2.10 | MIT | dev | email | LOW | Accepté |
| `@storybook/addon-a11y` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/addon-actions` | 9.0.8 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/addon-docs` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/addon-onboarding` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/addon-vitest` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/nextjs-vite` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `@storybook/test` | 8.6.15 | MIT | prod | web-client | LOW | Accepté |
| `@supabase/ssr` | 0.12.7 | MIT | prod | web-client | LOW | Accepté |
| `@t3-oss/env-nextjs` | 0.13.11 | MIT | prod | web-client | LOW | Accepté |
| `@tailwindcss/postcss` | 4.3.3 | MIT | dev | docs, web-client | LOW | Accepté |
| `@tailwindcss/typography` | 0.5.20 | MIT | prod | ui | LOW | Accepté |
| `@tanstack/eslint-plugin-query` | 5.104.5 | MIT | prod | eslint | LOW | Accepté |
| `@tanstack/react-query` | 5.104.5 | MIT | prod | web-client | LOW | Accepté |
| `@trpc/client` | 11.19.0 | MIT | prod | web-client | LOW | Accepté |
| `@trpc/react-query` | 11.19.0 | MIT | prod | web-client | LOW | Accepté |
| `@trpc/server` | 11.19.0 | MIT | prod | web-client, web-server | LOW | Accepté |
| `@types/babel__standalone` | 7.1.9 | MIT | dev | parser | LOW | Accepté |
| `@types/babel__traverse` | 7.28.0 | MIT | dev | parser | LOW | Accepté |
| `@types/bun` | 1.4.3 | MIT | dev | backend, web, web-preload, web-server | LOW | Accepté |
| `@types/color-namer` | 1.3.3 | MIT | dev | ui | LOW | Accepté |
| `@types/css-tree` | 3.2.0 | MIT | dev | web-preload | LOW | Accepté |
| `@types/culori` | 4.0.1 | MIT | dev | utility, web-client | LOW | Accepté |
| `@types/jest` | 30.0.0 | MIT | dev | scripts | LOW | Accepté |
| `@types/lodash.debounce` | 4.0.9 | MIT | dev | file-system, web-preload | LOW | Accepté |
| `@types/mdx` | 2.0.14 | MIT | dev | docs | LOW | Accepté |
| `@types/node` | 26.6.5 | MIT | dev | docs, github, prettier, scripts, web-client | LOW | Accepté |
| `@types/prompts` | 2.4.9 | MIT | dev | scripts | LOW | Accepté |
| `@types/react` | 19.3.0 | MIT | dev | docs, file-system, web-client | LOW | Accepté |
| `@types/react-dom` | 19.3.0 | MIT | dev | docs, web-client | LOW | Accepté |
| `@types/react-syntax-highlighter` | 15.5.13 | MIT | prod | ui | LOW | Accepté |
| `@types/uuid` | 11.0.0 | MIT | dev | github | LOW | Accepté |
| `@types/webfontloader` | 1.6.38 | MIT | dev | web-client | LOW | Accepté |
| `@uiw/codemirror-extensions-basic-setup` | 4.25.12 | MIT | prod | web-client | LOW | Accepté |
| `@uiw/react-codemirror` | 4.25.12 | MIT | prod | web-client | LOW | Accepté |
| `@vercel/otel` | 2.1.3 | MIT | prod | web-client | LOW | Accepté |
| `@vitest/browser-playwright` | 5.0.5 | MIT | dev | web-client | LOW | Accepté |
| `@vitest/coverage-v8` | 5.0.5 | MIT | dev | web-client | LOW | Accepté |
| `@xterm/addon-fit` | 0.11.0 | MIT | prod | web-client | LOW | Accepté |
| `@xterm/xterm` | 6.0.0 | MIT | prod | web-client | LOW | Accepté |
| `ai` | 7.0.149 | Apache-2.0 | prod+dev | ai, db, models, ui, web-client | LOW | Accepté |
| `blob-util` | 2.0.2 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `browser-image-compression` | 2.0.2 | MIT | prod | utility | LOW | Accepté |
| `chalk` | 6.0.1 | MIT | prod | scripts | LOW | Accepté |
| `chromatic` | 18.13.3 | MIT | dev | web-client | LOW | Accepté |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | prod | ui, web-client | LOW | Accepté |
| `clsx` | 2.1.1 | MIT | prod | ui, web-client | LOW | Accepté |
| `cmdk` | 1.1.1 | MIT | prod | ui | LOW | Accepté |
| `color-namer` | 1.4.0 | MIT | prod | ui | LOW | Accepté |
| `commander` | 15.0.0 | MIT | prod | scripts | LOW | Accepté |
| `concurrently` | 10.0.6 | MIT | dev | web-preload | LOW | Accepté |
| `css-color-names` | 1.0.1 | MIT | prod | ui | LOW | Accepté |
| `css-tree` | 3.2.1 | MIT | prod | web-preload | LOW | Accepté |
| `culori` | 4.0.2 | MIT | prod | utility, web-client | LOW | Accepté |
| `date-fns` | 4.4.0 | MIT | prod | ui, web-client | LOW | Accepté |
| `dotenv` | 18.0.9 | BSD-2-Clause | prod | db, stripe | LOW | Accepté |
| `drizzle-kit` | 0.31.11 | MIT | dev | db | LOW | Accepté |
| `drizzle-orm` | 0.45.4 | Apache-2.0 | prod | db | LOW | Accepté |
| `drizzle-zod` | 0.8.3 | Apache-2.0 | prod | db | LOW | Accepté |
| `eslint` | 10.13.0 | MIT | dev | ai, code-provider, constants, docs, email, eslint, file-system, fonts, git, github, growth, image-server, models, parser, penpal, rpc, scripts, stripe, types, ui, utility, web-client, web-preload, web-server | LOW | Accepté |
| `eslint-config-prettier` | 10.1.8 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-import` | 2.32.0 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-jsonc` | 3.4.2 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-only-warn` | 1.2.1 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-prettier` | 5.5.7 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-react` | 7.37.5 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | prod | eslint | LOW | Accepté |
| `eslint-plugin-storybook` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `exa-js` | 2.26.0 | MIT | prod | ai | LOW | Accepté |
| `fastify` | 5.12.7 | MIT | prod | web-server | LOW | Accepté |
| `fg` | 0.0.3 | MIT | prod | ai | LOW | Accepté |
| `flexsearch` | 0.8.212 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `free-email-domains` | 1.15.11 | MIT | prod | utility | LOW | Accepté |
| `fumadocs-core` | 16.17.7 | MIT | prod | docs | LOW | Accepté |
| `fumadocs-mdx` | 15.4.9 | MIT | prod | docs | LOW | Accepté |
| `fumadocs-ui` | 16.17.7 | MIT | prod | docs | LOW | Accepté |
| `globby` | 16.2.4 | MIT | prod | git | LOW | Accepté |
| `gpt-tokenizer` | 4.1.0 | MIT | prod | ai | LOW | Accepté |
| `input-otp` | 1.5.0 | MIT | prod | ui | LOW | Accepté |
| `is-subdir` | 2.0.1 | MIT | prod | utility | LOW | Accepté |
| `isomorphic-git` | 1.44.3 | MIT | prod | git | LOW | Accepté |
| `jest` | 30.5.2 | MIT | dev | scripts | LOW | Accepté |
| `langfuse-vercel` | 3.39.2 | MIT | prod | web-client | LOW | Accepté |
| `localforage` | 1.10.0 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `lodash-es` | 4.18.1 | MIT | prod | web-preload | LOW | Accepté |
| `lodash.debounce` | 4.0.8 | MIT | prod | file-system, web-preload | LOW | Accepté |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | prod | web-client | LOW | Accepté |
| `lucide-react` | 1.61.0 | ISC | prod | ui, web-client | LOW | Accepté |
| `marked` | 18.1.1 | MIT | prod | ai | LOW | Accepté |
| `mime-lite` | 1.0.3 | MIT | prod | utility | LOW | Accepté |
| `mobx-react-lite` | 5.1.0 | MIT | prod | web-client | LOW | Accepté |
| `motion` | 14.6.0 | MIT | prod | ui, web-client | LOW | Accepté |
| `nanoid` | 6.0.2 | MIT | prod | web-preload | LOW | Accepté |
| `next` | 16.4.2 | MIT | prod | docs, web-client | LOW | Accepté |
| `next-intl` | 4.14.9 | MIT | prod | web-client | LOW | Accepté |
| `next-sitemap` | 4.2.3 | MIT | prod | docs | LOW | Accepté |
| `next-themes` | 0.4.6 | MIT | prod | ui, web-client | LOW | Accepté |
| `normalize-url` | 10.0.0 | MIT | prod | utility | LOW | Accepté |
| `octokit` | 5.0.5 | MIT | prod | web-client | LOW | Accepté |
| `openai` | 7.42.0 | Apache-2.0 | prod | ai | LOW | Accepté |
| `ora` | 9.4.1 | MIT | prod | scripts | LOW | Accepté |
| `parse-css-color` | 0.2.1 | MIT | prod | ui | LOW | Accepté |
| `penpal` | 8.0.1 | MIT | prod | web-client, web-preload | LOW | Accepté |
| `pg` | 8.23.1 | MIT | prod | db | LOW | Accepté |
| `playwright` | 1.64.1 | Apache-2.0 | dev | web-client | LOW | Accepté |
| `postcss` | 8.5.31 | MIT | dev | docs, web-client | LOW | Accepté |
| `postgres` | 3.4.9 | Unlicense | prod | db | LOW | Accepté |
| `posthog-js` | 1.438.18 | (Apache-2.0 AND MIT) | prod | web-client | LOW | Accepté |
| `posthog-node` | 5.57.0 | MIT | prod | web-client | LOW | Accepté |
| `prettier` | 3.9.10 | MIT | prod+dev | eslint, prettier | LOW | Accepté |
| `prettier-plugin-tailwindcss` | 0.8.1 | MIT | prod | prettier | LOW | Accepté |
| `prompts` | 2.4.2 | MIT | prod | scripts | LOW | Accepté |
| `prosemirror-commands` | 1.7.2 | MIT | prod | web-client | LOW | Accepté |
| `prosemirror-history` | 1.5.1 | MIT | prod | web-client | LOW | Accepté |
| `prosemirror-keymap` | 1.2.3 | MIT | prod | web-client | LOW | Accepté |
| `prosemirror-view` | 1.42.7 | MIT | prod | ui | LOW | Accepté |
| `react` | 19.3.1 | MIT | prod+dev | docs, email, file-system, ui, web-client | LOW | Accepté |
| `react-arborist` | 4.0.1 | MIT | prod | web-client | LOW | Accepté |
| `react-codemirror-merge` | 4.25.12 | MIT | prod | web-client | LOW | Accepté |
| `react-day-picker` | 10.0.2 | MIT | prod | ui | LOW | Accepté |
| `react-dom` | 19.3.1 | MIT | prod+dev | docs, email, ui, web-client | LOW | Accepté |
| `react-email` | 6.11.3 | MIT | prod | email | LOW | Accepté |
| `react-hook-form` | 7.90.0 | MIT | prod | ui | LOW | Accepté |
| `react-hotkeys-hook` | 5.3.3 | MIT | prod | web-client | LOW | Accepté |
| `react-markdown` | 10.1.0 | MIT | prod | web-client | LOW | Accepté |
| `react-merge-refs` | 3.0.2 | MIT | prod | ui | LOW | Accepté |
| `react-resizable-panels` | 4.14.8 | MIT | prod | ui | LOW | Accepté |
| `react-syntax-highlighter` | 16.1.2 | MIT | prod | ui | LOW | Accepté |
| `recharts` | 3.10.1 | MIT | prod | ui | LOW | Accepté |
| `remark-gfm` | 4.0.1 | MIT | prod | web-client | LOW | Accepté |
| `resend` | 6.34.1 | MIT | prod | email | LOW | Accepté |
| `server-only` | 0.0.1 | MIT | prod | web-client | LOW | Accepté |
| `sharp` | 0.35.5 | Apache-2.0 | prod | image-server | LOW | Accepté |
| `shiki` | 4.5.0 | MIT | prod | web-client | LOW | Accepté |
| `sonner` | 2.0.8 | MIT | prod | ui | LOW | Accepté |
| `storybook` | 10.6.3 | MIT | dev | web-client | LOW | Accepté |
| `streamdown` | 2.7.1 | Apache-2.0 | prod | ui | LOW | Accepté |
| `strip-ansi` | 7.2.0 | MIT | prod | utility, web-client | LOW | Accepté |
| `stripe` | 23.0.1 | MIT | prod | stripe | LOW | Accepté |
| `supabase` | 2.121.0 | MIT | dev | backend | LOW | Accepté |
| `superjson` | 2.2.6 | MIT | prod | web-client | LOW | Accepté |
| `tailwind-merge` | 3.7.0 | MIT | prod | ui, utility, web-client | LOW | Accepté |
| `tailwind-styled-components` | 2.2.0 | MIT | prod | ui | LOW | Accepté |
| `tailwindcss` | 4.3.3 | MIT | prod+dev | docs, ui, web-client | LOW | Accepté |
| `tailwindcss-animate` | 1.0.7 | MIT | prod | ui | LOW | Accepté |
| `tldts` | 7.4.19 | MIT | prod | utility, web-client | LOW | Accepté |
| `tokenlens` | 1.3.1 | MIT | prod | ui | LOW | Accepté |
| `tw-animate-css` | 1.4.0 | MIT | prod | web-client | LOW | Accepté |
| `type-fest` | 5.10.0 | (MIT OR CC0-1.0) | dev | web-client | LOW | Accepté |
| `typescript` | 7.0.2 | Apache-2.0 | dev | ai, backend, code-provider, constants, db, docs, email, eslint, file-system, fonts, git, github, growth, image-server, models, parser, penpal, prettier, rpc, scripts, stripe, types, ui, utility, web, web-client, web-preload, web-server | LOW | Accepté |
| `typescript-eslint` | 8.72.0 | MIT | prod | eslint | LOW | Accepté |
| `unicornstudio-react` | 2.4.0 | MIT | prod | web-client | LOW | Accepté |
| `use-eye-dropper` | 1.8.0 | MIT | prod | ui | LOW | Accepté |
| `use-resize-observer` | 10.0.0 | MIT | prod | web-client | LOW | Accepté |
| `use-stick-to-bottom` | 1.1.6 | MIT | prod | ui | LOW | Accepté |
| `uuid` | 14.0.3 | MIT | prod | ai, db, github, utility, web-client | LOW | Accepté |
| `vaul` | 1.1.2 | MIT | prod | ui | LOW | Accepté |
| `vitest` | 5.0.5 | MIT | dev | web-client | LOW | Accepté |
| `webfontloader` | 1.6.28 | Apache-2.0 | prod | web-client | LOW | Accepté |
| `zod` | 4.6.7 | MIT | prod | ai, models, web-client, web-server | LOW | Accepté |

## Suivi recommandé

1. Clarifier `freestyle-sandboxes` (SPDX ou remplacement) — **prioritaire**.
2. Confirmer le SPDX npm de `gleap`.
3. Ajouter un check CI optionnel (`license-checker` / `bun` script) sur les deps directes avec allowlist.
4. Étendre l’audit aux dépendances transitives via le lockfile (`bun.lock`).

---

*Issue Linear : [SID-19](https://linear.app/side-projects-mart1/issue/SID-19/auditer-les-licences-des-dependances). Ce document n’est pas un conseil juridique.*
