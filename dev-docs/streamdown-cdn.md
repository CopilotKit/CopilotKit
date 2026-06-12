# Streamdown v2 — runtime loading & CSP

`@copilotkit/react-core/v2`'s chat (`CopilotChatAssistantMessage`,
`CopilotChatReasoningMessage`) renders markdown with [streamdown](https://github.com/vercel/streamdown)
v2. Unlike v1 (which bundled Shiki language packs, Mermaid, and KaTeX eagerly —
~4 MB gzip of drag), v2 makes those opt-in plugins and loads their machinery
lazily. CopilotKit wires them in `StreamdownWithPlugins.tsx`, which is itself
behind `React.lazy`, so:

- **Builds that never render chat ship 0 bytes** of streamdown/shiki/mermaid/katex.
- When chat _is_ rendered, streamdown + the code/math/mermaid plugins load as
  **lazy chunks** (verified in a production Next 15 build: streamdown, KaTeX,
  Mermaid, and Shiki appear only in lazy chunks — none in the initial/shared JS;
  Shiki's `oniguruma` regex engine isn't bundled at all).

## What loads at runtime (CSP implications)

| Feature                                           | How it loads                                                                                                                       | Offline / strict-CSP behavior                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Code highlighting** (Shiki, `@streamdown/code`) | Shiki loads grammar/engine machinery at runtime rather than bundling every language.                                               | **Degrades gracefully** — code blocks still render, just unhighlighted (verified: with the network blocked, blocks render as plain code, no error).                                  |
| **Math** (KaTeX, `@streamdown/math`)              | KaTeX JS is bundled in the lazy chunk; its CSS is injected at runtime by `useKatexStyles` **only when the message contains math**. | **Works fully offline** (KaTeX is bundled; CSS is same-origin). Math fonts come from the KaTeX CSS — bundle them with your app (most bundlers do) to render the special math glyphs. |
| **Diagrams** (Mermaid, `@streamdown/mermaid`)     | Mermaid renders **on demand** (the user clicks to render a diagram), loading Mermaid then.                                         | Diagram rendering needs Mermaid loaded; the rest of chat is unaffected.                                                                                                              |

**If your app sets a strict Content-Security-Policy** and code highlighting
matters, confirm the policy permits whatever Shiki fetches at runtime (inspect
the network panel for the origin and add it to `connect-src`/`script-src`), or
accept the graceful fallback to unhighlighted code. The chat, markdown, and math
do **not** depend on any third-party CDN.

## CJS safety (ESM-only deps)

`streamdown` and `@streamdown/{code,math,mermaid}` ship ESM only — their
`package.json` `exports` omit a `require` condition, so `require("streamdown")`
throws `ERR_PACKAGE_PATH_NOT_EXPORTED` in a Node CJS runtime.

To keep the published CJS build safe, these packages are loaded with a dynamic
`import()` inside the `React.lazy` factory in `LazyStreamdown.tsx`, **not** a
static `import`. tsdown/rolldown preserves a dynamic `import()` as a native
`import()` in the CJS output (a static import would be emitted as `require()`),
and native `import()` resolves an ESM-only package correctly from CJS. The
dynamic import also keeps these packages code-split into a lazily-loaded chunk,
so builds that never render chat ship 0 bytes of streamdown.

This is enforced at build time: `dist/**/*.cjs` must contain no
`require("streamdown")` / `require("@streamdown/…")` — only the dynamic
`import(...)` form. (An earlier approach inlined the packages via `tsdown
noExternal`, but that pushed the lazy chunk past CI's default Node heap and
OOM'd the build; the dynamic-import approach avoids both the `require()` trap and
the inlining cost.)

## Security note

`mermaid` enters the graph via streamdown v2 itself (a direct `^11.12.2`
dependency) as well as `@streamdown/mermaid`, and had open advisories (XSS/DoS)
in `<11.15.0`. A repo-wide pnpm override pins `mermaid: >=11.15.0` (within
streamdown's `^11.12.2` range); keep it until streamdown's own floor moves past
the patched version.

Separately, a `shiki: 3.22.0` pnpm override dedupes Shiki to one version —
`@streamdown/code` resolves shiki 3.22 while `streamdown` resolves 3.21, and the
mismatch otherwise produces a `CodeHighlighterPlugin` type error (their
`BundledLanguage` unions diverge).
