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
 * Text, a List and a Chart through function values, worded for a visitor
 * rather than as a catalog test case. It is a one-off sample, not a catalog
 * entry, so its copy can say what a person would want to know.
 */
const PLATE_SAMPLE: CatalogSample = {
  group: "Sample answer",
  title: "Team plan",
  covers: ["Slider", "Text", "List", "Chart"],
  components: [
    {
      id: "root",
      component: "Column",
      gap: 3,
      children: ["s", "t", "l", "ch"],
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
      id: "t",
      component: "Text",
      text: {
        "@call": "formatString",
        args: {
          value:
            "${/seats} ${pluralize(value: /seats, one: 'seat', other: 'seats')} cost ${formatCurrency(value: calc(expression: 'seats * 29', seats: /seats), currency: 'USD', decimals: 0)} a month",
        },
      },
    },
    {
      id: "l",
      component: "List",
      items: [
        {
          label: "Per seat",
          value: {
            "@call": "formatCurrency",
            args: { value: 29, currency: "USD", decimals: 0 },
          },
        },
        {
          label: "Seats",
          value: {
            "@call": "formatNumber",
            args: { value: { "@path": "/seats" } },
          },
        },
      ],
    },
    {
      id: "ch",
      component: "Chart",
      chartType: "bar",
      title: "Cost over 6 months",
      xKey: "month",
      series: [{ key: "cost", label: "Cost (USD)" }],
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
