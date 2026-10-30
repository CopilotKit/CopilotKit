---
name: A2UI Playground
description: The CopilotKit x A2UI dark workbench where you watch an agent write UI, line by line, and your components draw it.
colors:
  live-violet: "oklch(0.72 0.17 292)"
  violet-ink: "oklch(0.16 0.02 292)"
  link-blue: "oklch(0.79 0.1 232)"
  link-blue-ink: "oklch(0.2 0.03 240)"
  macro-amber: "oklch(0.84 0.12 78)"
  template-green: "oklch(0.8 0.13 165)"
  fault-red: "oklch(0.72 0.17 22)"
  surface-positive: "oklch(0.78 0.15 160)"
  surface-negative: "oklch(0.7 0.18 18)"
  header-black: "#000000"
  page-ground: "oklch(0.135 0.004 285)"
  workbench-ground: "oklch(0.145 0.004 285)"
  well-graphite: "oklch(0.158 0.004 285)"
  card-graphite: "oklch(0.172 0.005 285)"
  panel-graphite: "oklch(0.175 0.005 285)"
  raised-graphite: "oklch(0.215 0.006 285)"
  hairline: "oklch(1 0 0 / 7.5%)"
  hairline-strong: "oklch(1 0 0 / 14%)"
  ink: "oklch(0.97 0.003 285)"
  ink-dim: "oklch(0.66 0.012 285)"
  ink-muted: "oklch(0.68 0.012 285)"
  line-number: "oklch(0.56 0.012 285)"
  ink-faint: "oklch(0.48 0.012 285)"
  generation-line: "#6f6f6f"
  generation-strong: "#a3a3a3"
  generation-field: "rgba(245, 245, 245, 0.15)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  title-small:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  column-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  prompt:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  body-surface:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
  code-line:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.75
  mono-meta:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  control: "9px"
  well: "10px"
  card: "14px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "24px"
  xl: "32px"
components:
  button-build:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page-ground}"
    typography: "{typography.column-title}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-stop:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-quiet:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  prompt-box:
    backgroundColor: "{colors.well-graphite}"
    textColor: "{colors.ink}"
    typography: "{typography.prompt}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  suggestion-row:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  surface-chip-selected:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-meta}"
    rounded: "{rounded.pill}"
    height: "28px"
    padding: "0 10px"
  user-bubble:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 16px"
  column-head:
    backgroundColor: "{colors.workbench-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.column-title}"
    height: "52px"
    padding: "0 20px"
  express-line:
    textColor: "{colors.ink}"
    typography: "{typography.code-line}"
    padding: "0 20px 0 8px"
  link-tag:
    backgroundColor: "{colors.link-blue}"
    textColor: "{colors.link-blue-ink}"
    typography: "{typography.mono-meta}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  surface-card:
    backgroundColor: "{colors.card-graphite}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  surface-well:
    rounded: "{rounded.well}"
  site-header:
    backgroundColor: "{colors.header-black}"
    textColor: "{colors.ink}"
    height: "64px"
  generation-frame:
    backgroundColor: "{colors.workbench-ground}"
    textColor: "{colors.generation-line}"
    typography: "{typography.mono-meta}"
    rounded: "12px"
---

# Design System: A2UI Playground

## Overview

**Creative North Star: "The Glass Workbench"**

A near-black, graphite-and-hairline world where the mechanism is the display. The front door is a conversation with a bench beside it: each prompt with the UI it asked for painting inline under it, and next to the conversation the lines the model wrote for the selected surface, linked both ways. Chrome stays quiet and neutral so that the only colour on screen carries meaning: violet for what is happening now, blue for the line and component you are looking at together, amber and green for the macro and template tags.

Density is that of a developer tool, not a landing page. Text sits at 12.5 to 15.5px, columns are divided by 7.5% white hairlines instead of shadows, and the generated UI is set on a faint dot grid floor so it reads as work in progress on a bench rather than a finished page. Motion is short and functional: lines slide in 3px as they arrive, a block caret blinks where the model is writing, and UI is made in one visual language, the transitions.dev UI generation drawing: a UI that arrives whole is drawn in moving dots and revealed behind a scan line, and a UI that streams stands as the same dotted frames, each component scanning in as it lands.

The workbench sits inside the existing CopilotKit x A2UI site chrome (pure black header, CopilotKit kite and wordmark beside the A2UI mark) and shares the catalog renderers' tokens, so a component drawn in the conversation is the same component the docs and chat show.

**Key Characteristics:**

