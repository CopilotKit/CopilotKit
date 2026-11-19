---
name: A2UI Playground
description: A calm Solarized research desk where every generated view wipes back to the A2UI that made it.
colors:
  desk-accent: "#1c73ab"
  desk-accent-strong: "#19699b"
  focus: "#268bd2"
  desk-accent-wash: "rgb(38 139 210 / 0.1)"
  paper: "#fdf6e3"
  paper-raised: "#fffaee"
  sand: "#eee8d5"
  sand-raised: "#f6efdc"
  sand-pressed: "#e6dfca"
  rule: "#e3dcc6"
  rule-strong: "#d3cbb3"
  ink-strong: "#073642"
  ink: "#425d65"
  ink-muted: "#4c6770"
  ink-faint: "#93a1a1"
  plate: "#002b36"
  plate-raised: "#073642"
  plate-ink: "#839496"
  plate-ink-strong: "#93a1a1"
  plate-string: "#2aa198"
  plate-name: "#b58900"
  plate-number: "#859900"
  plate-rule: "rgb(147 161 161 / 0.16)"
  signal-ok: "#506d16"
  signal-warn: "#6d6316"
  signal-danger: "#a53031"
  signal-discovery: "#4c5c99"
  mark-1: "#207dbb"
  mark-2: "#248f89"
  mark-3: "#6c71c4"
  mark-4: "#d33682"
  mark-5: "#718808"
  mark-7: "#cb4b16"
  tone-blue: "#207dbb"
  tone-cyan: "#248f89"
  tone-violet: "#5c66af"
  tone-magenta: "#b33477"
  tone-green: "#718808"
  tone-yellow: "#9a7b08"
  tone-orange: "#ad461b"
  tone-red: "#bb3130"
  tone-neutral: "#566f77"
  solid-yellow: "#766813"
  solid-green: "#567213"
  solid-orange: "#ad461b"
  solid-red: "#bb3130"
  solid-violet: "#5c66af"
  wash-blue: "rgb(38 139 210 / 0.12)"
  wash-yellow: "rgb(181 137 0 / 0.14)"
  wash-orange: "rgb(203 75 22 / 0.12)"
  wash-green: "rgb(133 153 0 / 0.14)"
  wash-red: "rgb(220 50 47 / 0.12)"
  wash-violet: "rgb(108 113 196 / 0.12)"
  wash-magenta: "rgb(211 54 130 / 0.14)"
  wash-blue-soft: "rgb(38 139 210 / 0.07)"
  wash-yellow-soft: "rgb(181 137 0 / 0.08)"
  wash-orange-soft: "rgb(203 75 22 / 0.07)"
  wash-green-soft: "rgb(133 153 0 / 0.08)"
  wash-red-soft: "rgb(220 50 47 / 0.07)"
  wash-violet-soft: "rgb(108 113 196 / 0.07)"
  edge-blue: "rgb(38 139 210 / 0.35)"
  edge-yellow: "rgb(181 137 0 / 0.35)"
  edge-orange: "rgb(203 75 22 / 0.35)"
  edge-green: "rgb(133 153 0 / 0.4)"
  edge-red: "rgb(220 50 47 / 0.35)"
  edge-violet: "rgb(108 113 196 / 0.35)"
  scrim: "rgb(0 43 54 / 0.6)"
  scrim-light: "rgb(0 43 54 / 0.32)"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5625rem"
    fontWeight: 620
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 620
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 560
    lineHeight: 1.6
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.02em"
  caption:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "Atkinson Hyperlegible Mono Variable, Atkinson Hyperlegible Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: '"tnum"'
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "99px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-6: "24px"
components:
  button-send:
    backgroundColor: "{colors.desk-accent}"
    textColor: "{colors.paper}"
  button-send-hover:
    backgroundColor: "{colors.desk-accent-strong}"
  button-send-disabled:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink-muted}"
  button-new-question:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-new-question-hover:
    backgroundColor: "{colors.paper-raised}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    size: "2.25rem"
  button-icon-hover:
    backgroundColor: "{colors.sand-pressed}"
    textColor: "{colors.ink-strong}"
  model-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    height: "2.125rem"
    padding: "0 12px"
  model-pill-hover:
    backgroundColor: "{colors.sand-raised}"
  menu:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "4px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  menu-item-hover:
    backgroundColor: "{colors.sand}"
  drawer:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    width: "17rem"
  thread-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  thread-row-hover:
    backgroundColor: "{colors.sand-pressed}"
  thread-row-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-strong}"
  chip-source:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  chip-source-hover:
    backgroundColor: "{colors.sand-pressed}"
    textColor: "{colors.ink-strong}"
  badge-count:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  surface-frame:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "16px"
  source-plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.code}"
    padding: "12px 16px 24px"
  a2ui-grip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.pill}"
    height: "1.625rem"
    padding: "0 8px 0 7px"
  a2ui-grip-revealed:
    backgroundColor: "{colors.desk-accent}"
    textColor: "{colors.paper}"
  note-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "12px"
  status-toast:
    backgroundColor: "{colors.ink-strong}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "8px 8px 8px 16px"
