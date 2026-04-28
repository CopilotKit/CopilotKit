// Docs-only snippet — not imported or rendered. Mastra's tool-rendering
// demo at page.tsx exercises the get_weather renderer only; the docs
// page at /generative-ui/tool-rendering also teaches the search_flights
// per-tool pattern and the wildcard catch-all. These two regions show
// what those would look like in the same Mastra demo shape, so the
// docs can render real teaching code rather than a missing-snippet box.
//
// See chat-component.snippet.tsx in agentic-chat for the same pattern.

import { useRenderTool, useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

type CatchallToolStatus = "in_progress" | "complete" | "error";

interface FlightSearchResult {
  origin?: string;
  destination?: string;
  flights?: unknown[];
}

function FlightListCard(_props: {
  loading: boolean;
  origin: string;
  destination: string;
  flights: unknown[];
}) {
  return null;
}

function CustomCatchallRenderer(_props: {
  name: string;
  parameters: unknown;
  status: CatchallToolStatus;
  result: unknown;
}) {
  return null;
}

function parseJsonResult<T>(_result: unknown): T {
  return {} as T;
}

export function FlightToolRenderers() {
  // @region[render-flight-tool]
  // Per-tool renderer: search_flights → branded FlightListCard.
  useRenderTool(
    {
      name: "search_flights",
      parameters: z.object({
        origin: z.string(),
        destination: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<FlightSearchResult>(result);
        return (
          <FlightListCard
            loading={loading}
            origin={parameters?.origin ?? parsed.origin ?? ""}
            destination={parameters?.destination ?? parsed.destination ?? ""}
            flights={parsed.flights ?? []}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-flight-tool]

  // @region[catchall-renderer]
  // Wildcard catch-all for every remaining tool — anything the agent might
  // call that doesn't have a dedicated useRenderTool registration.
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <CustomCatchallRenderer
          name={name}
          parameters={parameters}
          status={status as CatchallToolStatus}
          result={result}
        />
      ),
    },
    [],
  );
  // @endregion[catchall-renderer]
}
