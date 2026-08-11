# QA: Chat Customization (CSS) (OpenClaw)

Demo source: `src/app/demos/chat-customization-css/page.tsx` (+ `theme.css`)
Route: `/demos/chat-customization-css` · Agent: `chat-customization-css`

## What it exercises

A pure **frontend / CSS** demo: how far `CopilotChat` can be re-skinned with a
single stylesheet, no slot overrides or component swaps. `theme.css` layers a
warm-paper editorial theme ("HALCYON") over the default look in two ways — v2
token overrides on `[data-copilotkit]` (recoloring the Tailwind utilities the
runtime renders) and class-targeted rules on `.copilotKitChat`,
`.copilotKitMessage*`, `.copilotKitInput`, etc. Every selector is namespaced
under `.chat-css-demo-scope` so the theme cannot leak into the rest of the
showcase.

There is **no demo-specific backend**. Like every OpenClaw demo, this one maps
to the same single stateless gateway endpoint; the chat is plain pass-through
through the ag-ui channel. Nothing here depends on OpenClaw beyond ordinary
token-streamed chat — the demo is entirely about the visual layer.

## Manual steps

1. Open the demo. Confirm the chat surface renders in the HALCYON look, not the
   default: warm parchment (`#F4EFE6`) background, sharp 90° corners (no rounded
   pills), and the centered mono masthead `CopilotChat · Customized with CSS`
   pinned near the top edge.
2. Confirm the composer is a flat, sharp card with an ember focus ring and a
   square copper send button (not the default rounded input).
3. Send: **"Say hi"**. Confirm the round-trip works and the streamed reply
   renders in the themed voice — serif assistant body type with an ember left
   rule; the user line renders as a mono CLI dispatch with an ember `→` marker.
4. Send: **"Show me a Python snippet for retry with exponential backoff"**.
   Confirm the code block renders inside the dark themed code-card (the theme
   reaches markdown/code content, not just chrome).

## Assertion bar

- The theme is visibly applied (parchment surface, sharp corners, serif/mono
  voice, ember accents) — not the default rounded light look.
- The theme stays **scoped**: no HALCYON styling leaks onto the surrounding
  showcase page (only the `.chat-css-demo-scope` wrapper is affected).
- Chat itself works normally — messages stream and render; no layout breakage
  from the custom CSS.
- No console errors during normal usage.

## Known caveats

- This is a frontend-only demo. It shares the generic OpenClaw chat path, so if
  plain chat works anywhere, it works here — the QA focus is the CSS, not the
  gateway.
- Fonts load from Google Fonts via `@import` in `theme.css`; on a cold/offline
  load the theme falls back to system serif/mono until the webfonts arrive.
  Wait for fonts before judging the typography.
- The demo's README "Technical Details" mentions a `src/agents/main.py` backend
  graph — that is inherited from the claude-sdk frontend and does **not** apply
  to OpenClaw, which has no per-demo backend.
