// Ambient declarations for type-only gaps in third-party packages.
// This file must stay a script (no top-level import/export) so `declare
// module` introduces new ambient modules instead of augmenting existing ones.

// katex ships no type declarations for its CSS entrypoints; the stylesheet is
// dynamically imported for its side effect only (see useKatexStyles).
declare module "katex/dist/katex.min.css";
