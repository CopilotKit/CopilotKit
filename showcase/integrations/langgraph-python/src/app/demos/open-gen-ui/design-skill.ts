// @region[visualization-design-skill]
// Replaces the default shadcn-flavoured design skill with guidance tuned
// for one-off visual reports: a custom, visually rich answer to a specific
// question. Injected as agent context for the `generateSandboxedUi` tool
// (see CopilotKitProvider `openGenerativeUI.designSkill`).
export const REPORT_DESIGN_SKILL = `When generating UI with generateSandboxedUi, produce a one-page visual report that answers the user's specific question. It should look like something a strong analyst would hand to an executive: clear headline, a few well-chosen charts, real detail underneath.

Structure (top to bottom, in this order so it reads well while streaming):
1. Title (the question restated as a noun phrase) and a subtitle with the period, scope, and "Sample data".
2. The headline answer in one sentence, e.g. "EMEA is carrying Q3: 41% of pipeline, and the most deals in Negotiation."
3. A row of 3-4 KPI tiles: label, big number, and a delta or share with direction (▲/▼) colored by meaning.
4. One or two charts that fit the question: stacked or grouped bars for category × stage, a line or area for trends over time, a heatmap grid for cohorts, horizontal bars for ranked breakdowns. Pick the chart that answers the question, not the fanciest one.
5. Detail: a compact table, or 2-4 short example cards (for qualitative data such as support tickets), with the most important rows first.
6. Optionally one line of takeaways or a recommended next step.

Charts:
- Draw with inline SVG using viewBox and width="100%" so they scale with the container. No external scripts or fonts.
- Label axes and values directly where it helps reading; add a legend for every colour-coded series.
- Use a light gridline, tabular numbers, and short tick labels (e.g. "$1.2M", "Jul").
- Make numbers consistent everywhere: KPI tiles, chart values, and table totals must agree.

Layout:
- A single root container, max-width 920px, padding 24px, on a white card (1px #e2e8f0 border, 12px radius).
- Use CSS grid: KPI tiles in a row (wrap to 2 columns under 640px), charts side by side when there are two (stack under 720px).
- It must look right from 360px to 960px wide: no horizontal scrolling, no text overflowing its box. Let tiles shrink; keep KPI deltas on one line with white-space: nowrap.

Palette:
- Text #0f172a, secondary text #64748b, borders and gridlines #e2e8f0, page background #ffffff, subtle panels #f8fafc.
- Series colours, in order: #6366f1 (indigo), #0ea5e9 (sky), #10b981 (emerald), #f59e0b (amber), #ec4899 (pink), #64748b (slate).
- Semantic: positive #059669, negative #dc2626, warning #d97706. Never encode meaning by colour alone; pair it with an arrow, label, or position.

Typography:
- system-ui, -apple-system, "Segoe UI", sans-serif.
- Title 20px / 650, subtitle 13px slate, headline answer 15px / 500, KPI numbers 26px / 650 tabular-nums, labels 12px, table text 13px.

Motion:
- At most a short (300-500ms) ease-out entrance on bars or lines. No looping animation; this is a report, not a toy.

Interactivity:
- Hover titles (<title> in SVG) for exact values are welcome. No fetch, XHR, localStorage, cookies, or remote calls — the sandbox has no network or host access.

Output contract (in order):
- initialHeight first: 640-760 for a full report.
- placeholderMessages: 2-3 short lines describing the build, e.g. ["Sizing the pipeline by region…", "Drawing the stage breakdown…"].
- css: complete and self-contained.
- html: one root container, in the section order above.

Accessibility:
- Text contrast at least 4.5:1. Give each SVG chart a <title> describing what it shows.`;
// @endregion[visualization-design-skill]
