---
"@copilotkitnext/react": patch
---

fix(react): replace static KaTeX CSS import with dynamic runtime injection

The static `import "katex/dist/katex.min.css"` in CopilotChatAssistantMessage.tsx
was preserved by tsdown's unbundle mode in the dist output, causing Next.js builds
with `optimizeCss` to fail because the CSS file couldn't be resolved at build time.

Replaced with a `useKatexStyles()` hook that dynamically imports the CSS at runtime
via `useEffect`, which is tree-shaken in SSR and only loads styles in the browser.
