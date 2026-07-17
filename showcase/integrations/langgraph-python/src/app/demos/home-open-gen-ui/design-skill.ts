/**
 * Experimental-design design skill for Open Generative UI.
 *
 * Same instructions shape as the canonical
 * `open-gen-ui/design-skill.ts`, but swaps the palette + typography to
 * the "lavender glass" experimental design so the agent-generated
 * sandboxed HTML lands visually consistent with the rest of the
 * homepage dojo.
 */

// @region[experimental-design-skill]
export const EXPERIMENTAL_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation in the "lavender glass" experimental design language used across the CopilotKit website's homepage dojo. Treat the output like a figure from a well-designed textbook — but rendered in our brand voice.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes.
- Fit content within a ~600x400 content area with ~20-28px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.
- For 3D-ish scenes, use SVG with manual perspective math or CSS 3D transforms with a clear vanishing-point.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. ease-in-out or cubic-bezier; 300-900ms per cycle; loop with animation-iteration-count: infinite where the concept is cyclical.
- When JS timing IS needed, use requestAnimationFrame.
- Stagger related elements with animation-delay so motion reads as layered, not monolithic.

Labels + legend + annotations:
- EVERY axis gets a label.
- EVERY colour-coded series gets a legend swatch with a short caption.
- Add short text callouts that explain what the viewer is watching.
- Include a 1-line title + 1-line subtitle at the top.

Palette (USE THESE EXACT COLOURS — DO NOT improvise):
- Accent / primary / brand: #6E6BFF (rich purple)
- Sister hues for additional series, in this order: #A78BFA (lavender), #87EAD1 (mint), #F4A3FF (pink), #FFC785 (amber), #83FF6E (lime-mint)
- Surfaces: white #ffffff; lavender container background #f1ecff; subtle elevated white rgba(255,255,255,0.62)
- Borders / hairlines / axes / gridlines: rgba(17, 9, 30, 0.12)
- Foreground text: #11091e (near-black with a hint of purple)
- Muted text: #5d5870 (slate-purple)
- Eyebrow / micro-label: #3f3cc4 (deep purple) on rgba(110,107,255,0.1) (purple-soft) background
- Use ONE accent (#6E6BFF) as the motion/highlight colour per scene; reserve sister hues for distinct series roles.

Typography:
- Sans for prose, labels, titles: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif.
- Mono for numbers, stats, eyebrows, axis ticks, percentage readouts: "JetBrains Mono", ui-monospace, monospace.
- Title 16-18px / 600 with -0.02em letter-spacing.
- Eyebrow 10-11px / 500 uppercase with 0.08em letter-spacing, in JetBrains Mono.
- Body 13-14px / 400 in Plus Jakarta Sans.
- Stat / numeric readouts always tabular-nums, JetBrains Mono.

Corner radius (CRITICAL — experimental design uses HARD corners):
- Outer card: 4px (NOT 8, 10, or 12 — keep it tight and pro).
- Inner elements: 3px.
- The only pill-shaped (border-radius: 999px) element is a "chip" / status tag.

Containers:
- Outer card: white #ffffff background, 1px solid rgba(17, 9, 30, 0.1) border, 4px border-radius, 20-24px padding, box-shadow: 0 1px 2px rgba(17, 9, 30, 0.04), 0 8px 24px rgba(17, 9, 30, 0.06).
- Group related visuals inside the card — do NOT let the scene bleed to the viewport edges.
- The scene background (outside the card) should be the lavender #f1ecff so the card visibly floats above it.

Motion principles:
- Motion must teach. Every animated element should correspond to a step of the concept.
- No decorative spinners or jitter for its own sake.

Interactivity:
- This minimal cell has NO host-side sandbox functions — the visualisation is self-running. Do NOT attempt fetch, XHR, localStorage, cookies, or Websandbox.connection.remote calls. The scene must loop or auto-advance.

Output contract (in order):
- Emit initialHeight first (typically 480-560).
- placeholderMessages: 2-3 short lines like ["Sketching the scene…", "Labelling axes…", "Wiring up the animation…"].
- css: complete and self-contained. Import the fonts at the top: @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap");
- html: ONE root container with the title + subtitle + SVG/canvas + legend.

Accessibility:
- Text contrast >= 4.5:1 against its background.
- Do not rely on colour alone to distinguish series — pair colour with shape, dash pattern, or a label.`;
// @endregion[experimental-design-skill]
