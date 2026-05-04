// V2 conversion of the previous v1 `useCopilotAction`. Exercises the case
// where `render` is an *imported* component reference rather than an inline
// arrow — rolldown follows the import, includes it in the IIFE, and the
// runtime bundles it correctly. Handler returns synthetic AQI data so the
// imported render component has real numbers to draw.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { AirQualityBadge } from "./shared/AirQualityBadge";
import { mockAirQuality } from "./shared/mock-weather";

export function ImportedAirQuality() {
  useFrontendTool({
    name: "displayAirQuality",
    followUp: false,
    description:
      "Render an AQI (air quality index) card for a city. UI TOOL — does not fetch live AQI. Pass `aqi` (0–500) if you have it; otherwise the renderer uses a deterministic placeholder.",
    parameters: z.object({
      city: z.string(),
      aqi: z.number().min(0).max(500).optional(),
    }),
    handler: async ({ city, aqi }) => {
      const base = mockAirQuality(city);
      return aqi !== undefined ? { ...base, aqi } : base;
    },
    render: AirQualityBadge,
  });
  return null;
}

export default ImportedAirQuality;
