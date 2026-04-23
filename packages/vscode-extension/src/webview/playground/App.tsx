import * as React from "react";
import { ScannerView } from "./ScannerView";
import { MountedComponentsPanel } from "./MountedComponentsPanel";
import {
  executePlaygroundBundle,
  type PlaygroundBundleExports,
} from "./bundle-loader";
import { onExtensionMessage, sendToExtension } from "./bridge";
import type { PlaygroundScanResult } from "../../extension/playground/types";

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
  const [stateBanner, setStateBanner] = React.useState<
    | {
        kind: "mode-unsupported";
        subKind: "proxy" | "dynamic-runtime-url";
        detail?: string;
      }
    | { kind: "llm-config-missing" }
    | { kind: "runtime-error"; message: string }
    | null
  >(null);

  React.useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      if (msg.type === "scan-result") {
        setResult(msg.result);
      } else if (msg.type === "bundle-ready") {
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
          kind: "mode-unsupported",
          subKind: msg.kind,
          detail: msg.detail,
        });
        setBundle(null);
        setBundleError(null);
      } else if (msg.type === "llm-config-missing") {
        setStateBanner({ kind: "llm-config-missing" });
        setBundle(null);
        setBundleError(null);
      } else if (msg.type === "runtime-error") {
        setStateBanner({ kind: "runtime-error", message: msg.message });
        setBundle(null);
        setBundleError(null);
      }
    });
    sendToExtension({ type: "ready" });
    return unsubscribe;
  }, []);

  function renderStateBanner(): React.JSX.Element | null {
    if (!stateBanner) return null;
    switch (stateBanner.kind) {
      case "mode-unsupported": {
        const message =
          stateBanner.subKind === "proxy"
            ? `Your <CopilotKit> provider points at ${stateBanner.detail ?? "an external runtime"}. Mode 1 (proxy to external runtime) isn't supported yet — change runtimeUrl to a relative path (e.g. "/api/copilotkit") to use the playground.`
            : `Your runtimeUrl is a dynamic expression (${stateBanner.detail ?? ""}). The playground can't use dynamic URLs — use a string literal instead.`;
        return (
          <div role="alert" className="playground-state-banner">
            <strong>Playground unavailable.</strong> {message}
          </div>
        );
      }
      case "llm-config-missing":
        return (
          <div role="alert" className="playground-state-banner">
            <strong>No LLM API key configured.</strong> Run the command{" "}
            <code>CopilotKit: Set Playground LLM API Key</code> from the Command
            Palette, or add <code>OPENAI_API_KEY</code> /{" "}
            <code>ANTHROPIC_API_KEY</code> to your workspace <code>.env</code>.
          </div>
        );
      case "runtime-error":
        return (
          <div role="alert" className="playground-state-banner">
            <strong>Runtime error:</strong> {stateBanner.message}
          </div>
        );
    }
  }

  return (
    <div className="playground-layout">
      {renderStateBanner()}
      <ScannerView
        result={result}
        onRefresh={() => sendToExtension({ type: "refresh" })}
        onOpenSource={(filePath, line) =>
          sendToExtension({ type: "open-source", filePath, line })
        }
      />
      <MountedComponentsPanel bundle={bundle} bundleError={bundleError} />
    </div>
  );
}
