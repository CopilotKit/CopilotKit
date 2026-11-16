# Chat Customization (CSS)

## What This Demo Shows

How far you can change `CopilotChat` with CSS alone: no slot overrides, no component swaps, no extra React. The default look is rounded, sans-serif and light. This demo replaces it with **HALCYON**, a warm-paper editorial theme.

A team can take `CopilotChat` as it is and match it to their own brand without a change to a component file.

## How It Works

Two layers do the work:

1. **Token overrides on `[data-copilotkit]`**: `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius` and more. They recolor every Tailwind utility that the chat renders, for example `cpk:bg-muted` and `cpk:text-foreground`.
2. **Class rules**: `.copilotKitChat`, `.copilotKitMessages`, `.copilotKitMessage.copilotKitUserMessage`, `.copilotKitMessage.copilotKitAssistantMessage` and `.copilotKitInput`, plus rules for the welcome screen, the suggestions and the scrollbar.

Every selector starts with `.chat-css-demo-scope`, so the theme cannot change the rest of the app.

## How to Interact

Type a prompt and watch the conversation render in the HALCYON style. For example:

- "Say hi"
- "Write a one-paragraph product memo about quarterly OKRs"
- "Show me a Python snippet for retry with exponential backoff"
- "Quote a famous business strategist on focus"

What you see:

- The user message renders as a mono line with an ember `→` marker.
- The assistant replies in a serif font, with an ember rule on the left and a dark card for code blocks.
- The input becomes a sharp card, with an ember focus ring and a square copper send button.

## Aesthetic Notes

- **Surface**: warm parchment (`#F4EFE6`), one ember glow in the top-left corner, and a light paper grain from an inline SVG.
- **Masthead**: a small, centered mono label at the top of the chat surface.
- **Typography**: Instrument Serif (display, italic), Fraunces (assistant text), Inter Tight (UI) and JetBrains Mono (user messages, metadata and suggestions).
- **Accent**: deep copper ember (`#C44A1F`), only on the user marker, the assistant rule, the send button and the focus rings.
- **Geometry**: sharp 90-degree corners everywhere (`--radius` is `0px`), not the default rounded pills.

## Technical Details

- `<CopilotKit>` connects to `/api/<integration>/chat-customization-css` (from `useDemoRuntimeUrl`) with `agent="chat-customization-css"`.
- `<CopilotChat>` is inside `<div className="chat-css-demo-scope">`. The page applies the theme with `import "./theme.css"`.
- `theme.css` first overrides the v2 token variables on `[data-copilotkit]`, so the Tailwind utilities recolor. Then it adds class rules for the details that variables cannot express.
- The fonts load from Google Fonts through an `@import` at the top of `theme.css`. Copy the file into another project and the theme works there too.
- Use slots (see `chat-slots`) to change _what_ a part renders. Use CSS, as in this demo, to change only how it looks.
