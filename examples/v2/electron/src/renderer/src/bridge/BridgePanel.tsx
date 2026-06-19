import { useEffect, useState } from "react";

type BridgeInfo = { port: number; token: string; connected: boolean };

export function BridgePanel() {
  const [info, setInfo] = useState<BridgeInfo | null>(null);

  useEffect(() => {
    void window.electron.bridge.getInfo().then(setInfo);
    const id = setInterval(
      () => void window.electron.bridge.getInfo().then(setInfo),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  if (!info) {
    return <div data-testid="bridge-panel">Starting browser bridge…</div>;
  }

  return (
    <div data-testid="bridge-panel">
      <h2>Browser bridge</h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          data-testid="bridge-status"
          aria-label={info.connected ? "connected" : "disconnected"}
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: info.connected ? "#16a34a" : "#9ca3af",
          }}
        />
        <span>{info.connected ? "connected" : "not connected"}</span>
      </div>
      <div style={{ marginBottom: 4 }}>
        Port: <code data-testid="bridge-port">{info.port}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        Token: <code data-testid="bridge-token">{info.token}</code>
      </div>
      <ol>
        <li>
          Open <code>chrome://extensions</code> in Chrome.
        </li>
        <li>
          Enable <strong>Developer mode</strong>, click{" "}
          <strong>Load unpacked</strong>, and select the <code>extension/</code>{" "}
          folder.
        </li>
        <li>
          Click the extension icon and enter the port and token shown above.
        </li>
      </ol>
    </div>
  );
}
