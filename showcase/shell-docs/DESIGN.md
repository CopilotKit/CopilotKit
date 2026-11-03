---
name: CopilotKit Docs
description: "Daylight, with the kite's colors": white reading sheets in the website's lilac-grey frame, plum ink type and the copilotkit.ai palette, built on stock Fumadocs through its shadcn bridge preset.
colors:
  canvas: "#ffffff"
  ink: "#010507"
  plum: "#141021"
  frame: "#ededf5"
  frame-foreground: "#3f3d4a"
  frame-rim: "#dbdbe5"
  sidebar-lilac: "#4a4fc0"
  stage-sky: "#8dc1f1"
  stage-lilac: "#686fdf"
  stage-bloom: "#6357e5"
  slate: "#57575b"
  lilac-ink: "#5057cc"
  lilac: "#bec2ff"
  lilac-soft: "#eee6fe"
  lilac-mid: "#757cf2"
  lilac-deep: "#5b62d4"
  mint: "#85ecce"
  mint-soft: "#dafbf1"
  mint-deep: "#189370"
  mint-ink: "#11785b"
  orange: "#ffac4d"
  red: "#fa5f67"
  red-ink: "#c8323b"
  signal-blue: "#1b70c4"
  grey-wash: "#f4f4f8"
  code-well: "#f7f7f9"
  hairline: "#e9e9ef"
  input-edge: "#e2e2ea"
  band-controlled: "#4caf50"
  band-declarative: "#42a5f5"
  band-open: "#e88d8d"
  night-canvas: "#0b0b10"
  night-card: "#111118"
  night-popover: "#15151d"
  night-wash: "#1b1b25"
  night-text: "#f4f4f7"
  night-slate: "#a3a3b0"
  night-red: "#fa8a90"
  night-sky: "#8cb9f2"
  night-frame: "#16161f"
  night-frame-foreground: "#c4c4d0"
  night-stage-sky: "#2c5683"
  night-stage-lilac: "#3a3f9e"
  night-stage-bloom: "#2f2a8c"
  glyph-tile-sky: "#5b86de"
  glyph-tile-lilac: "#5d5fd8"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  display-sm:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  section:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.33
  subtitle:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.6
  lead:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.56
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  code:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
  button-mono:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
  3xl: "48px"
  full: "9999px"
components:
  tray:
    backgroundColor: "{colors.frame}"
    rounded: "{rounded.2xl}"
    padding: "12px"
  link-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.plum}"
    rounded: "{rounded.lg}"
    padding: "20px"
  primary-pill:
    backgroundColor: "{colors.plum}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    height: "44px"
  nav-item-active:
    backgroundColor: "#4a4fc01a"
    textColor: "{colors.sidebar-lilac}"
    rounded: "{rounded.lg}"
  code-block:
    backgroundColor: "{colors.canvas}"
    typography: "{typography.code}"
    rounded: "{rounded.xl}"
---

# Design System: CopilotKit Docs

## Overview

**Creative North Star: "Daylight, with the kite's colors."**

White reading sheets set in the website's own lilac-grey room (`#ededf5`, copilotkit.ai's `--new-background`), with the website's plum ink (`#141021`) and its palette carried with restraint. Everything a reader reads sits on white; the frame around it (the docs sidebar and gutters, the trays that hold card grids and menus, the playground's ground) is the lilac-grey, so white panels separate from the room by color, the way the website separates its tabs and panels, instead of by shadows. Lilac is the voice: actions, "you are here", inline code, the code theme's keywords. Mint is the second voice: live demos, success, and Intelligence. The mood is calm, precise, a little playful: light display type, nested radii (12px cards in 24px trays), solid glyphs with no tiles, round pills, and the product drawn as a picture on the website's protocol-map stage. No glows, and glass only on the navbar's menus (the docs owner's call, October 29 2026). Two gradients, both the website's own: the protocol-map stage, and the lilac-to-mint accent on the home headline's "any agent".