---

# Design System: A2UI Playground

## Overview

**Creative North Star: "The Acetate Overlay"**

A2UI Playground is a reading room lit in Solarized light. Base3 paper is the stage where answers are read, base2 sand is the drawer where questions are kept, and base03 is held back for one thing: the source. The North Star is an acetate overlay. Every generated view is a sheet laid over the A2UI that produced it, and the divider between the two is the system's single dramatic gesture. Everything else stays quiet so that gesture reads.

Density is comfortable rather than compact: a 16px body at 1.6 leading, a 48rem reading column, prose held to 62ch, hairlines instead of boxes. Chrome recedes into small type and ink tones, and the only saturated interface color is Solarized blue, deepened until it carries text. The other seven Solarized accents are kept for meaning (data series, signals, the subject of a thread) and never for decoration. Prose leads; a generated view appears only when it carries the answer, so the stream never becomes a stack of cards.

Light and dark are one material in two states, not two themes. The rendered view is light, its source is dark, and the brand mark is the same disc split by the same blue line. Generated components wear the app's tokens through a theme in which every value is a `var()` reference, so a chart, table or form written by the agent shares its palette and type with the drawer around it.

**Key Characteristics:**

- Cream paper (#fdf6e3) stage and sand (#eee8d5) drawer; the dark grounds are reserved for the source plate and brief inversions.
- One interface accent: Solarized blue, deepened to #1c73ab for text and fills, canonical #268bd2 only for focus, the divider and progress lines.
- Atkinson Hyperlegible Next for everything read, Atkinson Hyperlegible Mono for everything that is the interface describing itself.
- Hairline rings and base02-tinted soft shadows; nothing hard, nothing black.
- Exponential ease-out motion that fades and rises in, with a reduced-motion path that keeps only opacity.

## Colors

Solarized's sixteen colors are the source of every value; any hue that carries text is pulled toward base03 until it clears WCAG AA on cream.

### Primary

- **Desk Blue** (desk-accent): the app's one interface accent. Links, the text caret, the composer's send button, the revealed A2UI grip, menu checkmarks, research-step glyphs, and the accent and info-solid roles of generated components. Paper text on it holds 4.8:1.
- **Desk Blue, Pressed** (desk-accent-strong): hover state of every blue fill, and blue text set on sand (the "Show older" link, the grip's hover label, generated info text).
- **Solarized Blue** (focus): the canonical hue, for non-text marks only: the 2px focus outline, the wipe divider, the streaming sweep across a surface's top edge, the brand mark's split, CopilotKit's ring.
- **Blue Wash** (desk-accent-wash): the chart cursor in generated views and the reduced-motion stand-in for the streaming sweep.

### Secondary

The data hues. Each family exists so that a hue can carry meaning on cream at the right strength.

- **Chart Marks** (mark-1 to mark-5, then mark-7): series colors for generated charts, in that order: blue, cyan, violet, magenta, green, orange. Canonical hues with the light ones nudged past 3:1.
- **Subject Tones** (tone-blue through tone-neutral): the color a thread's icon is drawn in, chosen by subject (globe and plane blue, thermometer orange, leaf green, flask and atom violet, coins and landmark yellow, buildings and the fallback compass neutral). A glance down the thread list reads as subject matter.
- **Signals** (signal-ok, signal-warn, signal-danger, signal-discovery): text-strength status colors. A finished research step's check, "search unavailable", a surface that failed to render, and the matching text roles in generated components.
- **Solids** (solid-yellow, solid-green, solid-orange, solid-red, solid-violet): filled status badges and buttons in generated views, all AA under paper text.
- **Washes and Edges** (wash-_, wash-_-soft, edge-\*): the accents as tints and 35-40% borders for callouts, badges and highlights in generated views.
- **Live Dot** (Solarized cyan, the plate-string value): the 7px dot in the model pill with a 3px cyan halo, the one non-blue mark in the chrome, meaning "this model answers".

### Tertiary

- **Source Plate** (plate, base03): the ground of the A2UI source under a generated view. Its raised step (plate-raised, base02) is the Copy button's hover.
- **Plate Ink** (plate-ink, base0) for punctuation and code; **Plate Ink Strong** (plate-ink-strong, base1) for JSON keys and the plate's top bar.
- **Syntax** (plate-string cyan, plate-name yellow and bold for component names, plate-number green for numbers and literals): each clears 4.7:1 on base03.
- **Plate Rule** (plate-rule): hairlines inside the plate.

### Neutral

- **Paper** (paper, base3): the stage, the surface frame, notes, the active thread, the model menu. The cream ground is a confirmed requirement, not a default.
- **Paper Raised** (paper-raised): the composer, popovers, generated panels and controls, the New question button's hover. The lightest value in the system; there is no pure white.
- **Sand** (sand, base2): the drawer, user turns in the chat, source chips, the research-step disc, slider tracks, menu-item hover, the disabled send button.
- **Sand Raised** and **Sand Pressed**: one step up (model pill hover, secondary generated surfaces, shimmer) and one step down (hover on sand: thread rows, icon buttons, chips).
- **Rule** (rule) for hairline dividers and containment rings; **Rule Strong** (rule-strong) for control borders, table header rules and the scrollbar thumb.
- **Ink Strong** (ink-strong, base02): titles, active labels, bold text, and the fill of inverted surfaces (status toast, generated inverted surface).
- **Ink** (ink): body text, 6.5:1 on paper and 5.7:1 on sand.
- **Ink Muted** (ink-muted): secondary text, placeholders, model notes, the research query, icon buttons at rest.
- **Ink Faint** (ink-faint, base1): decoration and disabled marks only: list bullets, hover borders, the dashed ring of a pending thread icon.
- **Scrim** (scrim, scrim-light): base03 veils for generated modals and for the mobile drawer.

### Named Rules

**The One Blue Rule.** Solarized blue is the only accent on interactive chrome: fills, links, carets, selection, focus. Other hues enter the chrome only as meaning: a thread's subject icon, the live-model dot, a signal.

**The Deepened Text Rule.** A Solarized hue that carries text is pulled toward base03 until it clears 4.5:1 on its ground: ink #425d65 instead of base00, desk blue #1c73ab instead of #268bd2. Canonical values are for grounds, rules, focus marks and chart marks.

**The Dark Is Source Rule.** Base03 and base02 as fills belong to the source plate, the brand mark's dark half and brief inversions (the status toast, a generated inverted surface). The rendered world is light.

## Typography

**Display Font:** Atkinson Hyperlegible Next Variable (with ui-sans-serif, system-ui)
**Body Font:** Atkinson Hyperlegible Next Variable (with ui-sans-serif, system-ui)
**Label/Mono Font:** Atkinson Hyperlegible Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** One legibility-first superfamily, read on a projector across a room. Distinct glyphs and slashed zeros make figures and source unambiguous, and the variable axis lets weight steps of 20 to 90 units do the hierarchy work that size jumps would do elsewhere.

### Hierarchy

- **Display** (620, 25px, 1.6, -0.01em): the welcome question only, centered over the composer.
- **Title** (620, 16px, 1.3 when it wraps): the stage header's thread title in ink-strong; note titles use the same weight at 14px. The wordmark is the one 650 at 16px with -0.005em.
- **Body** (400, 16px, 1.6): chat prose, capped at 62ch; the welcome lede at 52ch in ink-muted.
- **Body Small** (400, 14px, 1.5): the drawer, research steps, notes, the model menu.
- **Control** (560, 14px): the voice of buttons and toggles: New question, the model pill, Notes, the status toast. Toast actions step to 650.
- **Label** (600, 12px, 0.02em, sentence case): drawer group labels ("Today"), the notes count.
- **Caption** (400, 12px, 1.5): source chips, model notes, the source link in a note.
- **Code** (Mono 400, 12px, 1.65, tabular): the source plate and its bar; the A2UI grip at 600.

### Named Rules

**The Weight-Not-Size Rule.** The chrome uses four sizes (12, 14, 16, 25px) and separates everything else with weight (400, 560, 600, 620, 650) and ink (strong, base, muted). Twenty-five pixels appears once, on the welcome question.

**The Mono Means Mechanism Rule.** Atkinson Hyperlegible Mono marks the interface describing itself: the A2UI plate, its bar, the grip, code in chat. Prose and interface labels never wear it.

**The Tabular Figures Rule.** Tables, the source plate and counts set `font-variant-numeric: tabular-nums`, so columns of figures align.

## Layout

A two-column grid fills the viewport (100dvh): a 17rem sand drawer and a fluid paper stage, split by a 1px rule. The drawer can be closed; wide screens remember the choice. The stage header is at least 3.5rem tall with a hairline under it: the thread's icon and title on the left, the model pill on the right. The chat runs in a 48rem column; prose inside it stops at 62ch, while generated surfaces take the full column. The welcome state centers its heading, lede, composer and starter pills in that column, vertically and horizontally.

Spacing sits on a 4px base and uses five steps: 4, 8, 12, 16 and 24px. Eight and twelve dominate; the standard inner padding of a row, button or chip is 8px by 12px. A generated surface sits 24px below the prose before it and 8px above what follows, and pads its content 16px.

At 760px and below the grid collapses to one column. The drawer becomes an overlay (min(84vw, 20rem)) over a light scrim, sliding in 12px; the stage title wraps to two lines at 1.3; the model pill drops the "Gemini" family word; a generated surface adds 32px above its content so the parked A2UI grip never covers it; the jump-to-latest button is hidden because touch scrolls on its own; the status toast moves under the header, out of the growing composer's reach. Under `pointer: coarse` every hit target grows to 2.75rem, and under `hover: none` the archive button stays visible.

## Elevation & Depth

The system is tonal first. Sand sits below paper, paper-raised sits above it, and containment is a 1px ring (`box-shadow: 0 0 0 1px` rule) on cards and the active thread, or a 1px rule-strong border on controls. Shadows are soft, base02-tinted (rgb 7 54 66) and use negative spread so they pool under an object rather than haloing it.

### Shadow Vocabulary

- **Ring** (`box-shadow: 0 0 0 1px var(--rule)`): containment of the surface frame, notes and the active thread row.
- **Hairline** (shadow-hairline): the faintest lift. Every shadow level inside generated components maps to it, and the jump-to-latest button uses it.
- **Float** (shadow-float): only for things that hover above the reading: the model menu, the status toast, the mobile drawer.

### Named Rules

**The Two Heights Rule.** At rest an object gets a ring or a hairline at most; only menus, toasts and overlay drawers get the float shadow. Generated components never rise above hairline.

**The Tinted Shadow Rule.** App shadows are base02 at 4-28% alpha, never black, so depth stays inside the Solarized world.

## Shapes

Soft corners in three steps. Six pixels for small interactive things: icon buttons, thread rows, menu items, the Copy button, and generated small and medium radii. Ten pixels for cards and the New question button (generated large). Fourteen pixels for the generated surface frame and the model menu (generated extra large); the source plate inherits the frame's corner so the two read as one sheet. Pills (99px) are for things that are a single piece of state: the model pill, the A2UI grip, source chips, the notes count, the status toast and its action. Circles carry status: the research-step disc, the live-model dot, the brand disc, the dashed ring of a pending thread icon.

Lines are 1px hairlines everywhere except two 2px blues: the wipe divider and the focus outline. Icons are Lucide outlines at 1.75 stroke (2 to 2.25 when smaller than 14px), sized 13 to 17px.

**The Frame Is the Card Rule.** A generated surface's frame is already the card. A top-level Card inside it sheds its border, fill, padding and shadow rather than nesting a card in a card.

## Components

### Buttons

Quiet until touched; blue only when it commits.

- **Shape:** gently rounded (10px) for the New question action, 6px for icon buttons, pill for the model picker.
- **Primary:** the composer's send button. Desk Blue fill with a paper arrow; hover deepens to Desk Blue Pressed; disabled turns to sand with an ink-muted arrow at full opacity rather than fading.
- **Secondary:** New question. Paper on sand, a 1px rule-strong border, ink-strong control text, 8px by 12px. Hover lifts the fill to paper-raised and darkens the border to ink-faint.
- **Icon / Ghost:** 36px square (44px on coarse pointers), transparent, ink-muted glyph; hover fills sand-pressed and inks the glyph strong. Transitions run 140ms on ease-out.
- **Text:** "Show older" is Desk Blue Pressed text with no chrome.
- **Focus:** a 2px Solarized blue outline, offset 2px, on everything; menu items inset it (-2px).

### Chips

- **Style:** source chips under a research step are sand pills with 12px ink text, 1px by 8px (8px by 12px on touch); hover moves to sand-pressed and ink-strong. The notes count is a paper pill on sand in the label style. Starter suggestions are CopilotKit's pills re-skinned through the token remap.
- **State:** chips are links or counts, not toggles; there is no selected state.

### Cards / Containers

- **Corner Style:** 14px for the surface frame and menus, 10px for notes.
- **Background:** paper on the stage; paper on sand for notes.
- **Shadow Strategy:** ring plus hairline at rest; float only for the model menu (see Elevation & Depth).
- **Border:** the 1px rule ring for cards, 1px rule-strong for the menu.
- **Internal Padding:** 16px in a surface frame, 12px in a note, 4px around menu items.

### Inputs / Fields

- **Style:** the composer belongs to CopilotKit (its 28px corner and shadow come from the framework) and is re-skinned under `:root [data-copilotkit]`: paper-raised fill, rule-strong input border, ink-muted placeholder, Desk Blue caret, Solarized blue ring. Generated controls use paper-raised fills, rule-strong borders and sand slider tracks.
- **Focus:** the Solarized blue ring or 2px outline; no glow.
- **Error / Disabled:** errors speak in signal-danger text; disabled controls drop to sand and ink-muted.

### Navigation

- **Drawer:** sand, 17rem, 14px text. The head holds the brand mark (22px) and wordmark, then the collapse button; below it New question, then threads grouped by date under sentence-case labels. A thread row is its subject icon (16px, in its tone) and an ellipsized name; hover fills sand-pressed and reveals an archive button while the name fades out under a mask; the active row is a paper tab with a ring and ink-strong text. The Notes shelf sits at the bottom behind a hairline and opens into note cards.
- **Header:** the active thread's icon (17px) and title in the title style, the model pill at the right.
- **Model pill:** a 34px paper pill with a rule-strong border, the live cyan dot, the model name and a chevron. It opens a 15rem paper menu from the top right (scale 0.97 to 1, 240ms) with two-line items: a 600 label and a muted caption, the current one marked by a blue check.
- **Mobile:** the drawer opens over the stage with a scrim and closes after a choice or on Escape; focus moves into it and back to the toggle.

### Wipe Surface (signature)

The rendered view and its A2UI occupy one frame. The source plate sits underneath the full frame and is clipped from the left to the share still rendered; its code is translated so it always begins at the divider, so every position of the wipe shows source.

- **Divider:** a 2px Solarized blue line, shown on hover, while dragging, and whenever the plate is revealed.
- **Grip:** a 26px mono pill with a braces glyph and "A2UI". At rest it is paper with a rule-strong border, parked at the frame's top right; on hover its border and label turn blue; once revealed it fills Desk Blue with paper text. It rides the divider but never leaves the frame.
- **Plate:** base03 with a top bar reading "A2UI v1.0 · n operations · n components" and a Copy button; keys in base1, strings cyan, component names bold yellow, numbers green.
- **Behavior:** a click toggles fully open or closed; a drag past 4px moves the divider and snaps within 6% of either edge; the keyboard drives it as a slider (arrows step 10, Shift steps 25, Home and End jump). The glide is 520ms on ease-out and turns off while dragging and under reduced motion.
- **Streaming:** while the agent writes, a 2px blue sweep crosses the top edge every 1.4s and each component fades in over 420ms.

### Research Step

One quiet line per research call: a 20px sand disc holding a blue search glyph that breathes while running and becomes a signal-ok check when done, a 600 "Researching" or "Researched", the query in ink-muted, and up to five source chips beneath.

### Status Toast

A base02 pill with paper control text and the float shadow, centered over the chat and rising in 4px. An action (Undo) sits inside as a translucent paper pill at 650, and Cmd or Ctrl+Z runs it while the toast is visible.

## Do's and Don'ts

### Do:

- **Do** set new surfaces on paper (#fdf6e3) or sand (#eee8d5), and text on ink-strong, ink or ink-muted.
- **Do** style generated UI through the theme, with every value a `var(--token)` reference to tokens.css, never a literal.
- **Do** use Desk Blue (#1c73ab) for blue text and fills, and canonical Solarized blue (#268bd2) only for focus outlines, the wipe divider and progress lines.
- **Do** draw chart series from the marks in order (mark-1 through mark-5, then mark-7) and icon colors from the tones.
- **Do** contain cards with the 1px rule ring and keep shadows base02-tinted; reserve the float shadow for menus, toasts and overlay drawers.
- **Do** use Atkinson Hyperlegible Mono with tabular figures for anything that shows the interface's own data.
- **Do** move things with the exponential ease-out at 140, 240 or 520ms, and give every animation a reduced-motion path that keeps opacity only.
- **Do** grow every hit target to 2.75rem under `pointer: coarse`.

### Don't:

- **Don't** render an answer as a stack of cards; prose leads, and a generated view appears only when it carries the answer.
- **Don't** nest a card inside a generated surface frame; a top-level Card sheds its border, fill and padding.
- **Don't** build a dark panel, sidebar or card into the rendered world; base03 and base02 fills belong to the source plate and brief inversions.
- **Don't** set text in ink-faint (#93a1a1) or in stock Solarized base00 or base0 on cream; they fall below AA.
- **Don't** introduce a second interface accent; cyan, violet, magenta and the rest appear only as data, signals, the live-model dot and thread subjects.
- **Don't** use pure black or pure white for grounds, text or shadows; the extremes are base03 and #fffaee.
- **Don't** add type sizes to the chrome between 12, 14, 16 and 25px; separate with weight and ink instead.
