"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonTreeProps {
  value: unknown;
  name?: string;
  depth?: number;
  defaultOpen?: boolean;
}

function isExpandable(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

export function JsonTree({
  value,
  name,
  depth = 0,
  defaultOpen = false,
}: JsonTreeProps) {
  const [open, setOpen] = useState(defaultOpen || depth < 1);

  if (!isExpandable(value)) {
    return (
      <div className="openbox-feed-json-leaf">
        {name ? <span className="openbox-feed-json-key">{name}:</span> : null}
        <span className="openbox-feed-json-value">{formatScalar(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="openbox-feed-json-node">
      <button
        type="button"
        className="openbox-feed-json-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
        {name ? <span className="openbox-feed-json-key">{name}</span> : null}
        <span className="openbox-feed-json-summary">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {open ? (
        <div className={cn("openbox-feed-json-children")}>
          {entries.map(([key, child]) => (
            <JsonTree key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}
