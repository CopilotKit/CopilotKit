/**
 * The Get started prompt: one block a visitor pastes into a coding agent (Claude Code, Cursor, Gemini CLI,
 * Codex) to add A2UI to their own app, written for the design system they picked. It carries the same code
 * the site runs (`./snippets.ts`), so the agent copies working setup instead of guessing an API.
 */
import type { DesignSystemId } from "@/design-systems/registry";
import { DOCS_URL } from "./links";
import { INSTALL, PROVIDER, ROUTE } from "./snippets";

/** The two lines it comes down to, by hand: the install, and the provider with the catalog as `ui`. */
export const PROVIDER_LINE = `<CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui }}>`;

/** What `ui` is for each design system. */
export const UI_NOTE: Record<DesignSystemId, string> = {
  copilotkit:
    "ui is standardUI, CopilotKit's standard catalog: 69 components for layout, text, inputs, tables, charts and maps.",
  chatcn:
    "ui is the standard catalog with its Button, Badge and Divider drawn by your shadcn/ui components and the rest themed with your shadcn tokens. The prompt writes it.",
  material:
    "ui is the standard catalog with its Button and Divider drawn by Material 3 components and the rest themed with Material's color roles. The prompt writes it.",
  byoc: "ui is your own components, each with a Zod schema and a one-line description of when to use it. The prompt writes it.",
};

/** Where `createGenerativeUI` and `standardUI` come from (not the `@copilotkit/react-core/v2` root). */
const GENUI_FILE = `Create app/genui.tsx, starting with \`"use client";\` and \`import { createGenerativeUI, standardUI } from "@copilotkit/react-core/v2/generative-ui";\``;

/** What a component that replaces a standard Button must keep, so a click still does what the model meant. */
const BUTTON_CONTRACT = `A replacement Button takes the standard Button's props (read every component's schema with \`exportA2UICatalog(standardUI)\`): it shows \`children\`, \`child\` or \`label\` and its \`icon\`; it is a submit button when \`submit\` is set, so a Form still sends; it is disabled while \`disabled\`, \`loading\` or a check in \`checks\` fails with severity "error"; and on click it opens \`href\` (http, https or mailto only), else copies \`copy\`, else calls \`onClick({})\`, which is how the click reaches the agent. Spread \`useGenerativeUIAccessibility()\` from the same import path on its root element.`;

