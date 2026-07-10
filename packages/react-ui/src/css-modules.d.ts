// ponytail: ambient shim so tsgo (TS7) accepts side-effect CSS imports.
// tsdown/rolldown handles the actual CSS; the type checker only needs the module to exist.
declare module "*.css";
