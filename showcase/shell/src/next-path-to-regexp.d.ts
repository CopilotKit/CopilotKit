// Minimal typing for Next's vendored path-to-regexp — the compiled
// module (next/dist/compiled/path-to-regexp) ships no .d.ts. Used by
// middleware.test.ts to compile the middleware `matcher` exactly the
// way Next does.
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(
    path: string,
    keys?: unknown[],
    options?: { delimiter?: string; sensitive?: boolean; strict?: boolean },
  ): RegExp;
}