const CATALOG_STEP: Record<DesignSystemId, string> = {
  copilotkit: `Create app/genui.tsx: \`"use client";\` then \`export { standardUI as ui } from "@copilotkit/react-core/v2/generative-ui";\`. That is CopilotKit's standard catalog (69 components: Column, Row, Card, Text, Button, TextField, Table, Chart, Map and more). To match this app's look, pass a \`theme\` with the \`--a2ui-*\` CSS variables next to \`ui\` in \`generativeUI\`.`,
  chatcn: `This app should use shadcn/ui (run \`npx shadcn@latest init\` if it does not). Add the primitives the surfaces need: \`npx shadcn@latest add badge button separator\`. ChatCN's chat components install from its shadcn registry the same way, if you also want them for the chat itself. ${GENUI_FILE}, then:
\`export const ui = createGenerativeUI({ id: "<app-name>/genui@1", extends: [standardUI], overrides: { Button: { component: ShadcnButton }, Badge: { component: ShadcnBadge }, Divider: { component: ShadcnSeparator } }, components: {} });\`
Each override is a small wrapper around the shadcn component that takes the props of the standard component it replaces. Badge gets \`label\`, \`variant\` and \`color\`. ${BUTTON_CONTRACT} Override leaves like these, not containers: Card and the layout components keep their implementation and match shadcn through \`theme\` (map your shadcn tokens onto the \`--a2ui-*\` variables), so a surface's inputs keep their state.`,
  material: `This app should use a Material 3 React component library. If it already has one, use it; if not, install \`@language-lit/material3-expressive\` (the Material 3 Expressive components this playground draws with), import its \`styles.css\` once, after the app's global CSS (if it comes first, Tailwind's preflight outranks it and flattens its buttons), load Roboto Flex, and set \`--m3e-ref-typeface-plain\` and \`--m3e-ref-typeface-brand\` to it. ${GENUI_FILE}, then:
\`export const ui = createGenerativeUI({ id: "<app-name>/genui@1", extends: [standardUI], overrides: { Button: { component: MaterialButton }, Divider: { component: MaterialDivider } }, components: {} });\`
Each override is a small wrapper around the library's component that takes the props of the standard component it replaces. Map the standard Button's \`variant\` onto Material's emphasis: primary and solid to filled, soft to tonal, borderless and ghost to text, anything else to outlined. ${BUTTON_CONTRACT} Override leaves like these, not containers: Card and the layout components keep their implementation and match Material through \`theme\` (map Material's color roles, such as primary, surface-container and outline-variant, onto the \`--a2ui-*\` variables, with its 12, 16 and 28px corners), so a surface's inputs keep their state.`,
  byoc: `Find this project's own reusable React components that an agent should be able to compose: stat tiles, tables, charts, forms, domain cards. For each one, write a Zod schema of its props and a one-line description of when to use it. ${GENUI_FILE}, then:
\`export const ui = createGenerativeUI({ id: "<app-name>/genui@1", extends: [standardUI], components: { StatTile: { component: StatTile, props: statTileProps, description: "One metric with its change." } } });\`
Keep \`extends: [standardUI]\` so the agent can lay your components out with Column, Row and Grid. Where one of yours replaces a standard component (your Button or Badge), register it under \`overrides\` with the standard name instead of adding it to \`components\`; a name may appear in only one place. ${BUTTON_CONTRACT} Give the standard components your look with \`theme\` (the \`--a2ui-*\` variables).`,
};

/** How the prompt's first line names what draws the UI. */
const DRAWN_WITH: Record<DesignSystemId, string> = {
  copilotkit: "built from CopilotKit's standard catalog",
  chatcn: "drawn with shadcn/ui components",
  material: "drawn with Material 3 components",
  byoc: "built from this app's own components",
};

export function buildPrompt(ds: DesignSystemId, origin: string): string {
  return `Add generative UI to this app with A2UI 1.0 and CopilotKit, so my agent answers with interactive UI ${DRAWN_WITH[ds]}.

The agent writes A2UI (a JSON description of components and data), and CopilotKit renders it with the components registered in a catalog. Do the following, then show me what you changed.

1. Install with this project's package manager: \`${INSTALL.replace(/^npm i /, "")}\`.

2. ${CATALOG_STEP[ds]}

3. Add the runtime route. In Next.js it is app/api/copilotkit/[[...slug]]/route.ts; in another framework, serve the same handler at /api/copilotkit. It runs a Gemini agent and reads its key from GOOGLE_API_KEY: put that variable name in .env.example and never write a key into a file.
\`\`\`ts
${ROUTE}
\`\`\`

4. Wrap the app in the provider and render the chat where the assistant belongs:
\`\`\`tsx
${PROVIDER}
\`\`\`

5. Verify: start the dev server, ask the chat for "a dashboard of this week's signups", and check that a UI renders. Fix any catalog error the browser console reports.

Optional, for an agent that writes A2UI outside CopilotKit (ADK, Gemini CLI, another runtime): export the catalog with \`exportA2UICatalog(ui)\` from @copilotkit/react-core/v2/generative-ui, and generate an agent skill from it with \`SkillGenerator\` from @a2ui/agent.

References:
- A working example of this setup: ${origin}
- Its catalog as an A2UI 1.0 document: ${origin}/catalog.json
- CopilotKit generative UI docs: ${DOCS_URL}
- A2UI specification: https://a2ui.org
If you have the CopilotKit or the AG-UI A2UI integration skills installed, load them before you start.`;
}
