// Ambient declarations for type-only gaps in third-party packages.
// This file must stay a script (no top-level import/export) so `declare
// module` introduces new ambient modules instead of augmenting existing ones.

// katex ships no type declarations for its CSS entrypoints; the stylesheet is
// dynamically imported for its side effect only (see useKatexStyles).
// TypeScript 7 also rejects local side-effect CSS imports without a module.
declare module "*.css";
declare module "katex/dist/katex.min.css";
