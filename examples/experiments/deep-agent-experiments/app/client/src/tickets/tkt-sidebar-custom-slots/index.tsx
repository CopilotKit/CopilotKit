import { useState } from "react";
import "@copilotkit/react-core/v2/styles.css";
import type { TicketMeta } from "../lib/ticket-types";
import { ScenarioBaseline } from "./scenario-baseline";
import { ScenarioBroken } from "./scenario-broken";

export const meta: TicketMeta = {
  title: "CopilotSidebar custom slot components cause layout issues",
  refs: [
    "https://copilotkit.slack.com/archives/C09C1BLEPC1/p1772582841222979?thread_ts=1772148890.584049&cid=C09C1BLEPC1",
  ],
  notes:
    "Custom input slot not visible, messageView cut off from top. Root cause: default CopilotChatInput uses position:absolute but custom slot components flow normally and get clipped by overflow-hidden parent.",
};

type Scenario = "baseline" | "broken";

export default function TktSidebarCustomSlots() {
  const [active, setActive] = useState<Scenario>("broken");

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-2">
        CopilotSidebar — Custom Slot Components
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Select a scenario. Only one runs at a time to keep logs clean.
      </p>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActive("baseline")}
          className={`px-3 py-1 rounded text-sm ${active === "baseline" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
        >
          Baseline (default slots)
        </button>
        <button
          onClick={() => setActive("broken")}
          className={`px-3 py-1 rounded text-sm ${active === "broken" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
        >
          Broken (custom slots)
        </button>
      </div>

      {active === "baseline" && <ScenarioBaseline />}
      {active === "broken" && <ScenarioBroken />}
    </div>
  );
}
