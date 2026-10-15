// TypeScript 7 rejects side-effect CSS imports without a module declaration.
// tsdown/rolldown still bundles the CSS; the type checker only needs the module.
declare module "*.css";
