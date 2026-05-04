import * as React from "react";
import { MountedComponentsPanel } from "./MountedComponentsPanel";
import { ChatSurface } from "./ChatSurface";
import { ConversationSidebar } from "./ConversationSidebar";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import {
  executePlaygroundBundle,
  type PlaygroundBundleExports,
} from "./bundle-loader";
import { onExtensionMessage, sendToExtension } from "./bridge";
import type { PlaygroundScanResult } from "../../extension/playground/types";
import type { MountErrorPayload } from "../../extension/playground/bridge-types";
import type { FixtureListEntry } from "../../extension/playground/fixture-store";

export function App(): React.JSX.Element {
  const [result, setResult] = React.useState<PlaygroundScanResult>({
    providers: [],
    componentsWithHooks: [],
    hookSites: [],
    warnings: [],
  });
  const [bundle, setBundle] = React.useState<PlaygroundBundleExports | null>(
    null,
  );
  const [bundleError, setBundleError] = React.useState<string | null>(null);
  const [stateBanner, setStateBanner] = React.useState<{
    message: string;
  } | null>(null);
  const [fixtures, setFixtures] = React.useState<FixtureListEntry[]>([]);
  const [sessionInfo, setSessionInfo] = React.useState<{
    runtimeUrl: string;
    replayMode: boolean;
    fixtureName: string | null;
    vscodeLmTools: { enabled: boolean; count: number };
    tailwind?: { entryCss?: string; skipped?: string; error?: string };
  }>({
    runtimeUrl: "",
    replayMode: false,
    fixtureName: null,
    vscodeLmTools: { enabled: false, count: 0 },
  });
  const [mountErrors, setMountErrors] = React.useState<MountErrorPayload[]>([]);
  const [models, setModels] = React.useState<
    Array<{ id: string; name: string; family: string; vendor: string }>
  >([]);
  const [selectedModelId, setSelectedModelId] = React.useState("");

  // Collapse state for the side panels — persisted so users who don't
  // need them keep their full chat width across reloads. The classes
  // applied to .playground-layout drive the CSS that hides each panel
  // and zeroes its column width.
  const MOUNTED_COLLAPSED_KEY = "copilotkit.playground.mounted-collapsed";
  const SIDEBAR_COLLAPSED_KEY = "copilotkit.playground.sidebar-collapsed";
  const [mountedCollapsed, setMountedCollapsed] = React.useState<boolean>(
    () => window.localStorage.getItem(MOUNTED_COLLAPSED_KEY) === "1",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  );
  const toggleMountedCollapsed = React.useCallback(() => {
    setMountedCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(MOUNTED_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);
  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  React.useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      if (msg.type === "scan-result") setResult(msg.result);
      else if (msg.type === "bundle-ready") {
        setStateBanner(null);
        setBundleError(null);
        executePlaygroundBundle(msg.payload.code, msg.payload.css).then(
          (exports) => setBundle(exports),
          (err) => {
            setBundle(null);
            setBundleError(err instanceof Error ? err.message : String(err));
          },
        );
      } else if (msg.type === "bundle-error") {
        setBundleError(msg.message);
        setBundle(null);
      } else if (msg.type === "mode-unsupported") {
        setStateBanner({
          message:
            msg.kind === "proxy"
              ? `Proxy mode unsupported — change runtimeUrl to a relative path. Current: ${msg.detail ?? ""}`
              : `Dynamic runtimeUrl unsupported: ${msg.detail ?? ""}`,
        });
        setBundle(null);
        setBundleError(null);
      } else if (msg.type === "no-model-available") {
        setStateBanner({
          message:
            "No language model available. Install GitHub Copilot or another VS Code language-model provider extension and reload.",
        });
        setBundle(null);
        setBundleError(null);
      } else if (msg.type === "models-list") {
        setModels(msg.models);
        if (msg.models[0]) {
          setSelectedModelId((prev) => prev || msg.models[0].id);
        }
      } else if (msg.type === "runtime-error") {
        setStateBanner({ message: `Runtime error: ${msg.message}` });
        setBundle(null);
        setBundleError(null);
      } else if (msg.type === "fixtures-list") {
        setFixtures(msg.fixtures);
      } else if (msg.type === "session-info") {
        setSessionInfo({
          runtimeUrl: msg.runtimeUrl,
          replayMode: msg.replayMode,
          fixtureName: msg.fixtureName,
          vscodeLmTools: msg.vscodeLmTools,
          tailwind: msg.tailwind,
        });
      } else if (msg.type === "diagnostics") {
        setMountErrors(msg.errors);
      } else if (msg.type === "play-fixture") {
        // Forward the recorded conversation to the bundled chat surface.
        // We use a window CustomEvent because PlaygroundChat is generated
        // into the rolldown'd bundle and doesn't share a React context with
        // this shell — a global event bus is the simplest cross-bundle
        // wiring.
        window.dispatchEvent(
          new CustomEvent("copilotkit-playground-replay", {
            detail: { messages: msg.messages },
          }),
        );
      }
    });
    sendToExtension({ type: "ready" });
    return unsubscribe;
  }, []);

  // Forward "click tool name" events from the bundled chat surface to
  // the extension. The chat lives inside the rolldown'd bundle and
  // dispatches a CustomEvent on window since it can't postMessage to
  // the extension itself.
  React.useEffect(() => {
    const onOpenTool = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ name: string }>).detail;
      if (detail?.name) {
        sendToExtension({ type: "open-tool-source", name: detail.name });
      }
    };
    window.addEventListener("copilotkit-playground-open-tool", onOpenTool);
    return () =>
      window.removeEventListener("copilotkit-playground-open-tool", onOpenTool);
  }, []);

  // Poll window.__copilotkit_playground_errors so the diagnostics panel
  // reflects new mount errors without requiring a full round-trip through
  // the extension host. The bundle's ErrorBoundary writes into this array.
  React.useEffect(() => {
    const tick = (): void => {
      const w = window as unknown as {
        __copilotkit_playground_errors?: MountErrorPayload[];
      };
      const arr = w.__copilotkit_playground_errors;
      if (arr && arr.length !== mountErrors.length) {
        setMountErrors([...arr]);
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mountErrors.length]);

  return (
    <div
      className={
        "playground-layout" +
        (mountedCollapsed ? " is-mounted-collapsed" : "") +
        (sidebarCollapsed ? " is-sidebar-collapsed" : "")
      }
    >
      {stateBanner && (
        <div role="alert" className="playground-state-banner">
          {stateBanner.message}
        </div>
      )}
      <ConversationSidebar
        fixtures={fixtures}
        currentFixtureName={sessionInfo.fixtureName}
        replayMode={sessionInfo.replayMode}
        models={models}
        selectedModelId={selectedModelId}
        collapsed={sidebarCollapsed}
        onSelectModel={(id) => {
          setSelectedModelId(id);
          sendToExtension({ type: "select-model", id });
        }}
        onNewChat={() => sendToExtension({ type: "new-chat" })}
        onLoad={(filePath) =>
          sendToExtension({ type: "load-fixture", filePath })
        }
        onSave={(name) => sendToExtension({ type: "save-fixture", name })}
        onDelete={(filePath) =>
          sendToExtension({ type: "delete-fixture", filePath })
        }
      />
      {bundle ? (
        <ChatSurface bundle={bundle} />
      ) : bundleError ? (
        <div className="playground-chat playground-chat-status">
          <div role="alert" className="playground-bundle-error">
            <strong>Bundle failed</strong>
            <p>{bundleError}</p>
          </div>
        </div>
      ) : (
        <div className="playground-chat playground-chat-status">
          <div className="playground-spinner" aria-hidden="true" />
          <p className="muted">Preparing chat surface…</p>
        </div>
      )}
      <MountedComponentsPanel
        bundle={bundle}
        bundleError={bundleError}
        scan={result}
        mountErrors={mountErrors}
        collapsed={mountedCollapsed}
        onOpenSource={(filePath, line) =>
          sendToExtension({ type: "open-source", filePath, line })
        }
      />
      <button
        type="button"
        className="playground-sidebar-toggle"
        aria-label={
          sidebarCollapsed
            ? "Show conversations panel"
            : "Hide conversations panel"
        }
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "Show conversations" : "Hide conversations"}
        onClick={toggleSidebarCollapsed}
      >
        {sidebarCollapsed ? "▸" : "◂"}
      </button>
      <button
        type="button"
        className="playground-mounted-toggle"
        aria-label={
          mountedCollapsed ? "Show components panel" : "Hide components panel"
        }
        aria-expanded={!mountedCollapsed}
        title={mountedCollapsed ? "Show components" : "Hide components"}
        onClick={toggleMountedCollapsed}
      >
        {mountedCollapsed ? "◂" : "▸"}
      </button>
      <DiagnosticsPanel
        mountErrors={mountErrors}
        runtimeUrl={sessionInfo.runtimeUrl || null}
        replayMode={sessionInfo.replayMode}
        fixtureName={sessionInfo.fixtureName}
        vscodeLmTools={sessionInfo.vscodeLmTools}
        tailwind={sessionInfo.tailwind}
      />
    </div>
  );
}
