# Architecture Decision Records (ADR)

Décisions d’architecture du fork Onlook (projet *onlook fork* / React Visual Studio).

Le dossier racine `docs/` est l’application Fumadocs (site de documentation produit). Les ADR vivent donc ici, au format Markdown numéroté, hors de cette app.

| ID | Titre | Statut |
|----|-------|--------|
| [001](./001-reutilisation-moteur-onlook-plan-fork.md) | Réutilisation du moteur Onlook et plan de fork | Accepted |
| [002](./002-base-fork-et-sync-upstream.md) | Base de fork et politique de synchronisation upstream | Accepted |

## Convention

- Fichier : `NNN-titre-kebab.md`
- Statuts : `Proposed` → `Accepted` | `Rejected` | `Superseded by ADR-XXX`
- Une décision par fichier ; les détails d’implémentation restent dans Linear / le code.
