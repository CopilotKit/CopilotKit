import { useState } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import { TAG } from "./lib";
import { HookAlwaysTrueScenario } from "./scenario-hook-always-true";
import { NoControlledPropScenario } from "./scenario-no-controlled-prop";
import { WorkaroundScenario } from "./scenario-workaround";
import { NestedProviderScenario } from "./scenario-nested-provider";
import { SidebarOuterHookScenario } from "./scenario-sidebar-outer-hook";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title:
    "v2: isModalOpen from useCopilotChatConfiguration always true + no controlled open prop",
  refs: [
    "https://copilotkit.slack.com/archives/C09C1BLEPC1/p1769212515887719?thread_ts=1769117890.682419&cid=C09C1BLEPC1",
    "https://github.com/CopilotKit/CopilotKit/issues/3334",
  ],
  notes:
    "Two related issues:\n" +
    "1. useCopilotChatConfiguration().isModalOpen always returns true — setting " +
    "isModalDefaultOpen on a parent provider is overridden by the popup/sidebar's own " +
    "internal provider which defaults to true.\n" +
    "2. v2 regression from v1: no `open` or `onSetOpen` controlled props on " +
    "CopilotPopup/CopilotSidebar. State is sealed inside the component.\n\n" +
    "Open the browser console and filter for [tkt-modal-default-open] to see verdicts.",
};

type Scenario =
  | "hook-always-true"
  | "external-control"
  | "workaround"
  | "nested"
  | "sidebar-outer-hook";

const scenarios: { id: Scenario; label: string }[] = [
  { id: "hook-always-true", label: "Hook reads true despite false" },
  { id: "external-control", label: "No controlled open prop" },
  { id: "workaround", label: "Workaround (setModalOpen)" },
  { id: "nested", label: "Nested provider leak" },
  { id: "sidebar-outer-hook", label: "Sidebar state from outer hook" },
];

export default function TktModalDefaultOpen() {
  const [active, setActive] = useState<Scenario | null>(null);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        isModalOpen from useCopilotChatConfiguration() always true
      </h2>

      <div className="text-sm text-gray-600 mb-4">
        Open the <strong>browser console</strong> and filter for{" "}
        <code>{TAG}</code>. Each scenario logs PASS/FAIL verdicts and explains
        expected vs actual behavior.
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {scenarios.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActive(active === id ? null : id)}
            className={`px-3 py-2 rounded text-sm font-medium border transition-colors ${
              active === id
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {active === id ? "Stop" : "Start"}: {label}
          </button>
        ))}
      </div>

      {active === null && (
        <div className="p-8 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-400">
          Select a scenario above — check the browser console for verdicts
        </div>
      )}

      {active === "hook-always-true" && <HookAlwaysTrueScenario />}
      {active === "external-control" && <NoControlledPropScenario />}
      {active === "workaround" && <WorkaroundScenario />}
      {active === "nested" && <NestedProviderScenario />}
      {active === "sidebar-outer-hook" && <SidebarOuterHookScenario />}

      <div className="mt-6 p-4 bg-gray-50 rounded-lg border text-xs text-gray-600 space-y-3">
        <h3 className="font-semibold text-gray-700">Root causes</h3>
        <div>
          <strong>1. CopilotPopupView hardcodes defaultOpen=true</strong>
          <span className="font-mono ml-1">(CopilotPopupView.tsx:49)</span>
          <p className="mt-1">
            The popup's inner provider always initializes with{" "}
            <code>isModalOpen=true</code> unless explicitly overridden via{" "}
            <code>defaultOpen</code> prop. User's outer provider is shadowed.
          </p>
        </div>
        <div>
          <strong>2. No controlled props</strong>
          <span className="ml-1">
            (v2 regression from v1,{" "}
            <a
              href="https://github.com/CopilotKit/CopilotKit/issues/3334"
              className="underline"
            >
              #3334
            </a>
            )
          </span>
          <p className="mt-1">
            v1: <code>open</code> + <code>onSetOpen</code> +{" "}
            <code>defaultOpen</code> — v2: only <code>defaultOpen</code>
          </p>
        </div>
        <div>
          <strong>3. Nested provider leak</strong>
          <span className="font-mono ml-1">
            (CopilotChatConfigurationProvider.tsx:91)
          </span>
          <pre className="bg-white p-2 rounded border overflow-x-auto mt-1">
            {`parentConfig?.isModalOpen ?? internalModalOpen`}
          </pre>
          <p className="mt-1">
            Child inherits parent's value instead of using its own{" "}
            <code>isModalDefaultOpen</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
