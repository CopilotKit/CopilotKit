"use client";

// Tool Rendering — PRIMARY (per-tool + catch-all) variant for
// built-in-agent. Ports the LGP `tool-rendering` cell:
//
//   get_weather     → <WeatherCard />       (per-tool renderer)
//   search_flights  → <FlightListCard />    (per-tool renderer)
//   get_stock_price → <StockCard />         (per-tool renderer)
//   roll_d20        → <D20Card />           (per-tool renderer)
//   *               → <CustomCatchallRenderer /> (wildcard fallback)

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import { useToolRenderingRenderers } from "./tool-renderers";
import { useSuggestions } from "./suggestions";

export default function ToolRendering() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useToolRenderingRenderers();
  useSuggestions();

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
