import React, { useState } from "react";

interface ConnectionBarProps {
  status: "connected" | "disconnected" | "connecting";
  error: string | null;
  onConnect: (runtimeUrl: string) => void;
  onDisconnect: () => void;
  onClear: () => void;
}

const statusDot: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  disconnected: "bg-red-500",
};

export function ConnectionBar({
  status,
  error,
  onConnect,
  onDisconnect,
  onClear,
}: ConnectionBarProps) {
  const [url, setUrl] = useState("http://localhost:4000/api/copilotkit");

  return (
    <div className="border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot[status]}`}
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Runtime URL"
          className="flex-1 px-2 py-1 text-sm bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded font-mono"
          disabled={status !== "disconnected"}
        />
        {status === "disconnected" ? (
          <button
            onClick={() => onConnect(url)}
            className="px-3 py-1 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)]"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={onDisconnect}
            className="px-3 py-1 text-sm bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] rounded hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
          >
            Disconnect
          </button>
        )}
        <button
          onClick={onClear}
          className="px-3 py-1 text-sm bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] rounded hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
        >
          Clear
        </button>
      </div>
      {error && (
        <div className="px-3 pb-2 text-xs text-red-400 font-mono">{error}</div>
      )}
    </div>
  );
}
