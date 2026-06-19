import { useEffect, useState } from "react";

type McpServerStatus = {
  name: string;
  kind: "stdio" | "remote";
  enabled: boolean;
  status: "disabled" | "connecting" | "ready" | "error";
  toolNames: string[];
  logs: string[];
};

const STATUS_COLOR: Record<McpServerStatus["status"], string> = {
  ready: "#16a34a",
  connecting: "#d97706",
  error: "#dc2626",
  disabled: "#9ca3af",
};

export function McpPanel() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);

  useEffect(() => {
    void window.electron.mcp.listServers().then(setServers);
  }, []);

  if (servers.length === 0) {
    return <div data-testid="mcp-panel">No MCP servers configured.</div>;
  }

  return (
    <div data-testid="mcp-panel">
      <h2>MCP servers</h2>
      {servers.map((s) => (
        <div
          key={s.name}
          data-testid={`mcp-server-${s.name}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            aria-label={s.status}
            data-testid={`mcp-status-${s.name}`}
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: STATUS_COLOR[s.status],
            }}
          />
          <span>
            {s.name} ({s.kind}) — {s.status}
          </span>
          <input
            type="checkbox"
            checked={s.enabled}
            data-testid={`mcp-toggle-${s.name}`}
            onChange={async (e) =>
              setServers(
                await window.electron.mcp.setEnabled(s.name, e.target.checked),
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
