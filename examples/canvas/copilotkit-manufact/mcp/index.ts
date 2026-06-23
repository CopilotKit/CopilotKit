import { MCPServer, text, widget } from "mcp-use/server";
import { z } from "zod";
import {
  leadSchema,
  segmentSchema,
  type Lead,
  type Segment,
} from "./src/lib/leads/types";
import { topWorkshop } from "./src/lib/leads/derive";
import { SAMPLE_LEADS, SAMPLE_SEGMENTS } from "./src/lib/leads/sample";

const server = new MCPServer({
  name: "hackathon-mcp",
  title: "hackathon-mcp",
  version: "1.0.0",
  description:
    "Workshop Lead Triage — three views of Notion-sourced workshop leads (list, demand, pipeline).",
  baseUrl: process.env.MCP_URL || "http://localhost:3001",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

// Shared input schema. All three tools accept an optional `leads` array (and
// `segments`, where applicable). When omitted or empty, the widget falls back
// to the sample dataset baked into `src/lib/leads/sample.ts` so the views can
// be demoed inside ChatGPT/Claude without a backing fetch.
const leadsInput = z.object({
  leads: z
    .array(leadSchema)
    .default([])
    .describe(
      "Lead rows. Omit or pass an empty array to render with the sample dataset.",
    ),
  segments: z
    .array(segmentSchema)
    .default([])
    .describe("Optional segments for colored dots."),
});

function pickLeads(input: { leads: Lead[] }): Lead[] {
  return input.leads.length ? input.leads : SAMPLE_LEADS;
}

function pickSegments(input: { segments: Segment[] }): Segment[] {
  return input.segments.length ? input.segments : SAMPLE_SEGMENTS;
}

function summarize(leads: Lead[], view: string): string {
  const top = topWorkshop(leads);
  const tail = top ? ` Top demand: ${top}.` : "";
  return `Rendered the ${view} view for ${leads.length} leads.${tail}`;
}

server.tool(
  {
    name: "show-lead-list",
    description:
      "Render the workshop lead triage *list* view (KPI tiles + table of leads).",
    schema: leadsInput,
    widget: {
      name: "lead-list",
      invoking: "Loading leads…",
      invoked: "List ready",
    },
  },
  async (input) => {
    const leads = pickLeads(input);
    const segments = pickSegments(input);
    return widget({
      props: { leads, segments },
      output: text(summarize(leads, "list")),
    });
  },
);

server.tool(
  {
    name: "show-lead-demand",
    description:
      "Render the workshop lead triage *demand* view (workshop bars, technical-level donut, tool usage).",
    schema: leadsInput.pick({ leads: true }),
    widget: {
      name: "lead-demand",
      invoking: "Aggregating leads…",
      invoked: "Demand ready",
    },
  },
  async (input) => {
    const leads = pickLeads(input);
    return widget({
      props: { leads },
      output: text(summarize(leads, "demand")),
    });
  },
);

server.tool(
  {
    name: "show-lead-pipeline",
    description:
      "Render the workshop lead triage *pipeline* view (kanban columns by status, read-only).",
    schema: leadsInput,
    widget: {
      name: "lead-pipeline",
      invoking: "Loading pipeline…",
      invoked: "Pipeline ready",
    },
  },
  async (input) => {
    const leads = pickLeads(input);
    const segments = pickSegments(input);
    return widget({
      props: { leads, segments },
      output: text(summarize(leads, "pipeline")),
    });
  },
);

server.listen().then(() => {
  console.log("MCP server running on port 3001");
});
