// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 conversion of `severeAlert` — was a v1 `useCopilotAction`. Banner is
// driven by the model's args (the severe-event semantics are external);
// no synthetic data needed.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import "./severe-alert.css";

export function SevereWeatherAlert() {
  useFrontendTool({
    name: "displaySevereAlert",
    followUp: false,
    description:
      "Render a severe-weather alert banner — advisory / watch / warning. UI TOOL: pass the event description and severity directly; this does not fetch live alert data. Call once to surface the warning, then summarize in text.",
    parameters: z.object({
      event: z
        .string()
        .describe("Name of the event, e.g. 'Severe thunderstorm warning'"),
      severity: z.enum(["advisory", "watch", "warning"]),
      area: z.string().optional().describe("Geographic area affected"),
    }),
    handler: async ({ event, severity, area }) => ({
      event,
      severity,
      area: area ?? "your region",
      issuedAt: new Date().toISOString(),
    }),
    render: ({ args }) => {
      const severity = (args?.severity ?? "warning") as
        | "advisory"
        | "watch"
        | "warning";
      const palette = {
        advisory: "cpk-alert-advisory",
        watch: "cpk-alert-watch",
        warning: "cpk-alert-warning",
      }[severity];
      return (
        <div className={`cpk-alert ${palette}`}>
          <div className="cpk-alert-pulse" aria-hidden />
          <div className="cpk-alert-icon" aria-hidden>
            ⚠
          </div>
          <div className="cpk-alert-body">
            <div className="cpk-alert-severity">{severity}</div>
            <div className="cpk-alert-event">
              {args?.event ?? "Severe weather"}
            </div>
            <div className="cpk-alert-area">
              {args?.area ?? "Area: your region"}
            </div>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default SevereWeatherAlert;
