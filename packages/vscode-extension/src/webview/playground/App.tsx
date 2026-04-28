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
  }>({ runtimeUrl: "", replayMode: false, fixtureName: null });
  const [mountErrors, setMountErrors] = React.useState<MountErrorPayload[]>([]);
  const [models, setModels] = React.useState<
    Array<{ id: string; name: string; family: string; vendor: string }>
  >([]);
  const [selectedModelId, setSelectedModelId] = React.useState("");

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
        });
      } else if (msg.type === "diagnostics") {
        setMountErrors(msg.errors);
      }
    });
    sendToExtension({ type: "ready" });
    return unsubscribe;
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
    <div className="playground-layout">
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
        onOpenSource={(filePath, line) =>
          sendToExtension({ type: "open-source", filePath, line })
        }
      />
      <DiagnosticsPanel
        mountErrors={mountErrors}
        runtimeUrl={sessionInfo.runtimeUrl || null}
        replayMode={sessionInfo.replayMode}
        fixtureName={sessionInfo.fixtureName}
      />
    </div>
  );
}
