/* a2ui-renderer's createCatalog is typed against Zod v3. We pin the
   v3 namespace here so the catalog types match. The rest of the app
   uses v4 (required by @tanstack/ai). */
import { z } from "zod/v3";

export const CATALOG_ID = "copilotkit://stocks-catalog";

const childrenRef = z.union([
  z.array(z.string()),
  z.object({ componentId: z.string(), path: z.string() }),
]);

const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom. Default container.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["xs", "sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Row: {
    description: "Horizontal layout. Children side-by-side, wraps.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["xs", "sm", "md", "lg"]).optional(),
    }),
  },
  Grid: {
    description: "Responsive grid. Use for cards arranged in columns.",
    props: z.object({
      children: childrenRef,
      columns: z.number().int().min(1).max(4).optional(),
      gap: z.enum(["xs", "sm", "md", "lg"]).optional(),
    }),
  },
  Heading: {
    description: "Section title. Use level 1 once per surface.",
    props: z.object({
      text: stringOrPath,
      level: z.enum(["1", "2", "3"]).optional(),
    }),
  },
  Text: {
    description: "Body copy. Use tone='muted' for secondary text.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  Overline: {
    description: "Tiny ALL-CAPS mono label above a heading.",
    props: z.object({ text: stringOrPath }),
  },
  StockCard: {
    description:
      "Single stock card. Renders ticker, price, delta, and sparkline. Pass ticker only. Examples: AAPL, MSFT, GOOG, NVDA, TSLA, AMZN.",
    props: z.object({ ticker: stringOrPath }),
  },
} as const;

export type Definitions = typeof definitions;

export const CATALOG_PROMPT = `\
## A2UI components you may use

Use ONLY these. Exactly one component must have id="root".

### Layout
- Stack { children: [ids], gap?: xs|sm|md|lg|xl }
- Row { children: [ids], gap?: xs|sm|md|lg }
- Grid { children: [ids], columns?: 1-4, gap?: xs|sm|md|lg }

### Content
- Heading { text, level?: "1"|"2"|"3" }
- Text { text, tone?: default|muted }
- Overline { text } — tiny all-caps mono label

### Domain
- StockCard { ticker } — renders the full card. Available tickers:
  AAPL, MSFT, GOOG, NVDA, TSLA, AMZN.
`;
