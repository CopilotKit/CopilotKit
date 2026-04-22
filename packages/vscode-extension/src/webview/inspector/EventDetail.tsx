import React, { useState } from "react";
import { getEventColors } from "./colors";
import type { DebugEventEnvelope } from "./types";

interface EventDetailProps {
  envelope: DebugEventEnvelope;
  firstTimestamp: number | null;
  onClose: () => void;
}

export function EventDetail({
  envelope,
  firstTimestamp,
  onClose,
}: EventDetailProps) {
  const colors = getEventColors(envelope.event.type);
  const relativeTime =
    firstTimestamp !== null
      ? `+${((envelope.timestamp - firstTimestamp) / 1000).toFixed(3)}s`
      : "0.000s";

  return (
    <div className="md:w-[400px] w-full border-t md:border-t-0 md:border-l border-[var(--vscode-panel-border)] flex flex-col bg-[var(--vscode-sideBar-background)] max-h-[50%] md:max-h-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--vscode-panel-border)]">
        <div className="flex items-center gap-2">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${colors.bg} ${colors.text}`}
          >
            {envelope.event.type}
          </span>
          <span className="text-xs text-gray-500 font-mono">
            {relativeTime}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-sm px-1"
        >
          ✕
        </button>
      </div>
      <div className="px-3 py-2 border-b border-[var(--vscode-panel-border)] text-xs font-mono">
        <div className="flex gap-4">
          <span className="text-gray-500">agent:</span>
          <span className="text-gray-300">{envelope.agentId}</span>
        </div>
        {envelope.threadId && (
          <div className="flex gap-4">
            <span className="text-gray-500">thread:</span>
            <span className="text-gray-300">{envelope.threadId}</span>
          </div>
        )}
        {envelope.runId && (
          <div className="flex gap-4">
            <span className="text-gray-500">run:</span>
            <span className="text-gray-300">{envelope.runId}</span>
          </div>
        )}
        <div className="flex gap-4">
          <span className="text-gray-500">time:</span>
          <span className="text-gray-300">
            {new Date(envelope.timestamp).toISOString()}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <JsonTree data={envelope.event} />
      </div>
    </div>
  );
}

function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-xs">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) return <span className="text-orange-300">null</span>;
  if (value === undefined)
    return <span className="text-gray-500">undefined</span>;
  if (typeof value === "boolean")
    return <span className="text-orange-300">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="text-green-300">{String(value)}</span>;
  if (typeof value === "string") {
    if (value.length > 200) {
      return (
        <span className="text-yellow-200">"{value.slice(0, 200)}..."</span>
      );
    }
    return <span className="text-yellow-200">"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-400">[]</span>;
    if (collapsed) {
      return (
        <span
          className="cursor-pointer text-gray-400 hover:text-gray-200"
          onClick={() => setCollapsed(false)}
        >
          [{value.length} items...]
        </span>
      );
    }
    return (
      <span>
        <span
          className="cursor-pointer text-gray-400 hover:text-gray-200"
          onClick={() => setCollapsed(true)}
        >
          [
        </span>
        <div className="ml-4">
          {value.map((item, i) => (
            <div key={i}>
              <JsonNode value={item} depth={depth + 1} />
              {i < value.length - 1 && <span className="text-gray-500">,</span>}
            </div>
          ))}
        </div>
        <span className="text-gray-400">]</span>
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0)
      return <span className="text-gray-400">{"{}"}</span>;
    if (collapsed) {
      return (
        <span
          className="cursor-pointer text-gray-400 hover:text-gray-200"
          onClick={() => setCollapsed(false)}
        >
          {"{"}
          {entries.length} keys...{"}"}
        </span>
      );
    }
    return (
      <span>
        <span
          className="cursor-pointer text-gray-400 hover:text-gray-200"
          onClick={() => setCollapsed(true)}
        >
          {"{"}
        </span>
        <div className="ml-4">
          {entries.map(([key, val], i) => (
            <div key={key}>
              <span className="text-blue-300">{key}</span>
              <span className="text-gray-500">: </span>
              <JsonNode value={val} depth={depth + 1} />
              {i < entries.length - 1 && (
                <span className="text-gray-500">,</span>
              )}
            </div>
          ))}
        </div>
        <span className="text-gray-400">{"}"}</span>
      </span>
    );
  }

  return <span className="text-gray-400">{String(value)}</span>;
}
