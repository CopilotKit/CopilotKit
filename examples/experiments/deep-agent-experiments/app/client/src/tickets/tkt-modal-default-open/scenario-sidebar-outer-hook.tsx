/**
 * Scenario 5 — Abe.Hu's exact layout: outer provider + CopilotSidebar
 *
 * Reproduces the reported tree as closely as possible:
 *
 *   CopilotChatConfigurationProvider  (USER's — no props)
 *     └── CopilotKitProvider (runtimeUrl=...)
 *           ├── SidebarStateReader              ← "above AIAgent", reads from outer provider
 *           └── AIAgent (simplified)
 *                 └── CopilotSidebar (defaultOpen={true})
 *                       └── CopilotChat
 *                             └── CopilotChatConfigurationProvider  (COPILOTCHAT's)
 *                                   └── CopilotSidebarView
 *                                         └── CopilotChatConfigurationProvider  (SIDEBAR's)
 *                                               └── CopilotSidebarViewInternal
 *
 * The user reports: useCopilotChatConfiguration().isModalOpen always returns
 * true even after closing the sidebar via the toggle button.
 *
 * We also test the case where the hook is called OUTSIDE the outer provider
 * entirely (e.g. in a parent layout component), which would read null.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CopilotKitProvider,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";
import { TAG } from "./lib";

const RUNTIME_URL = "/api/tickets/tkt-modal-default-open/copilot";

// ---------------------------------------------------------------------------
// Simulates Abe.Hu's AIAgent wrapper — just renders CopilotSidebar + children
// ---------------------------------------------------------------------------

function AIAgent({ children }: { children?: ReactNode }) {
  return (
    <div>
      <CopilotSidebar
        defaultOpen={true}
        disclaimer={() => <></>}
        welcomeScreen={false}
      />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook consumer — placed "above AIAgent in the widget tree"
// ---------------------------------------------------------------------------

function SidebarStateReader({ location }: { location: string }) {
  const config = useCopilotChatConfiguration();
  const isOpen = config?.isModalOpen;
  const setModalOpen = config?.setModalOpen;
  const [renderCount, setRenderCount] = useState(0);

  useEffect(() => {
    console.log(
      `${TAG} [${location}] hook reports isModalOpen=${String(isOpen)} (render #${renderCount})`,
    );
  }, [isOpen, renderCount, location]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-mono p-3 rounded-lg border-2 bg-gray-50 border-gray-300">
        <div className="font-bold">
          useCopilotChatConfiguration() — {location}
        </div>
        <div>
          isModalOpen = <strong>{String(isOpen)}</strong>
        </div>
        <div>
          setModalOpen = <strong>{setModalOpen ? "defined" : "undefined"}</strong>
        </div>
        <div>
          config = <strong>{config ? "present" : "null"}</strong>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => {
            setRenderCount((c) => c + 1);
            console.log(
              `%cACTION%c ${TAG} [${location}] Force re-render #${renderCount + 1}`,
              "color: blue; font-weight: bold",
              "color: inherit",
            );
          }}
          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          Force re-read
        </button>
        {setModalOpen && (
          <>
            <button
              onClick={() => {
                console.log(
                  `%cACTION%c ${TAG} [${location}] calling setModalOpen(true)`,
                  "color: blue; font-weight: bold",
                  "color: inherit",
                );
                setModalOpen(true);
              }}
              className="px-3 py-1.5 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700"
            >
              setModalOpen(true)
            </button>
            <button
              onClick={() => {
                console.log(
                  `%cACTION%c ${TAG} [${location}] calling setModalOpen(false)`,
                  "color: blue; font-weight: bold",
                  "color: inherit",
                );
                setModalOpen(false);
              }}
              className="px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700"
            >
              setModalOpen(false)
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main scenario
// ---------------------------------------------------------------------------

export function SidebarOuterHookScenario() {
  console.log(`\n${TAG} ===== Scenario: Abe.Hu's sidebar layout =====`);
  console.log(`${TAG} Outer CopilotChatConfigurationProvider → CopilotKitProvider → AIAgent → CopilotSidebar`);
  console.log(`${TAG} Hook consumed at 3 locations: outside provider, inside provider, inside AIAgent\n`);

  return (
    <div className="p-4 space-y-6">
      <div className="text-xs text-gray-500">
        Reproduces Abe.Hu's exact provider stack. Three hook probe locations to
        find exactly where the disconnect happens: outside the provider, between
        the provider and sidebar, and inside the AIAgent alongside the sidebar.
      </div>

      {/* Probe 1: OUTSIDE the outer provider entirely */}
      <div className="border-l-4 border-orange-400 pl-3">
        <div className="text-xs text-gray-500 font-semibold mb-2">
          Probe: OUTSIDE CopilotChatConfigurationProvider
        </div>
        <SidebarStateReader location="outside-provider" />
      </div>

      <CopilotChatConfigurationProvider>
        <CopilotKitProvider
          runtimeUrl={RUNTIME_URL}
          agents__unsafe_dev_only={{
            default: new HttpAgent({ url: RUNTIME_URL }),
          }}
        >
          {/* Probe 2: Between CopilotKitProvider and AIAgent — Abe.Hu's position */}
          <div className="border-l-4 border-blue-400 pl-3">
            <div className="text-xs text-gray-500 font-semibold mb-2">
              Probe: INSIDE provider, ABOVE AIAgent (Abe.Hu's position)
            </div>
            <SidebarStateReader location="above-aiagent" />
          </div>

          <AIAgent>
            {/* Probe 3: Inside AIAgent, as children alongside the sidebar */}
            <div className="border-l-4 border-green-400 pl-3 mt-4">
              <div className="text-xs text-gray-500 font-semibold mb-2">
                Probe: INSIDE AIAgent (children)
              </div>
              <SidebarStateReader location="inside-aiagent" />
            </div>
          </AIAgent>
        </CopilotKitProvider>
      </CopilotChatConfigurationProvider>
    </div>
  );
}
