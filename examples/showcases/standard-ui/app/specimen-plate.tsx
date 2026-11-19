"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { createCatalogAgent, sampleSurfaceId } from "./catalog/catalog-agent";
import type { CatalogSample } from "./catalog/samples";

/**
 * The prompt the sample answers, shown above it as the visitor's message, so
 * the sample reads as a reply rather than a stray widget. Keep it in step
 * with PLATE_SAMPLE.
 */
export const SAMPLE_PROMPT =
  "Price a team plan at $29 a seat: a seat slider, the monthly total and a six-month cost chart.";

/**
 * The empty chat's sample answer: a team-plan calculator where a Slider drives
 * the price, its breakdown and a Chart through function values. It follows
 * the layout rules the agent gets (app/lib/design-guide.ts): the number that
 * matters leads in large type, the control sits beside it, the chart is in
 * dollars, and nothing repeats what another part already shows. It is a
 * one-off sample, not a catalog entry, so its copy can say what a person would
 * want to know.
 */
const PLATE_SAMPLE: CatalogSample = {
  group: "Sample answer",
  title: "Team plan",
  covers: ["Grid", "Text", "Slider", "Chart"],
  components: [
    {
      id: "root",
      component: "Column",
      gap: 8,
      children: ["top", "ch"],
    },
    {
      id: "top",
      component: "Grid",
      columns: 2,
      gap: 8,
      align: "center",
      children: ["price", "s"],
    },
    {
      id: "price",
      component: "Column",
      gap: 2,
      children: ["label", "total", "each"],
    },
    { id: "label", component: "Caption", text: "Monthly total" },
    {
      id: "total",
      // A Title tops out at the chat's h2 (about 21px) whatever its size, so
      // the headline number is a Text with an explicit size.
      component: "Text",
      fontSize: 40,
      lineHeight: 1.2,
      fontWeight: "semibold",
      tabularNums: true,
      text: {
        "@call": "formatString",
        args: {
          value:
            "${formatCurrency(value: calc(expression: 'seats * 29', seats: /seats), currency: 'USD', decimals: 0)}",
        },
      },
    },
    {
      id: "each",
      component: "Caption",
      text: {
        "@call": "formatString",
        args: {
          value:
            "${/seats} ${pluralize(value: /seats, one: 'seat', other: 'seats')} × $29 each",
        },
      },
    },
    {
      id: "s",
      component: "Slider",
      label: "Seats",
      min: 1,
      max: 50,
      value: { "@path": "/seats" },
    },
    {
      id: "ch",
      component: "Chart",
      chartType: "bar",
      title: "Running total over six months",
      xKey: "month",
      series: [{ key: "cost", label: "Running total" }],
      format: "currency",
      currency: "USD",
      showLegend: false,
      barRadius: 4,
      data: {
        "@call": "series",
        args: {
          count: 6,
          variable: "m",
          item: { month: "Month ${m}", cost: "${m * seats * 29}" },
          seats: { "@path": "/seats" },
        },
      },
      height: 160,
    },
  ],
  data: { seats: 4 },
};

/** Streams the plate's surface once, from the scripted agent. */
function StartPlate() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void copilotkit.runAgent({ agent });
  }, [copilotkit, agent]);
  return null;
}

/**
 * A live standard component surface, rendered in the browser from the
 * operations a model would write. No model and no runtime: a scripted agent
 * streams it, as on /catalog. It has its own provider so it never touches the
 * chat's thread.
 */
export function SpecimenPlate() {
  const [agents] = useState(() => ({
    default: createCatalogAgent([PLATE_SAMPLE], standardUI.id),
  }));
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      generativeUI={{ ui: standardUI }}
    >
      <StartPlate />
      <GenerativeUISurface
        id={sampleSurfaceId(0)}
        fallback={<p className="ck-loading">Loading the sample…</p>}
      />
    </CopilotKitProvider>
  );
}
