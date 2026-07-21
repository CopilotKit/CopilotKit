import { s } from "@hashbrownai/core";
import {
  createUiKit,
  exposeComponent,
  exposeMarkdown,
} from "@hashbrownai/angular";

import {
  HashbrownBarChart,
  HashbrownDealCard,
  HashbrownMetricCard,
  HashbrownPieChart,
} from "./hashbrown-presenters";

/** Official Hashbrown UI kit matching Showcase's shared assistant JSON contract. */
export const salesDashboardUiKit = createUiKit({
  components: [
    exposeMarkdown(),
    exposeComponent(HashbrownMetricCard, {
      name: "metric",
      description: "A KPI metric card with a label, value, and optional trend.",
      input: {
        label: s.string("The metric label"),
        value: s.string("The formatted metric value"),
      },
    }),
    exposeComponent(HashbrownPieChart, {
      name: "pieChart",
      description: "A pie chart whose data is a JSON-encoded array.",
      input: {
        title: s.string("The chart title"),
        data: s.string("A JSON array of label and value objects"),
      },
    }),
    exposeComponent(HashbrownBarChart, {
      name: "barChart",
      description: "A bar chart whose data is a JSON-encoded array.",
      input: {
        title: s.string("The chart title"),
        data: s.string("A JSON array of label and value objects"),
      },
    }),
    exposeComponent(HashbrownDealCard, {
      name: "dealCard",
      description: "A sales deal card with pipeline and ownership details.",
      input: {
        title: s.string("The deal title"),
        stage: s.string("The pipeline stage"),
        value: s.number("The deal value in dollars"),
      },
    }),
  ],
});
