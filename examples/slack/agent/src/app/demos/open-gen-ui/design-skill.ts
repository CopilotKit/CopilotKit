// @region[visualization-design-skill]
// Replaces the default shadcn-flavoured design skill with guidance tuned
// for intricate, educational, self-running visualisations. Injected as
// agent context for the `generateSandboxedUi` tool (see CopilotKitProvider
// `openGenerativeUI.designSkill`).
export const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes. SVG gives you crisp lines, labelled groups, and easy transforms.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.
- For 3D-ish scenes, either use SVG with manual perspective math OR CSS 3D transforms (transform-style: preserve-3d, perspective on the parent). Keep vanishing lines consistent.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. Use animation-timing-function ease-in-out or cubic-bezier; 300-900ms per cycle; loop with animation-iteration-count: infinite where the concept is cyclical (rotations, wave cycles, network pulses).
- When JS timing IS needed, use requestAnimationFrame, not setInterval.
- Stagger related elements with animation-delay so motion reads as layered, not monolithic.

Labels + legend + annotations:
- EVERY axis gets a label (e.g. "Pitch (X)", "Yaw (Y)", "Roll (Z)").
- EVERY colour-coded series gets a legend swatch with a short caption.
- Add short text callouts (e.g. "Input layer", "Hidden layer 1", "Forward pass", "Pivot", "Weight = 0.42") that explain what the viewer is watching. Position with SVG <text> or positioned HTML.
- Include a 1-line title + 1-line subtitle at the top describing the concept.

Palette (use these semantic colours consistently):
- Accent / primary motion: indigo #6366f1
- Success / stable / correct: emerald #10b981
- Warning / attention / active: amber #f59e0b
- Error / destructive / contrast: rose #ef4444
- Neutral axes, gridlines, secondary text: slate #64748b
- Surfaces: white #ffffff; subtle container bg #f8fafc; text #0f172a
- Use ONE accent as the motion/highlight colour per scene; reserve other semantic colours for specific series roles.

Typography:
- system-ui, -apple-system, "Segoe UI", sans-serif.
- Title 16-18px / 600, subtitle 12-13px / 500 slate, axis + legend labels 11-12px, callouts 11-13px.
- Use tabular-nums for any numeric readouts.

Containers:
- Outer card: white background, 1px solid #e2e8f0 border, 10-12px border-radius, 20-24px padding.
- Group related visuals inside the card — do NOT let the scene bleed to the viewport edges.

Motion principles:
- Motion must teach. Every animated element should correspond to a step of the concept (e.g. activation flowing forward through layers, a pivot partitioning an array, a vector rotating about an axis).
- No decorative spinners or jitter for its own sake.

Interactivity:
- This minimal cell has NO host-side sandbox functions — the visualisation is self-running. Do NOT attempt fetch, XHR, localStorage, cookies, or Websandbox.connection.remote calls. The scene must loop or auto-advance on its own.

Output contract (in order):
- Emit initialHeight first (typically 480-560 for these visualisations).
- placeholderMessages: 2-3 short lines like ["Sketching the scene…", "Labelling axes…", "Wiring up the animation…"].
- css: complete and self-contained.
- html: ONE root container with the title + subtitle + SVG/canvas + legend. Include any <script src="https://cdn.jsdelivr.net/…"> tags you need INSIDE the html head/body.

Accessibility:
- Text contrast >= 4.5:1 against its background.
- Do not rely on colour alone to distinguish series — pair colour with shape, dash pattern, or a label.`;
// @endregion[visualization-design-skill]
