import { z } from "zod";

import { CATALOG_ID } from "../build-board-ops";

const childrenRef = z.array(z.string());

/**
 * The slice a data-bound component is reported under. Load-bearing: the canvas
 * reads these back off the op list (`extractBoardBinding`) to bind the board's
 * figures. The RENDERERS do not read them — one board is one fetch.
 */
const lensProps = {
  period: z.string().optional(),
  region: z.string().optional(),
  segment: z.string().optional(),
  currency: z.string().optional(),
};

export const definitions = {
  Stack: {
    description: "Vertical layout; the board's root container.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Grid: {
    description: "Responsive grid, used for the KPI tile row.",
    props: z.object({
      children: childrenRef,
      columns: z.number().int().min(1).max(4).optional(),
    }),
  },
  Heading: {
    description: "The board's title.",
    props: z.object({ text: z.string() }),
  },
  Text: {
    description: "A line of prose — the summary read or a footnote.",
    props: z.object({
      text: z.string(),
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  StatCard: {
    description:
      "One KPI tile. Renders the LIVE figure for `metric` under the given lens; " +
      "never carries a number in its props.",
    props: z.object({ metric: z.string(), label: z.string(), ...lensProps }),
  },
  Panel: {
    description:
      "A chart panel: trend, breakdown-segment, breakdown-region or " +
      "plan-variance. Binds live figures under the given lens.",
    props: z.object({ kind: z.string(), title: z.string(), ...lensProps }),
  },
};

export type Definitions = typeof definitions;

export { CATALOG_ID };
