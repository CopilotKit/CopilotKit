// Docs-only snippet — not imported or rendered. Agno's tool-rendering
// demo at page.tsx exercises the `get_weather` renderer against the
// shared `main.py` agent; the docs page at /generative-ui/tool-rendering
// also teaches the `search_flights` per-tool pattern, the standalone
// weather card, and the wildcard catch-all. These three regions show
// what those would look like in the same Agno demo shape, so the docs
// can render real teaching code rather than a missing-snippet box.
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

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

function FlightListCard(_props: {
  loading: boolean;
  origin: string;
  destination: string;
  flights: unknown[];
}) {
  return null;
}

function WeatherCard(_props: {
  loading: boolean;
  location: string;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  conditions?: string;
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

export function ToolRenderers() {
  // @region[render-weather-tool]
  // Per-tool renderer #1: get_weather → branded WeatherCard.
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<WeatherResult>(result);
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            humidity={parsed.humidity}
            windSpeed={parsed.wind_speed}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-weather-tool]

  // @region[render-flight-tool]
  // Per-tool renderer #2: search_flights → branded FlightListCard.
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
  // Wildcard catch-all for every remaining tool (get_stock_price,
  // roll_dice, anything the agent might add later).
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
