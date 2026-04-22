// Verifies that the preview bundler handles a hook whose `render` is an
// *imported* component reference rather than an inline arrow. The shared
// AirQualityBadge lives in `./shared/AirQualityBadge.tsx`; rolldown follows
// the import, includes it in the IIFE, and the stub's useCopilotAction
// captures it exactly as it would an inline function.
import { useCopilotAction } from "@copilotkit/react-core";
import { AirQualityBadge } from "./shared/AirQualityBadge";

export function ImportedAirQuality() {
  useCopilotAction({
    name: "showAirQuality",
    description: "Displays the air quality index for a given city",
    parameters: [
      { name: "city", type: "string", required: true },
      { name: "aqi", type: "number", required: true },
    ],
    available: "frontend",
    // Note: the render is the imported component reference — not an inline
    // arrow. Exercises the bundler's handling of cross-file imports on the
    // preview path.
    render: AirQualityBadge,
  });
  return null;
}

export default ImportedAirQuality;
