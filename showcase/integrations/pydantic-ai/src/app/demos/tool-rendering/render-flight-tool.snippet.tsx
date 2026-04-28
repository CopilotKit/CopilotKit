// Docs-only snippet — not imported or rendered. The pydantic-ai
// tool-rendering demo at page.tsx exercises the get_weather renderer
// only (using a different render-prop signature `{ args, ... }`).
// The docs page at /generative-ui/tool-rendering teaches the
// `{ parameters, ... }` shape and also covers the search_flights
// per-tool renderer plus the wildcard catch-all. These regions show
// what those would look like in a pydantic-ai demo, so the docs render
// real teaching code rather than a missing-snippet box.
//
// See mastra's render-flight-tool.snippet.tsx for the same pattern.

import { useRenderTool, useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

type CatchallToolStatus = "in_progress" | "complete" | "error";

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

interface FlightSearchResult {
  origin?: string;
  destination?: string;
  flights?: unknown[];
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
  // Wildcard catch-all for every remaining tool (anything the agent
  // might call that doesn't have a dedicated useRenderTool registration).
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
