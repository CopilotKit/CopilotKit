// Minimal typing for Next's vendored path-to-regexp — the compiled
// module (next/dist/compiled/path-to-regexp) ships no .d.ts. Used by
// middleware.test.ts to compile the middleware `matcher` exactly the
// way Next does (SU6-A6): tryToParsePath (next/dist/lib/
// try-to-parse-path.ts) calls parse() + tokensToRegexp() with NO
// options and keeps only the regex source, which the runtime
// re-hydrates with `new RegExp(...)`.
declare module "next/dist/compiled/path-to-regexp" {
  /** Opaque parse result — only ever passed back to tokensToRegexp. */
  export type Token = string | object;
  export function parse(path: string): Token[];
  export function tokensToRegexp(tokens: Token[]): RegExp;
  export function pathToRegexp(
    path: string,
    keys?: unknown[],
    options?: { delimiter?: string; sensitive?: boolean; strict?: boolean },
  ): RegExp;
}
