import * as React from "react";
import { ScannerView } from "./ScannerView";
import { onExtensionMessage, sendToExtension } from "./bridge";
import type { PlaygroundScanResult } from "../../extension/playground/types";

export function App(): React.JSX.Element {
  const [result, setResult] = React.useState<PlaygroundScanResult>({
    providers: [],
    componentsWithHooks: [],
    hookSites: [],
    warnings: [],
  });

  React.useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      if (msg.type === "scan-result") setResult(msg.result);
    });
    sendToExtension({ type: "ready" });
    return unsubscribe;
  }, []);

  return (
    <ScannerView
      result={result}
      onRefresh={() => sendToExtension({ type: "refresh" })}
      onOpenSource={(filePath, line) =>
        sendToExtension({ type: "open-source", filePath, line })
      }
    />
  );
}