- Near-black cool-neutral grounds (hue 285, chroma under 0.006) layered by lightness, not by shadow.
- 7.5% white hairlines as the main structural device.
- Geist for everything human, Geist Mono for everything the machine wrote or measured.
- One violet for live state; one blue for the line-to-component link.
- One loader: the dotted transitions.dev drawing, in neutral greys.
- Dot-grid floors under generated UI only.
- A white primary action, never a violet one.

## Colors

A cool graphite ramp with four signal hues, each bound to one meaning.

### Primary

- **Live Violet** (live-violet): what is happening now. The writing caret, the pulsing dot beside a surface still being written, the prompt box focus border and 3px glow, every keyboard focus ring (at 65%), and text selection (at 32%). Inside generated surfaces it is also the catalog accent (links, the first chart series). **Violet Ink** (violet-ink) is the text colour on solid violet.

### Secondary

- **Link Blue** (link-blue): the line and the component it drew, shown together. The 2px outline around the hovered or pinned component in the conversation, the "line n" pill tag on that outline, the inset left bar and number colour of the active Express line, and its 12% wash (18% when pinned). **Link Blue Ink** (link-blue-ink) is the tag's text.

### Tertiary

- **Macro Amber** (macro-amber): the `macro` tag on suggestions and the divider rule inside the line list (its hairlines at 30%).
- **Template Green** (template-green): the `template` tag on suggestions, and fixed-layout keys in JSON.
- **Fault Red** (fault-red): failed runs only. The failed meta text beside a surface, and the error notice (35% border, 8% wash).
- **Surface Positive / Negative** (surface-positive, surface-negative): up and down values inside generated components (deltas, trends). Never chrome.

### Neutral

- **Header Black** (header-black): the site header bar only.
- **Page Ground** (page-ground): the app background and the text on the white Build button.
- **Workbench Ground** (workbench-ground): the workbench columns and the floor under each surface's dot grid.
- **Well Graphite** (well-graphite): sunken inputs: the prompt box, the "Asked:" echo, the JSON gutter.
- **Card Graphite** (card-graphite): the body of every boxed component in a generated surface.
- **Panel Graphite** (panel-graphite): chrome panels: the prompt bubbles, quiet buttons, the stopped notice.
- **Raised Graphite** (raised-graphite): the selected thing in chrome: the selected surface's chip, the active tab, the Stop button.
- **Hairline** (hairline) and **Hairline Strong** (hairline-strong): column dividers, column head rules, card borders; the strong rule for input and control outlines and hover states.
- **Generation Line** (generation-line, #6f6f6f), **Generation Strong** (generation-strong, #a3a3a3) and **Generation Field** (generation-field, the runtime's field colour at half strength): the transitions.dev runtime's own dark values (`--gen-line`, `--gen-strong`, `--gen-ink` in src/styles/motion.css), for everything that draws UI being made: the drawing, and the generation frames' dotted outlines, dot fields and captions. Neutral on purpose, so the loader never competes with Live Violet.
- **Ink** (ink): primary text and the Build button fill. **Ink Dim** (ink-dim): secondary chrome text, unselected suggestions and surface chips, footers. **Ink Muted** (ink-muted): secondary text inside generated surfaces and the `.a2-label` context line. **Line Number** (line-number): Express line numbers. **Ink Faint** (ink-faint): JSON editor gutter numbers.

### Named Rules

**The Live-Only Violet Rule.** In the workbench chrome, violet means "in progress" or "keyboard focus" and nothing else. A static, finished, or merely important thing is never violet; the primary Build action is white.

**The One Link Colour Rule.** Blue appears only on the pair being linked, line and component, at the same moment. It is never used for navigation, buttons, or emphasis.

## Typography

**Display Font:** Geist (via next/font, with ui-sans-serif, system-ui)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace)

**Character:** One grotesque for people, its mono sibling for the machine. Anything the model wrote, anything counted (line numbers, character counts, timings, model and format meta, the "line n" tag, generation frame captions) is Geist Mono; everything addressed to the visitor is Geist.

### Hierarchy

