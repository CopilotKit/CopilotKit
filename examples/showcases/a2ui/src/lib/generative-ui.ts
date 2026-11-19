import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import type { GenerativeUITheme } from "@copilotkit/react-core/v2/generative-ui";
import { z } from "zod";

/**
 * The research desk's generative UI: the standard catalog, unchanged, plus the
 * functions that generated buttons can call. The agent sees each function's
 * description and schema in the generative UI guide the app sends with every
 * run; the handlers live in `use-desk-functions.ts`.
 */
export const deskUI = createGenerativeUI({
  id: "copilotkit/research-desk@1",
  extends: [standardUI],
  functions: {
    saveNote: {
      description:
        "Save a finding to the reader's notes, with an optional source. Use for a key figure, conclusion, or quote worth keeping.",
      parameters: z.object({
        title: z.string().describe("A short name for the finding"),
        text: z.string().describe("The finding, in one or two sentences"),
        sourceUrl: z.string().optional(),
      }),
    },
    openSource: {
      description: "Open a source page in a new browser tab.",
      parameters: z.object({
        url: z.string().describe("An http(s) URL from the research sources"),
      }),
    },
    askFollowUp: {
      description:
        "Ask the research desk a follow-up question as if the reader typed it. Use for a natural next question.",
      parameters: z.object({
        question: z
          .string()
          .describe("The question, phrased as the reader would ask it"),
      }),
    },
    copyText: {
      description: "Copy a figure, citation, or passage to the clipboard.",
      parameters: z.object({
        text: z.string(),
        label: z
          .string()
          .optional()
          .describe("What was copied, for the confirmation"),
      }),
    },
    exportCsv: {
      description:
        "Download tabular data as a CSV file. Pass the same rows the view shows, as objects with the same keys.",
      parameters: z.object({
        filename: z.string().describe("A file name without extension"),
        rows: z.array(
          z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        ),
      }),
    },
  },
  components: {},
});

/**
 * Solarized, comfortable: the generated components wear the app's palette.
 * Every value points at a token in `src/styles/tokens.css`, so the chat, the
 * drawer and the generated views stay one system.
 */
export const deskTheme: GenerativeUITheme = {
  "--a2ui-font-family": "var(--font-sans)",

  "--a2ui-color-text-default": "var(--ink)",
  "--a2ui-color-text-prose": "var(--ink)",
  "--a2ui-color-text-primary": "var(--ink-strong)",
  "--a2ui-color-text-emphasis": "var(--ink-strong)",
  "--a2ui-color-text-secondary": "var(--ink-muted)",
  "--a2ui-color-text-tertiary": "var(--ink-muted)",
  "--a2ui-color-text-success": "var(--signal-ok)",
  "--a2ui-color-text-info": "var(--desk-accent-strong)",
  "--a2ui-color-text-warning": "var(--signal-warn)",
  "--a2ui-color-text-caution": "var(--signal-warn)",
  "--a2ui-color-text-danger": "var(--signal-danger)",
  "--a2ui-color-text-discovery": "var(--signal-discovery)",

  "--a2ui-color-surface": "var(--paper)",
  "--a2ui-color-surface-secondary": "var(--sand-raised)",
  "--a2ui-color-surface-tertiary": "var(--sand)",
  "--a2ui-color-surface-elevated": "var(--paper-raised)",
  "--a2ui-color-surface-elevated-secondary": "var(--sand-raised)",
  "--a2ui-color-surface-inverted": "var(--ink-strong)",
  "--a2ui-color-surface-soft": "var(--sand-raised)",
  "--a2ui-color-panel": "var(--paper-raised)",
  "--a2ui-color-control": "var(--paper-raised)",

  "--a2ui-color-info": "var(--wash-blue)",
  "--a2ui-color-warning": "var(--wash-yellow)",
  "--a2ui-color-caution": "var(--wash-orange)",
  "--a2ui-color-success": "var(--wash-green)",
  "--a2ui-color-danger": "var(--wash-red)",
  "--a2ui-color-discovery": "var(--wash-violet)",
  "--a2ui-color-info-soft": "var(--wash-blue-soft)",
  "--a2ui-color-warning-soft": "var(--wash-yellow-soft)",
  "--a2ui-color-caution-soft": "var(--wash-orange-soft)",
  "--a2ui-color-success-soft": "var(--wash-green-soft)",
  "--a2ui-color-danger-soft": "var(--wash-red-soft)",
  "--a2ui-color-discovery-soft": "var(--wash-violet-soft)",
  "--a2ui-color-info-solid": "var(--desk-accent)",
  "--a2ui-color-warning-solid": "var(--solid-yellow)",
  "--a2ui-color-caution-solid": "var(--solid-orange)",
  "--a2ui-color-success-solid": "var(--solid-green)",
  "--a2ui-color-danger-solid": "var(--solid-red)",
  "--a2ui-color-discovery-solid": "var(--solid-violet)",

  "--a2ui-color-border-default": "var(--rule)",
  "--a2ui-color-border-subtle": "var(--rule)",
  "--a2ui-color-border-strong": "var(--rule-strong)",
  "--a2ui-color-border-control": "var(--rule-strong)",
  "--a2ui-color-border-info": "var(--edge-blue)",
  "--a2ui-color-border-warning": "var(--edge-yellow)",
  "--a2ui-color-border-caution": "var(--edge-orange)",
  "--a2ui-color-border-success": "var(--edge-green)",
  "--a2ui-color-border-danger": "var(--edge-red)",
  "--a2ui-color-border-discovery": "var(--edge-violet)",

  "--a2ui-color-accent": "var(--desk-accent)",
  "--a2ui-color-on-accent": "var(--on-accent)",
  "--a2ui-color-focus": "var(--focus)",
  "--a2ui-color-shimmer": "var(--sand-raised)",
  "--a2ui-color-chart-cursor": "var(--desk-accent-wash)",
  "--a2ui-color-slider-track": "var(--sand)",
  "--a2ui-color-badge-secondary": "var(--sand)",
  "--a2ui-color-highlight-green": "var(--wash-green)",
  "--a2ui-color-highlight-orange": "var(--wash-orange)",
  "--a2ui-color-highlight-pink": "var(--wash-magenta)",
  "--a2ui-color-rating": "var(--sol-yellow)",
  "--a2ui-color-backdrop": "var(--scrim)",
  "--a2ui-color-overlay": "var(--scrim)",

  "--a2ui-chart-1": "var(--mark-1)",
  "--a2ui-chart-2": "var(--mark-2)",
  "--a2ui-chart-3": "var(--mark-3)",
  "--a2ui-chart-4": "var(--mark-4)",
  "--a2ui-chart-5": "var(--mark-5)",
  "--a2ui-chart-6": "var(--mark-7)",

  "--a2ui-radius-sm": "var(--radius-sm)",
  "--a2ui-radius-md": "var(--radius-sm)",
  "--a2ui-radius-lg": "var(--radius)",
  "--a2ui-radius-xl": "var(--radius-lg)",

  "--a2ui-shadow-xs": "var(--shadow-hairline)",
  "--a2ui-shadow-sm": "var(--shadow-hairline)",
  "--a2ui-shadow-soft": "var(--shadow-hairline)",
  "--a2ui-shadow-md": "var(--shadow-hairline)",
};
