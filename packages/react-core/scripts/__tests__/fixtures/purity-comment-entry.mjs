// Fixture proving the guard matches the resolved module graph, never file text.
// Every banned token of the real FORBIDDEN list appears below — in a comment and
// in a string literal — while this module links none of them: no `streamdown`,
// no shiki, no mermaid, no cytoscape, no katex.
export const NOT_IMPORTS = [
  "shiki",
  "mermaid",
  "cytoscape",
  "katex",
  "streamdown",
];

// Counter-examples, documented the way a reviewer would write them. Neither may
// register as an import, and the second must not register as an unanalyzable
// loader call either:
//   import { Streamdown } from "streamdown";
//   const heavy = await import(rendererName);
export * from "./purity-chunk.mjs";