The system stays on stock Fumadocs. `global.css` loads Fumadocs' own **shadcn bridge preset** (`fumadocs-ui/css/shadcn.css`), which points every `--color-fd-*` token and the sidebar at the shadcn variables; `src/app/theme.css` sets those variables to brand values and follows the shape of Fumadocs' shipped presets (prose variables, inline code, the sidebar, code figures; compare `fumadocs-ui/css/vitepress.css`). So Fumadocs and shadcn/ui read one palette, and a Fumadocs upgrade only needs `theme.css` checked.

**Key Characteristics:**

- White content in light mode; ink (#0b0b10, not grey) in dark mode.
- The website's lilac-grey frame (#ededf5; night #16161f) for chrome and trays, never under prose.
- Plum ink (#141021) for type; plum-grey (#3f3d4a) for the frame's navigation text.
- Lilac for what you act on and where you are; mint for live things and Intelligence.
- shadcn/ui for every component Fumadocs doesn't ship (`src/components/ui`, Base UI primitives, the `base-nova` style).
- Plus Jakarta Sans for reading, Spline Sans Mono for code and the "Copy prompt" pill.

## Colors

### The voices

- **Lilac ink** (`lilac-ink`, #5057cc; dark: `lilac`): `--primary`. Links, the active TOC entry, selected chips and filters, focus rings, inline code, code keywords, the hovered docs glyph, and the accent words in the home headline. Derived from the website's lilac-deep (#5b62d4), darkened to clear 4.5:1 on white and on lilac-soft. In the sidebar it deepens to `sidebar-lilac` (#4a4fc0) so the active row clears 4.5:1 on its tint over the frame.
- **Hover grey** (#f0f0f4, the website's `--container-hovered`; dark: white at 7%): `--accent`. Every hover and highlight fill on white. Lilac-soft is no longer a fill: it isn't one of the website's surfaces.
- **Mint** (`mint-deep`, `mint-soft`, `mint-ink`; dark: `mint`): live demos (the loading spinner and live dots) and success callouts.
- **Section accent** (`sidebar-lilac`, `--sidebar-primary`: #4a4fc0; dark #bec2ff): every sidebar section heading and its glyph, one color for all sections, 4.5:1 or better on the frame in both themes.
- **Accent gradient** (`--accent-gradient`: #6f7bef to #17a27b; dark #a3aaff to #5fe3bd): the website's headline emphasis (#7480f1 to #23d5a2), deepened so both stops clear 3:1 as large text. The home headline's accent words only. `mint-ink` is derived to clear 4.5:1 on mint-soft.
- **State colors**: info lilac, success mint-deep, warning orange, error red (`--color-fd-info/success/warning/error`); `red-ink` is `--destructive`.
- **Code**: `src/proto/code-theme.ts` sets keywords and tags lilac, strings mint, functions blue, types orange, numbers red, comments slate, all 4.5:1 or better in both themes.

### Neutrals

- **Canvas** (#ffffff) for the page, the docs panel, cards, and popovers. **Plum** (#141021, the website redesign's ink) for type and the primary pill; **slate** (#57575b) for secondary text.
- **Frame** (#ededf5, the website's page color) for the docs frame, trays, and the playground ground, with **frame foreground** (#3f3d4a, 9:1) for the sidebar's rows and **frame rim** (#dbdbe5, the website's `border-container`) for its edges. Hover rows on the frame are white at 60%, the website's translucent white.
- **Stage** (`--stage`, the website's protocol-map ground: `stage-sky` #8dc1f1 to `stage-lilac` #686fdf at 145°, with a `stage-bloom` #6357e5 radial): the ground under every pixel matrix (the home diagram and trays, demo frames, code blocks), with translucent white tiles (60%) and white rims (70%). It replaced the website's lilac use-case ground on the docs owner's call (October 29 2026).
- **Grey wash** (#f4f4f8) for `--secondary` and `--muted`, **code well** (#f7f7f9), **hairline** (#e9e9ef) and **input edge** (#e2e2ea): the website's cool greys, used only as accents.
- **Night set**: canvas #0b0b10, card #111118, popover #15151d, wash #1b1b25, frame #16161f (rows #c4c4d0), text #f4f4f7, slate #a3a3b0; the stage deepens to #2c5683 / #3a3f9e.

### Named Rules

**The Daylight Rule.** Everything a reader reads is on white (ink in dark mode): the docs panel, the home page, cards, code. The website's lilac-grey frames it: the docs frame, the trays under card grids and navbar menus, the playground ground. Prose never sits on the frame, and the frame never sits inside the panel. Grey draws hairlines, holds code, and fills quiet controls.

**The Two Voices Rule.** Lilac means "act here" or "you are here"; mint means "live". Card, menu, and sidebar-row glyphs are plum ink (the active row's turns lilac with its text); only the sidebar's section headings take color, all the same lilac. Selection is a lilac-mid outline (frontend chips), never a lilac fill. Brand color marks things (outlines, pills, dots, the active row, section headings), never a reading surface.

**The Preset Rule.** Colors live in `theme.css` as shadcn variables, read by Fumadocs through its shadcn bridge preset. Beyond those variables, `theme.css` touches only what Fumadocs' own presets touch: `.prose` variables, inline code, `figure.shiki`, variables scoped to the sidebar and layout (`#nd-sidebar` takes the frame's text colors and the deeper lilac; `#fd-spacious-layout` sets `--color-fd-card` to the frame, since Spacious paints its frame, phone header, TOC bar, and phone ring with the card color, and `#nd-page-panel` sets it back to white), and the sidebar toggles and mobile header buttons by attribute (`button[aria-controls="nd-sidebar"]`, `button[aria-controls="nd-sidebar-mobile"]`, `#nd-subnav button[data-search]`, the way Fumadocs' vitepress preset targets `button[data-search-full]`). The "Ask AI" chat is CopilotKit's, which declares its own shadcn variables on `[data-copilotkit]`; the light and dark variable blocks also match `html [data-copilotkit]` so the chat reads the same palette and fonts. Never restyle a Fumadocs component any other way.

## Typography

**Body Font:** Plus Jakarta Sans (with ui-sans-serif, system-ui)
**Label/Mono Font:** Spline Sans Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** A friendly geometric sans in sentence case for everything a reader reads, and a technical mono reserved for code and buttons, as the brand's type system specifies. Both load through `next/font/google` in `layout.tsx` and reach Fumadocs through `--font-sans` and `--font-mono`.

### Hierarchy

- **Display** (400, 56px, 1.04, -0.03em; 40px below `md`): the docs home hero headline only, the website's light display voice. Its accent words take 500 and the accent gradient, as on the website.
- **Headline** (500, 40px, 1.1, -0.03em; 36px below `md`): the page title (`DocsTitle`).
- **Section** (500, 24px, 1.25, -0.03em): the home's section titles, as the website sets its section titles.
- **Lead** (400, 18px, 1.56, slate): the page description under the title.
- **Title** (600, 24px, 1.33): section headings (h2).
- **Subtitle** (600, 20px, 1.6): subsection headings (h3), step titles.
- **Body** (400, 16px, 1.75): prose, in Spacious' 760px column.
- **Card title** (600, 16px, 1.5): link cards, as the website's tab titles.
- **Label** (400, 14px, 1.43): sidebar, TOC, tabs (500 when active), table cells.
- **Code** (Spline Sans Mono 400, 13px): code blocks and inline code.
- **Button Mono** (Spline Sans Mono 500, 12px): the page-action buttons ("Copy Markdown", "Open"), matching copilotkit.ai's "Copy Prompt" control.

### Named Rules

**The Mono-Is-For-Machines Rule.** Spline Sans Mono appears only on code, code-like text, and buttons. Never for paragraphs, headings, or labels a person reads as prose.

**The Sentence Case Rule.** Plus Jakarta Sans is always sentence case. No all-caps headings or labels.

## Layout

Fumadocs' Spacious layout, unmodified, as on fumadocs.dev: a 268px sidebar with the logo, the stack picker, search, and the page tree, and the page in a rounded panel with the TOC on the right and Discord, GitHub, and the theme switch in the panel's corner (Spacious' `actions` slot, `src/components/layout/panel-actions.tsx`). The docs home and the examples playground use Fumadocs' Home Layout (navbar only); the playground lays out its body in Spacious' geometry, so it reads as the docs do.

## Elevation & Depth

White separates from the frame by color first, as on the website, so cards in trays carry no border or shadow at rest; hovering one takes the website's lilac `border-action` edge. Controls that float on the frame (the stack picker, search, Copy prompt) keep a soft two-layer lift (`--lift`: 1px and 10px, plum at 4 to 5%). The stage takes the website's broad shell shadow (`--lift-stage`: 12px 24px 29px -6px at 6%). Nothing glows or blurs.

## Shapes

The brand radius scale (4 / 8 / 12 / 16 / 24 / 48px) on Tailwind's `sm` to `3xl`, nested the website's way (outer = inner + padding): cards at 12px inside 20px trays with 8px padding, inputs at 12px, the docs panel at 24px, the stage at 20px with tiles at a quarter of their size. Primary and secondary actions are fully round pills, like the website's "Book a demo" and "Copy prompt".

## Components

Fumadocs ships the docs chrome (layouts, navbar, sidebar, search, TOC, code blocks, callouts). Everything else comes from **shadcn/ui** (`components.json`: `base-nova` style, Base UI primitives, pointer cursors), installed under `src/components/ui`: Button, Item, Accordion, DropdownMenu, Popover, Tooltip, ToggleGroup, InputGroup, Empty, Spinner, and more. Don't hand-build a component shadcn has.

- **Primary pill:** plum fill, white text, 44px, round ("Start the quickstart", "Talk to an engineer", the playground's actions). **Copy prompt:** the website's white mono pill with the Claude and Codex marks (`src/components/docs-mdx/prompts/prompt-pill.tsx`, the one component every copy-prompt control uses).
- **Tray and link cards** (`src/proto/link-card.tsx`): every row in a tray is as tall as its tallest card, so cards are one size. The Guides and Integrations trays take `matrix`: the home's blue protocol-map stage (`--stage`, matching the hero) with its rim, 16px of padding (28px corners), and the pixel matrix showing around and between the cards. A 20px lilac-grey `Tray` holding shadcn `Item` cards, borderless at 12px (`--tray-card`: white, night #20202c so they lift off the night frame), the website's use-case tabs. A 22px solid plum glyph with no tile (lilac on hover; official colors for a framework logo). Hover takes the lilac `border-action` edge.
- **Framework family cards** (`FamilyCard`, families in `FRAMEWORK_FAMILIES` in `src/proto/data.ts`): a framework that ships in several languages (LangGraph, MS Agent Framework with its .NET Harness, AWS Strands, Claude Agent SDK) is one card on the home, with a chip per variant carrying its language's own mark in its own color (Python, TypeScript, FastAPI, .NET, from Simple Icons); hovering or clicking opens a solid popover with a row per variant that goes to that variant's quickstart.
- **Quickstart menu** (`src/proto/quickstart-menu.tsx`): the home's primary pill opens a shadcn `DropdownMenu` of every framework by language; picking one remembers it and opens its quickstart.
- **Stack diagram on the stage** (`src/proto/stack-diagram.tsx`): the website's protocol map in the docs' geometry. Frontends left, CopilotKit's plum tile with the kite in the middle, frameworks right, as translucent white tiles with white rims; faint white wires, each carrying traffic (`travel` in `theme.css`): a white packet runs out toward the agent and another streams back, staggered per wire, paused off screen and hidden for reduced motion. The reader's own frontend and framework are picked out the way the website marks its selected surface: a white tile with an orange (`#ffac4d`) edge, on a solid white wire with plum packets (white in dark mode). CopilotKit's own agent is the middle tile, never a slot on the right; when it's the reader's pick, the middle tile takes the orange edge. The other slots take turns rolling up (`roll-in` / `roll-out` in `theme.css`) to the next framework or frontend whose mark isn't already shown, so the map cycles through every integration; it pauses on hover, off screen, and for reduced motion. In dark mode the stage, tiles, and squares dim (`--stage`, `--matrix-stage`).
- **Frontend picker:** a shadcn `ToggleGroup` of round chips; the chosen one is lilac. The sidebar's stack picker and search are white cards with the lift on the frame; their hovers use the lilac `--accent`, since the sidebar's own accent is white.
- **Sidebar:** plum-grey rows on the frame, white-60% hover glide, the active row tinted lilac with `sidebar-lilac` text.
- **Navbar menus:** Fumadocs' own popup and cards on stage frost, hanging straight out of the navbar (square top corners, no top edge). Each menu carries a hidden `[data-menu-tray]` item; `theme.css` then scopes variables on that popup: a translucent popover color under Fumadocs' own 80% fill, its backdrop blur deepened to 28px and saturated (`--blur-md`, `--tw-backdrop-saturate`), and a light wash of the stage's sky-to-lilac over it (`--menu-frost`, the popup's one background image). The cards are near-opaque white panes (night #20202c at 86%) with a blue-tinted lift, and each glyph sits on a small stage-blue tile in white (`--glyph-tile`: #5b86de to #5d5fd8, deep enough that white clears 3:1; night the night stage). A hovered card turns solid, rises a pixel, and its lift deepens. No lilac in the menus. Integrations (marked `[data-menu-tiles]`) lays its cards out as tiles, as many 12.5rem columns as fit: each framework's logo on a white app-icon tile over its name; a family (`FamilyMenuCard`) shows its languages' marks across from the logo and opens the variant popover as wide as the card. Examples leads with a two-row Gallery tile to `/examples` on the stage (`--stage-captioned`: the stage with a deeper foot so white type clears 4.5:1), one glyph on the blue tile, then seven featured demos (`FEATURED_EXAMPLES`: glyph, title, one-line description), each opening that demo in the playground on the reader's framework. Guides (the docs menu) shows Quickstart, Cookbook, and Reference. Discord and X live in the home footer, so the navbar keeps to search, theme, the "Ask CopilotKit" pill (a white pill with the lift and the chat glyph, opening `/ask`), the call to action, and GitHub.
- **Code tabs:** a tab group of code alone (Fumadocs' `CodeBlockTabs` from package-install fences, and an authored `<Tabs>` whose every tab is one code fence) is one white window on the stage, its tabs the window's bar like a code block's title bar, the active block flush under them (`src/components/brand/staged-code.tsx`, `CODE_TABS_WINDOW` in `stage.tsx`). Tabs that mix prose and code keep Fumadocs' card.
- **Callouts:** quiet asides, not cards: Fumadocs' `Callout` with its rule and icon beside the text and no box (`src/components/docs-mdx/basics.tsx`). A titled info callout is an optional detour ("What about other models?"), so it folds to its title and a chevron (a native `<details>`) and opens on a click; warnings, untitled notes, and "Important" always show.
- **TOC:** Fumadocs' own, through `DocsPage`'s `slots.toc.provider` (`src/components/layout/visible-toc.tsx`): the compiled TOC lists every path of a `<TailoredContent>` picker, so after hydration it keeps only the headings on the page and follows the reader's pick. The server render keeps the full static TOC; until hydration, a generated style hides entries whose heading is not on the page, so the first paint already matches.
- **Pickers' popovers:** shadcn's solid `Popover` (not Fumadocs' translucent one), opening to the right of the sidebar.
- **Playground** (`src/proto/examples-playground.tsx`): laid out like a docs page. On the frame, a 268px sidebar of every category as a sidebar section heading (its solid glyph and name in `sidebar-lilac`) over its examples as the docs' sidebar rows (plum-grey, white-60% hover, the current one tinted lilac and scrolled into view). The demo sits in the docs' white page panel (16px radius, hairline, 8px of frame around it): a header with the demo's name, the framework picker, and icon buttons with tooltips (GitHub, reload), over the live demo in an iframe, with the demo skeleton while it wakes. Phones fold the sidebar into a "Browse all examples" card above the panel.
- **Framework picker** (`src/components/framework-picker.tsx`): shadcn's `Combobox`. An outline pill with the chosen framework's logo opens a list of every framework with its logo, a "Search frameworks" field at its top, capped at about eight rows and scrolling past them. The playground's header and Ask CopilotKit's quickstart card share it.

- **Demo frame** (`src/components/demo-frame.tsx`, `<DemoFrame src title label? height?>` in MDX too): a live demo framed the way copilotkit.ai frames its demos. A 20px stage on the blue protocol-map ground (`--stage`) carrying the white pixel matrix, lit under the pointer, around a white app window with a bar (window dots, the demo's name in mono, reload, open in a new tab) over the iframe. The bar shows the demo's name and has open-in-a-new-tab, reload, and a GitHub button to the demo's source. A demo with its code is one window, not tabs around frames: `views` puts a Demo / Code segmented switch (shadcn `Tabs`, a round pill with a glyph per view; on phones the glyphs alone, the labels kept for screen readers) in the middle of the bar, the demo's name beside the window dots; each view loads the first time it's shown and keeps its state after, and a view can be a page (an iframe, like the hosted code viewer) or content (`DemoSource bare`, the brand-themed files, flush to the window). `IframeSwitcher` and `InlineDemo` both render this way. The ported content's `IframeSwitcher` URLs point at the legacy dojo (feature-viewer), which draws its own rounded card inside the frame, so `legacy-demos.ts` maps each one to the showcase's own demo (the shell-dojo legacy-redirect maps) and renders it as an `InlineDemo`: the live cell and its source. A URL the showcase can't serve keeps the legacy frames. The stage itself is `Stage` (`src/components/brand/stage.tsx`). While it loads, the window shows the demo skeleton (`src/components/demo-skeleton.tsx`): shadcn `Skeleton` bars in the outline of the app it's about to show (a chat's replies and question, or lines of code for a code view) on the window's own white, with a mint spinner and "Waking up the demo" in the composer; after 12s the status offers the new tab. No matrix inside the window. Topic pages show their showcase demo in one, on the reader's framework.
- **Ask CopilotKit** (the "Ask AI" chat): Spacious' own chat column (its `aiChat` slot) holding CopilotKit's `CopilotChat` (`src/components/ai`), styled only through CopilotChat's slots, and kept quiet so the conversation is the loudest thing in it. On tablets and desktops (`md` up) it opens from a round plum button with a chat glyph in the page's bottom-right corner (shadcn `Button` and `Tooltip`); phones open it from Spacious' drawer. One white surface with hairlines: a header (the kite in its own colors, "Ask CopilotKit", open full page, new chat, close) and a single composer field with "add an image" (+) and send inside it. Images (up to 3MB each, 4 per chat; the API route budgets them apart from text) can also be dropped on the chat or pasted, through CopilotChat's own attachments. The whole gutter between the page and the chat drags to resize it (a portal over the gutter, since it belongs to neither panel; a lilac line shows on hover; arrow keys when focused; 320px up to 55% of the window); the width is remembered. Spacious sizes the column with its own `--fd-ai-chat-width`, so the handle sets that variable on it. The empty state centers the welcome badge, "How can we help?" in the light display voice (400, 28px), and four suggestions over the composer, which is pinned to the bottom as it is once the chat starts (its "add an image" tooltip is its own 500ms group, so the panel sliding it under the pointer doesn't flash it). The badge is the kite on a white disc in a 128px circle of the protocol-map stage with its white rim and `--lift-stage`, its matrix glistening, lit under the pointer, and sparkling: single squares light and fade in turn (`chat-welcome.module.css`). While the composer has focus, a white ring pulses out from the kite's disc. The suggestions are CopilotKit's own (`useConfigureSuggestions` in `docs-agent.tsx`, before the first message), drawn through CopilotChat's `suggestionView` slot as four white cards in two columns (`ChatSuggestions`): a glyph on the navbar menus' stage-blue tile (`--glyph-tile`), a title, and a muted line (the page it will explain, or what it does); hover rises a pixel with the lilac `border-action` edge and deeper lift, and a click sends it. The welcome has the chat's one entrance: the badge, heading, and composer rise 6px and fade in together (`rise-in`, 320ms ease-out), the kite's disc settling in as they do. The suggestions keep their place with hidden stand-ins until they load, then fade in as one (240ms), so nothing moves when they arrive. On a short screen (760px tall or less) the badge drops to 96px, the cards put their glyph beside their text, and the gaps tighten; if it still doesn't fit, the welcome scrolls from its top rather than clipping the badge. Nothing moves for reduced motion. A sent question pins to the top and its reply fills in under it (`autoScroll="pin-to-send"`), with 16px under the question. A reply's searches, thinking, and the chat's own tools fold into one "Worked for 6s" row (`toolCallDisplay: "turn"`, its tool count hidden by `chat-answer.module.css`); `open_page` and `set_stack` draw through grouped `useRenderTool` renderers, since a frontend tool's own `render` can't join the row. The agent reasons at low effort. Answers have one type scale for any markdown (`chat-answer.module.css`, unlayered so it beats Streamdown's and the prose plugin's styles): 14px body on a 24px line, headings at 18, 16, then 14px (600), slate below h3; lists hang their markers outside with 4px between items; quotes are slate with a hairline, no italics or quote marks. The answer's copy and thumbs are 14px glyphs in 28px buttons in the muted ink with the hover grey, 8px under the answer, and CopilotKit's tooltips take the docs' plum tooltip (theme.css scopes `--primary` on them). Thumbs up and down rate an answer: the chosen thumb stays lilac (`aria-pressed`), clicking it again clears it, and each rating goes with its question to a validated server action (`sendAnswerFeedback` in `src/lib/feedback.ts`) that only logs for now; inline code is the docs' lilac chip; code blocks are Fumadocs' `DynamicCodeBlock` in the brand theme with the language in the bar, on a compact stage. The reader's messages sit in grey-wash bubbles. No disclaimer.
- **Ask CopilotKit, full page** (`/ask`, `src/components/ask`): the same chat (`DocsChat` in `src/components/ai/docs-chat.tsx`, shared with the side chat) on a page under the home's navbar. The navbar's "Ask CopilotKit" pill opens it, and so does the side chat's "Open full page" button, which carries the conversation over (once, through the tab's session storage). Its CopilotKit has the standard catalog (`guideUI` in `guide-ui.tsx`: `standardUI` less media, maps, and pickers; Code drawn as the docs' code block; the `--a2ui-*` variables point at the theme's shadcn variables, so dark mode follows), so answers can carry UI, and a how-to gets a guide: the agent reads the docs, says in a line what it wrote, then writes the guide into the `guide` target (`GenerativeUISurface`, limited to document components, `GUIDE_COMPONENTS`). It is full screen under the navbar, edge to edge on white with no frame around it and no title bar (the navbar names the page; "Guide" and new chat float in the chat's top corner once there's something to act on): until a guide exists, the chat fills it with its conversation in a centered 46rem column, and the welcome adds a lead line under its heading. When the agent starts a guide, the guide takes the left (2fr) and the chat narrows to the right (1fr), where the docs keep it, with a hairline between them; the columns ease over 500ms (none for reduced motion). The guide panel has no title bar under the navbar: its own title heads it, and its controls float in its top-right corner, as the chat's do ("Writing your guide" with a mint spinner while it streams; then the compact Copy prompt pill, download as markdown, and close), lifting off the guide (`shadow-lift`) once it scrolls under them; phones get a "Chat" back button in the top-left corner. The chat's "Guide" button brings a closed guide back. The guide streams in section by section: the agent sends it as several operations in one render_ui call (the head, then one per step), and each section settles in as it mounts (`section-in` in `guide.module.css`: a 10px rise out of a 6px blur, 640ms; sections that land together, as when the agent sends several in one operation, step 80ms apart, set as they mount by `useSectionStagger` in `guide-panel.tsx`; none for reduced motion). Until the first section lands, shadcn skeleton bars hold the guide's outline, and while it writes, a step's outline waits under the last section. The guide reads as a docs page: `guide.module.css` sets the docs' headline, lead, and section headings on the catalog's `data-a2ui-title` hooks, and inline code as the lilac chip. It ends with "Hand it to your coding agent": Copy prompt (the guide as markdown, from `guideToMarkdown`, under a line that tells the agent how to work through it) and Download .md. Phones show one panel at a time: a guide opening switches to it, and its header's back arrow returns to the chat. Answer links to docs pages open in a new tab, so the conversation stays. Its welcome offers "Build your quickstart", "Add generative UI", "Add human approval", and "How AG-UI works". A how-to goes straight to its guide; "Build your quickstart" first asks about the reader's setup in the chat, with a human-in-the-loop card (`useHumanInTheLoop`, `quickstart-setup.tsx`): the frontend as the docs' frontend chips, the agent framework in the framework picker (as the playground's), a new or an existing app, and the features to start with (chips, several at once), the agent's guesses filled in, and the plum "Build my quickstart" pill. The answers switch the docs' stack and go back to the agent, and the card folds to one line of what was chosen.
- **Page feedback:** Fumadocs' own `Feedback` (installed with `npx @fumadocs/cli add feedback`, `src/components/feedback`) at the end of every docs page, sending to a validated server action (`src/lib/feedback.ts`) that only logs for now.
- **Pixel matrix:** the website's square matrix (`src/components/brand/pixel-matrix.tsx`), from its own seeded tile: `public/images/pixel-matrix.png` is the website's `texture.png` with its six strengths rescaled so the strongest square is solid, tiled at 400px so every square is a crisp 4px on an 8px pitch. **One look everywhere**, set in one place: white squares (`--matrix-square`; night: lilac at 40%) at `--matrix-strength` (0.5) in `theme.css`, on the stage ground (`MATRIX_GROUND` in `src/components/brand/stage.tsx`, the blue protocol-map `--stage`). `PixelMatrix` takes no color, strength, or shape; callers only choose `interactive` (lit under the pointer) and `glisten` (two slow lights drifting). Never as text, never behind reading or navigation. It appears in these places only:
  - on the home's protocol-map diagram, lit under the pointer and glistening;
  - on a demo frame's stage and every code block's stage (`Stage`), in the docs and in Ask CopilotKit's answers, lit under the pointer. Command snippets (bash, sh, shell, zsh, console, PowerShell: `isCommandLang` in `stage.tsx`) take the compact stage (`Stage compact`: 6 to 8px of matrix around the window), as do code blocks in Ask CopilotKit's answers;
  - in the home's Guides and Integrations trays, on the protocol-map stage, around the cards;
  - in Ask CopilotKit's welcome badge: a circle of the protocol-map stage with its rim, glistening and sparkling, around the kite on a white disc;
  - around Ask CopilotKit's starters, on a compact stage.

### Icons

Wayfinding glyphs are Phosphor's fill set (`react-icons/pi`), solid marks like the website's, all exported from `src/components/icons/glyphs.tsx`; their row or card sets the color. Controls (search, chevrons, checks, copy, the theme switch) stay on Lucide, matching Fumadocs' own chrome and shadcn's. Intelligence is the kite outline from the live docs. Framework and frontend marks are the official logos in their own colors.

### Logo

The official CopilotKit logotype (`src/components/copilotkit-logo.tsx`), 22px tall in the nav and directly on the frame in the docs sidebar (Fumadocs' `nav.title`), a deliberate call by the docs owner below the brand's 28px web minimum. The wordmark follows `currentColor`; the kite keeps its own colors.

## Do's and Don'ts

### Do:

- **Do** keep everything a reader reads on white (ink in dark mode), and chrome and trays on the frame.
- **Do** set colors as shadcn variables in `src/app/theme.css`; Fumadocs reads them through its shadcn preset.
- **Do** use Fumadocs' components for docs chrome and shadcn/ui for everything else.
- **Do** spend lilac on what the reader acts on and where they are, and mint on live things and Intelligence.
- **Do** check new color pairs: 4.5:1 for text, 3:1 for icons and focus rings, in both themes.
- **Do** keep Spline Sans Mono for code, code-like text, and the Copy prompt pill.

### Don't:

- **Don't** put prose, code, or a card's content on the frame, or the frame inside the docs panel.
- **Don't** use glows, glass (outside the navbar menus), or blur circles, or gradients beyond the stage and the headline accent.
- **Don't** use the pixel matrix behind text, in navigation, or to spell words. Keep it to the places listed under Components.
- **Don't** restyle a Fumadocs component outside the preset surface (shadcn variables, `.prose` variables, inline code, scoped variables on the sidebar and layout, `figure.shiki`).
- **Don't** hand-build a component shadcn ships; install it with `npx shadcn@latest add`.
- **Don't** color card glyphs, or put glyphs in tinted tiles, outside the stage-blue tiles (`GlyphTile`) of the navbar menus and Ask CopilotKit's suggestion cards; only sidebar section headings take the accent, and every section takes the same one.
- **Don't** use lilac-soft as a hover or selected fill.
- **Don't** redraw or recolor the CopilotKit logo, put headings in all caps, or add eyebrow labels above headings.
