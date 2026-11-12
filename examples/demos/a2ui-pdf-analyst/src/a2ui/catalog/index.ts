/**
 * The CopilotKit generative UI catalog.
 *
 * `catalog` is what we hand to the provider (`generativeUI={{ ui: catalog }}`
 * in Providers.tsx). CopilotKit sends it with every run, and the runtime
 * turns it into the v0.9 component schema the Python agents get as context.
 * The agents also cite `agent/src/catalog.py` in their prompts.
 *
 * Note: the standard catalog is intentionally not extended. Our catalog is
 * the complete design system. If you want Text/Button/Row from the standard
 * catalog for free, add `extends: [standardUI.omit([...])]` and drop the
 * names this catalog already uses.
 */
import { z } from "zod";
import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";
import { CATALOG_ID, definitions } from "./definitions";
import { renderers } from "./renderers";

export const catalog = createGenerativeUI({
  id: CATALOG_ID,
  functions: {
    // ChoiceChips calls this (its `onSelectChip` event). SurfaceCanvas
    // registers the handler, which sends the click to the agent.
    selectChip: {
      description: "Selects a scope chip and asks the agent to re-render.",
      parameters: z.object({ value: z.string(), label: z.string() }),
    },
  },
  components: {
    Stack: { component: renderers.Stack, ...definitions.Stack },
    Row: { component: renderers.Row, ...definitions.Row },
    Grid: { component: renderers.Grid, ...definitions.Grid },
    Section: { component: renderers.Section, ...definitions.Section },
    Card: { component: renderers.Card, ...definitions.Card },
    Divider: { component: renderers.Divider, ...definitions.Divider },
    Heading: { component: renderers.Heading, ...definitions.Heading },
    Text: { component: renderers.Text, ...definitions.Text },
    Overline: { component: renderers.Overline, ...definitions.Overline },
    Badge: { component: renderers.Badge, ...definitions.Badge },
    Callout: { component: renderers.Callout, ...definitions.Callout },
    BulletList: { component: renderers.BulletList, ...definitions.BulletList },
    StatCard: { component: renderers.StatCard, ...definitions.StatCard },
    BarChart: { component: renderers.BarChart, ...definitions.BarChart },
    HorizontalBarChart: {
      component: renderers.HorizontalBarChart,
      ...definitions.HorizontalBarChart,
    },
    LineChart: { component: renderers.LineChart, ...definitions.LineChart },
    DonutChart: { component: renderers.DonutChart, ...definitions.DonutChart },
    ScatterChart: {
      component: renderers.ScatterChart,
      ...definitions.ScatterChart,
    },
    DataTable: { component: renderers.DataTable, ...definitions.DataTable },
    Button: { component: renderers.Button, ...definitions.Button },
    ChoiceChips: {
      component: renderers.ChoiceChips,
      ...definitions.ChoiceChips,
    },
  },
});

export { CATALOG_ID, definitions };
