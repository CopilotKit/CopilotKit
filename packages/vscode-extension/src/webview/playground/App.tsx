import * as React from "react";
import { ScannerView } from "./ScannerView";
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
import type {
  FixtureListEntry,
  MountErrorPayload,
} from "../../extension/playground/bridge-types";

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

  React.useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      if (msg.type === "scan-result") setResult(msg.result);
      else if (msg.type === "bundle-ready") {
        setStateBanner(null);
        setBundleError(null);
        executePlaygroundBundle(msg.payload.code).then(
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
      } else if (msg.type === "llm-config-missing") {
        setStateBanner({
          message:
            "Configure an LLM API key: run 'CopilotKit: Set Playground LLM API Key' or add OPENAI_API_KEY/ANTHROPIC_API_KEY to your workspace .env.",
        });
        setBundle(null);
        setBundleError(null);
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
      ) : (
        <div className="playground-chat">
          <ScannerView
            result={result}
            onRefresh={() => sendToExtension({ type: "refresh" })}
            onOpenSource={(filePath, line) =>
              sendToExtension({ type: "open-source", filePath, line })
            }
          />
        </div>
      )}
      <MountedComponentsPanel bundle={bundle} bundleError={bundleError} />
      <DiagnosticsPanel
        mountErrors={mountErrors}
        runtimeUrl={sessionInfo.runtimeUrl || null}
        replayMode={sessionInfo.replayMode}
        fixtureName={sessionInfo.fixtureName}
      />
    </div>
  );
}
