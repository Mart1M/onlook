# Prototype — injection `data-onlook-loc` (ADR-005)

Implémentation : `packages/parser/src/loc-inject.ts`  
Tests : `packages/parser/test/loc-inject.test.ts`

```bash
bun test packages/parser/test/loc-inject.test.ts
```

Ce prototype prouve la transform Babel **en mémoire**. Le câblage Vite/Next (SID-34) et le runtime F01 sont hors scope.
