"use client";

// @region[render-weather-tool]
import {
  CopilotKitProvider,
  CopilotChat,
  useRenderTool,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function ToolRendering() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useRenderTool({
    name: "get_weather",
    parameters: z.object({ location: z.string() }),
    render: ({ parameters, result, status }) => {
      return (
        <WeatherCard
          loading={status !== "complete"}
          parameters={parameters}
          result={result}
        />
      );
    },
  });
  // @endregion[render-weather-tool]

  // @region[catchall-renderer]
  useDefaultRenderTool({
    render: GenericToolCard,
  });
  // @endregion[catchall-renderer]

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tool Rendering</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;What&apos;s the weather in Tokyo?&rdquo; The
        <code className="mx-1 px-1 bg-gray-100 rounded">get_weather</code>tool
        renders with a custom card; everything else falls back to a generic
        renderer.
      </p>
      <CopilotChat />
    </main>
  );
}

/**
 * WeatherCard — rendered via `useRenderTool({ name: "get_weather" })`.
 *
 * Receives `loading`, `parameters` (tool args), and `result` (tool output).
 * The server tool returns: { city, temperature, humidity, wind_speed, conditions }.
 */
function WeatherCard({
  loading,
  parameters,
  result,
}: {
  loading: boolean;
  parameters?: { location?: string };
  result?: unknown;
}) {
  if (loading || !result) {
    return (
      <div className="border rounded p-3 my-2 opacity-70 text-sm">
        Fetching weather…
      </div>
    );
  }

  let data: {
    city?: string;
    temperature?: number;
    tempF?: number;
    condition?: string;
    conditions?: string;
    humidity?: number;
    wind_speed?: number;
  } = {};
  try {
    data =
      typeof result === "string" ? JSON.parse(result) : (result as typeof data);
  } catch {
    // Leave data empty on parse failure
  }
  const city = data.city ?? parameters?.location ?? "—";
  const temp = data.temperature ?? data.tempF;
  const condition = data.conditions ?? data.condition;
  const humidityVal = data.humidity;
  const humidityStr =
    humidityVal != null
      ? humidityVal < 1
        ? `${Math.round(humidityVal * 100)}%`
        : `${humidityVal}%`
      : "—";
  return (
    <div data-testid="weather-card" className="border rounded p-3 my-2">
      <div className="font-medium">Weather in {city}</div>
      <div className="grid grid-cols-3 gap-2 text-sm mt-2">
        <div>
          <div className="opacity-60">Temp</div>
          <div>{temp != null ? `${temp}°F` : "—"}</div>
        </div>
        <div>
          <div className="opacity-60">Condition</div>
          <div>{condition ?? "—"}</div>
        </div>
        <div>
          <div className="opacity-60">Humidity</div>
          <div>{humidityStr}</div>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GenericToolCard(props: any) {
  const { name, status, parameters, result } = props;
  return (
    <div className="border rounded p-2 my-2 text-xs">
      <div className="font-mono opacity-60">
        {name} <span className="opacity-50">[{status}]</span>
      </div>
      <pre className="overflow-auto text-[10px] mt-1">
        {JSON.stringify(
          status === "complete" ? safeParse(result) : parameters,
          null,
          2,
        )}
      </pre>
    </div>
  );
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