- **Display** (600, 32px, 1.08, -0.025em): the one-line h1 at the top of the conversation ("Watch an agent write UI."). Steps down to 28px under 1280px and 25px on phones.
- **Headline** (600, 24px, tight): level 1 headings inside generated surfaces.
- **Title** (600, 19px): level 2 headings inside surfaces. **Title Small** (600, 15 to 15.5px) for level 3 headings and Section titles.
- **Column Title** (600, 14px): the writes pane title.
- **Prompt** (400, 15.5px, 1.45): the prompt textarea.
- **Body** (400, 14px, 1.55): chrome sentences, capped at 62ch in the conversation. **Body Surface** (400, 13.5px, relaxed) inside generated components; long agent text answers cap at 62ch.
- **Label** (500, 12.5px, sentence case): notes above the lines, and `.a2-label`, the muted context line a Heading or Section carries after its title.
- **Code Line** (Geist Mono 400, 13px, 1.75): Express and JSON lines, with a 2ch hanging indent.
- **Mono Meta** (Geist Mono, 11 to 12.5px): tags, surface chips and their meta, column-head status, line-list footer.

### Named Rules

**The Machine Is Mono Rule.** If the model wrote it or a counter produced it, it is Geist Mono. If it speaks to the visitor, it is Geist.

**The Context After Title Rule.** A heading's context (its eyebrow) sits after the title on the same baseline as a muted, sentence-case `.a2-label` at 12.5px/500, wrapping below only when the line is full. It is never a tracked uppercase kicker above the title.

## Layout

The workbench fills the window under the 64px sticky header, in two columns separated by a single hairline. Left, and wider, the conversation: a compact intro (the h1 and one sentence), then each prompt as a right-aligned bubble with its UI inline under it, and the composer pinned at the bottom. Right, the writes pane for the selected surface: 460px at 1280px and up, 380px from 900px. When the JSON tab is widened the writes pane takes the larger share (1.4fr). The conversation scrolls above its composer; the writes pane scrolls on its own.

The conversation and its composer share one measure: 780px of content, centred, with 32px side padding (24px under 1280px, 16px on phones). A new prompt scrolls its turn to the top and the last turn is at least as tall as the view, so the UI paints below the prompt, in sight. A turn started by a click inside a surface does not take the view. The writes pane opens with a 52px head (title left, mono status right), then the tabs. The Express list pads lines 8px left, 20px right.

Under 900px the conversation is the whole screen: intro, thread, composer. Suggestions wrap to at most two rows at every width, so the composer stays short: the prompts that would start a third row are hidden (two remain on a phone), and the row never scrolls sideways. The writes pane opens over the conversation from the chip on a surface, with a "Chat" button back (Escape also closes it), and "start without AI" opens it on the JSON editor.

Site pages outside the workbench use a 1400px container with 24px side padding (16px under 640px). Generated surfaces lay out by their own container width: grids drop from 4 to 2 columns at 520px, 3 to 2 at 400px, and to 1 at 260px.

**The Floor Rule.** Generated UI stands on a faint radial dot grid (1px dots at 5 to 6% white, 18px pitch under each surface in the conversation, 14 to 16px in docs tiles and stages). Chrome surfaces never carry the grid.

## Elevation & Depth

Depth is tonal. Grounds step up in lightness (page 0.135, workbench 0.145, well 0.158, card 0.172, panel 0.175, raised 0.215) and hairlines do the separating. Shadows are rare and soft, and always paired with a meaning: the card's inner top highlight, the link outline's blue glow, the prompt's violet focus glow.

### Shadow Vocabulary

- **Card bevel** (`box-shadow: inset 0 1px 0 oklch(1 0 0 / 4%), 0 1px 2px oklch(0 0 0 / 30%)`, plus a 2.2% white top gradient fading by 40%): every boxed component in a generated surface.
- **Link glow** (`box-shadow: 0 6px 24px -8px oklch(0.79 0.1 232 / 35%)`): the blue outline around a linked component.
- **Focus glow** (`box-shadow: 0 0 0 3px oklch(0.72 0.17 292 / 16%)`): the prompt box on keyboard focus.
- **Floating composer** (`box-shadow: 0 10px 30px -12px oklch(0 0 0 / 60%)`): the chat input on the chat surfaces.

### Named Rules

**The Hairline Before Shadow Rule.** Separate with a 7.5% hairline or a lightness step first. A shadow is added only when it says something (state, linkage, focus), and never as a hard offset.

## Shapes

Gently rounded, tightening as things get smaller: 14px for cards, the prompt box, notices and the link outline; 10px for wells; 9px for the Build and Stop buttons and suggestion chips; 8px for small quiet buttons and select triggers; 6px for inline code. Pills (fully round) are reserved for things that are tags or toggles: the surface chip, the "line n" tag, sliding tabs, and suggestions when they become a chip row on phones.

Pending components are generation frames: 12px-radius rectangles outlined in round dots, the runtime's own traced line (see Motion), over a 15px dot field. Lines in the Express list are square-edged full-width rows; their active state is an inset 2px left bar, not a rounded pill.

## Motion

