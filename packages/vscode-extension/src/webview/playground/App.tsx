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
  const [bundle, setBundle] = React.useState<PlaygroundBundleExports | null>(null);
  const [bundleError, setBundleError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      if (msg.type === "scan-result") {
        setResult(msg.result);
      } else if (msg.type === "bundle-ready") {
        setBundleError(null);
        executePlaygroundBundle(msg.payload.code).then(
          (exports) => setBundle(exports),
          (err) => setBundleError(err instanceof Error ? err.message : String(err)),
        );
      } else if (msg.type === "bundle-error") {
        setBundleError(msg.message);
        setBundle(null);
      }
    });
    sendToExtension({ type: "ready" });
    return unsubscribe;
  }, []);

  return (
    <div className="playground-root">
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
