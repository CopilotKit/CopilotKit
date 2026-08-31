# Chat Customization (CSS)

## What This Demo Shows

How far you can push `CopilotChat` with CSS alone — no slot overrides, no
component swaps, no React. The default look is rounded, system-sans, and
minimal-light. This demo replaces it with **HALCYON**, a warm-paper
editorial brand: cream parchment surface, sharp 90° corners, copper-ember
accents, an italic display serif for big headings, a Fraunces serif voice
for the assistant, and JetBrains Mono dispatch lines for the user.

The point: a team can take CopilotChat off the shelf and skin it to match
their own brand without ever opening a component file.

## How it works

Two layers do the work:

1. **v2 token overrides on `[data-copilotkit]`** — `--background`,
   `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`,
   etc. Recolors every Tailwind utility (`cpk:bg-muted`,
   `cpk:text-foreground`, …) the runtime renders.
2. **Class-targeted styling** — `.copilotKitChat`, `.copilotKitMessages`,
   `.copilotKitMessage.copilotKitUserMessage`,
   `.copilotKitMessage.copilotKitAssistantMessage`, `.copilotKitInput`, the
   welcome screen, suggestions, scrollbar.

Every selector is namespaced under `.chat-css-demo-scope`, so the theme
cannot leak into the rest of the showcase.

## How to Interact

Type any prompt and watch the conversation render in the HALCYON voice:

- `"Say hi"`
- `"Write a one-paragraph product memo about quarterly OKRs"`
- `"Show me a Python snippet for retry with exponential backoff"`
- `"Quote a famous business strategist on focus"`

You'll see:

- The user line render as a mono CLI dispatch with an ember `→` marker
- The assistant respond in serif body type with editorial spacing, an
  ember left rule, and a dark code-card for code blocks
- The composer pill flatten to a sharp card with an ember focus ring and
  a square copper send button

## Aesthetic Notes

- **Surface** — warm parchment (`#F4EFE6`) with a single ambient ember glow
  in the top-left and a barely-perceptible paper-grain noise via inline
  SVG
- **Masthead** — a centered mono label pinned just under the top edge of
  the chat surface (`CopilotChat · Customized with CSS`)
- **Typography** — Instrument Serif (display, italic), Fraunces (assistant
  body), Inter Tight (UI), JetBrains Mono (user dispatch + metadata +
  suggestions)
- **Accent** — deep copper ember (`#C44A1F`), used only on the user prompt
  marker, the assistant left rule, the send button, and focus rings —
  sparingly, so it actually reads as signal
- **Geometry** — sharp 90° corners everywhere (radius is overridden to
  `0px`), opposite of the default rounded pills

## Technical Details

- `<CopilotKit>` wires `runtimeUrl="/api/copilotkit"` and
  `agent="chat-customization-css"` (backed by `graph` in
  `src/agents/main.py`)
- `<CopilotChat>` is wrapped in `<div className="chat-css-demo-scope">`;
  the theme is applied by `import "./theme.css"` at the top of the page
- `theme.css` first overrides the v2 token variables on `[data-copilotkit]`
  (so Tailwind utilities recolor automatically), then layers
  class-targeted rules on top for the editorial details that CSS
  variables alone can't express
- Fonts load from Google Fonts via `@import` at the top of `theme.css`
  so the demo is self-contained — copy the file into another project and
  the theme works end-to-end
- Reach for slots (see `chat-slots`) when you need to change _what_ a
  piece renders, not just how it looks; reach for CSS — like this demo —
  when the default structure is fine and you only need a different
  visual identity
