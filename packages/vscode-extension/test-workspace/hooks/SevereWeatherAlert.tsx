import { useCopilotAction } from "@copilotkit/react-core";
import "./severe-alert.css";

export function SevereWeatherAlert() {
  useCopilotAction({
    name: "severeAlert",
    description: "Display a severe weather alert banner",
    parameters: [
      { name: "event", type: "string", required: true },
      {
        name: "severity",
        type: "string",
        enum: ["advisory", "watch", "warning"],
        required: true,
      },
      { name: "area", type: "string", required: false },
    ],
    available: "frontend",
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
