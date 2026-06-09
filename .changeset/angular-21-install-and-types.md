---
"@copilotkitnext/angular": patch
---

fix(angular): support Angular 19–21 install and fix README package name

Two fixes hit on a fresh Angular 21 setup:

- Widen the `@angular/*` peer dependency range from `^19.0.0` to
  `^19.0.0 || ^20.0.0 || ^21.0.0` so a clean install on Angular 20/21 no longer
  throws `ERESOLVE` (previously required `--legacy-peer-deps`).
- Correct the README: the package name is `@copilotkitnext/angular` (the old
  `@copilotkit/angular` import path does not exist on npm), the install command
  is `npm install @copilotkitnext/angular`, and document the current `TS7016`
  TypeScript workaround until the `exports` map ships a `types` condition.