One loader language, taken from the transitions.dev UI generation runtime (vendored unmodified in src/vendor/transitions) and matched in CSS from its own numbers (src/styles/motion.css).

- **The drawing** (the runtime itself, src/components/app/use-ui-generation.ts): over a UI whose tree arrives whole, a template run or the first frame of the first-visit replay. A 15px dot field ripples out, guides and corner handles appear, the outline and every part are traced in flowing dots, then the real UI is revealed behind a dotted scan line. 2400ms; the surface is held hidden from its first frame until its content settles (at most 900ms).
- **Generation frame** (a pending component, and the panel that stands in for a surface before anything has drawn): the runtime's traced line as a standing frame. Round dots `--gen-dot` (2.1px) wide and 4.8px apart in Generation Line, flowing along the outline at the runtime's 16px/s; a 15px field of 1.1px dots in Generation Field inside, over Workbench Ground so the floor grid does not show through. It appears as the runtime draws an outline: traced from the top centre down both sides over 770ms on cubic-bezier(0.16, 1, 0.3, 1), its field fading in over 400ms. A pending component's frame carries a 10px Geist Mono caption in Generation Line, top left: the name the model has written so far, small enough to ignore.
- **Scan reveal** (a component that lands while its surface streams, src/components/app/use-landing-reveal.ts): the runtime's reveal phase on that one component. Wiped in from the top behind the scan edge over 756ms, fading in and un-blurring from 3px over 828ms, both on cubic-bezier(0.22, 1, 0.36, 1). Only the outermost component of what lands reveals, so a card that arrives with its children reveals once; nothing reveals after the run is over.
- **Status** is never in the loader. What a run is doing ("Choosing how to answer", "Writing A2UI Express") is the mono meta line beside the surface's chip, with the pulsing violet dot, and plain in the writes pane before its first line. No shimmer text.
- **Reduced motion:** frames stand still, fully drawn; a landing component fades in over 200ms; the runtime fades the whole UI in instead of drawing it.

### Named Rules

**The One Loader Rule.** Only one loader language is ever on screen: the dotted drawing. A UI that arrives whole gets the whole drawing; a UI that streams gets its frames and scan reveals and never the drawing on top of them. No shimmer text, no dashed or violet placeholder boxes, no skeleton pulse in the conversation.

**The Runtime's Numbers Rule.** Anything that imitates the runtime takes its values from ui-generation.js (dot size and gap, flow speed, field pitch, phase durations and curves), named as tokens in motion.css. The vendored runtime itself is never edited.

## Components

### Buttons

- **Shape:** gently rounded (9px); 36px tall.
- **Primary (Build it):** solid Ink fill with Page Ground text, 14px/600, 14px side padding, trailing up-arrow icon. Hover drops to 90% opacity.
- **Stop:** replaces Build while a run goes. Raised Graphite fill, strong hairline border, Ink text, small filled square icon; hover lightens the fill.
- **Quiet (Retry, Ask again, Cancel):** Panel Graphite or transparent with a hairline border, 12 to 13px/500, 8px radius.
- **Focus:** every button shows a 2px Live Violet ring at 65%, offset 2px.

### Chips

- **Suggestion chips:** above the prompt box until the visitor has asked something. Hairline-bordered, 9px radius, Ink Dim at 13px; hover strengthens the border, adds a 2.5% white wash, and lifts the text to Ink. A trailing mono 11px tag reads `macro` (Macro Amber) or `template` (Template Green). They wrap to at most two rows (the prompts that would start a third are hidden and leave the tab order), never scroll sideways, and on phones they are pills.
- **Surface chip:** a 28px pill above each surface in the conversation with a code icon and "Express · n lines" in mono 12px, counting up as the model writes. It selects the surface (the writes pane shows its lines; on a phone it opens them). Selected: Raised Graphite and Ink with a strong hairline, and the surface's floor takes the strong hairline too. Mono meta trails it: the model, `template`, and a status (while the run goes, a pulsing violet dot and its latest step, such as "Writing A2UI Express"; after, "stopped", or "failed" in Fault Red). Before a run has a surface the row carries the status alone, and the chip joins it when the surface arrives.
- **Prompt bubble:** right-aligned, up to 80% of the measure, Panel Graphite with a hairline border, 14px radius, 14.5px text.

### Cards / Containers

- **Corner Style:** 14px.
- **Background:** Card Graphite under a faint top-lit gradient.
- **Shadow Strategy:** the card bevel (see Elevation & Depth).
- **Border:** 1px hairline.
- **Wells inside cards:** 3% white fill, hairline border, 10px radius, for rows, chips and mini panels.

### Inputs / Fields

- **Prompt box:** the composer, pinned under the conversation. Well Graphite, strong hairline border, 14px radius, with the floating composer shadow; the textarea (two rows, growing with its text) sits above a row of the model and format selects and Build or Stop. 15.5px text (16px on phones), Ink Dim placeholder. Hover raises the border to 20% white; keyboard focus turns the border Live Violet with the 3px violet glow. What scrolls behind it fades out over 24px.
- **Select triggers (model, format):** 32px, transparent, strong hairline border, 13px Ink Dim text, 8px radius.

### Navigation

- **Site header:** pure black, 64px, sticky, hairline below. Lockup on the left (CopilotKit kite and wordmark, a light divider, the A2UI mark and 21px/600 "A2UI"), then 15px/500 nav links in Ink Muted that turn Ink on hover and when current. Under 960px the links move into a right-hand drawer (320px, workbench ground, hairline left edge).
- **Column tabs (Express, JSON, Run):** the sliding-pill tabs at 28px tall, on a 4% white track.
- **Phone lines view:** the writes pane over the conversation, entering with a 200ms 10px rise; its head leads with a "Chat" back button and a hairline divider.

### Column Head (signature)

The 52px bar that opens the writes pane: "<model> writes" at 14px/600 ("From a template" when a template drew the surface and its lines are decompiled), and on the right a mono 12px status ("A2UI Express · n lines", the line count alone under 1280px).

### Express Line List (signature)

Numbered lines in Geist Mono 13px/1.75: a 2.25rem right-aligned tabular line-number column, a 0.75rem gap, then the statement with a 2ch hanging indent. Each line arrives with a 220ms 3px rise and fade. A blinking 8x15px violet block caret marks where the model is writing. Lines carrying bulk data clamp to three rows until pinned. Hover or focus activates a line (blue wash, inset 2px blue bar, blue number); click or Enter pins it. A mono footer reports the size against JSON.

### Surface Floor and Link Outline (signature)

Each surface in the conversation stands on a floor: Workbench Ground with an 18px dot grid, a hairline border (strong when selected), 14px radius, 20px padding (14px on phones). Hovering a line draws a 2px Link Blue outline, 14px radius, 4px outside the component it painted in the selected surface, with a "line n" pill tag riding its top edge; the conversation scrolls to it if needed, and the outline follows the component as it moves (140ms). Hovering a component of the selected surface lights its line in return. While nothing has drawn yet, the floor holds one generation frame, at least 132px tall; it stays mounted as the surface arrives, so the first frame replaces it in place. A turn that changed an earlier surface in place says so in one line, with "Show it".

### Generation Frame (signature)

A component still being written is a generation frame: the transitions.dev outline traced in round flowing dots over a faint dot field, captioned with the name the model has written so far. When its component lands, the frame gives way to it and the component scans in from the top, as the runtime reveals a whole UI. The playground's own paint-in (a labelled frame, then the real component) is kept, drawn entirely in the runtime's vocabulary; see Motion.

## Do's and Don'ts

### Do:

- **Do** keep chrome neutral graphite and let colour carry state: violet for live, blue for linked, amber for macro, green for template, red for failure.
- **Do** separate columns and panels with 7.5% white hairlines and lightness steps before reaching for a shadow.
- **Do** set anything the model wrote or a counter produced in Geist Mono, and everything addressed to the visitor in Geist.
- **Do** put a heading's context after its title as a muted, sentence-case `.a2-label` (12.5px/500).
- **Do** stand generated UI on the dot-grid floor, and make it in the one loader language: the drawing for a UI that arrives whole, generation frames and scan reveals for one that streams.
- **Do** give every interactive element the 2px violet focus ring at 65%, offset 2px (inset on Express lines).
- **Do** honour reduced motion: line arrival, caret blink, pulse and outline transitions all switch off; generation frames stand still and landing components fade plainly.

### Don't:

- **Don't** make the primary action violet; Build is white on near-black.
- **Don't** use Link Blue for anything other than the line and component currently paired.
- **Don't** set a heading's context as a tracked uppercase kicker above the title.
- **Don't** put the dot grid behind chrome, text columns or forms.
- **Don't** show a second loader beside the dotted one: no shimmer text, no dashed or violet placeholder box, no drawing over a surface that streams.
- **Don't** add hard offset shadows or heavy drop shadows to cards; depth comes from the graphite ramp.
- **Don't** introduce a second display face; Geist at 600 with tight tracking is the display voice.
