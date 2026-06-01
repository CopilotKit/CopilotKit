import { useEffect, useRef } from "react";

interface ToolReasoningProps {
  name: string;
  args?: object | unknown;
  status: string;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value).length} keys}`;
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

export function ToolReasoning({ name, args, status }: ToolReasoningProps) {
  const entries = args ? Object.entries(args as Record<string, unknown>) : [];
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const isRunning = status === "executing" || status === "inProgress";

  // Auto-open while executing, auto-close when complete
  useEffect(() => {
    if (!detailsRef.current) return;
    detailsRef.current.open = isRunning;
  }, [isRunning]);

  const statusIcon = isRunning ? (
    <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--muted)] border-t-[var(--foreground)]" />
  ) : (
    <svg
      className="h-3 w-3 text-emerald-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div className="my-1.5">
      {entries.length > 0 ? (
        <details ref={detailsRef} open className="group">
          <summary className="flex items-center gap-2 cursor-pointer list-none text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            {statusIcon}
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <span
              className="font-medium"
              style={{ fontFamily: "var(--font-code)" }}
            >
              {name}
            </span>
            <svg
              className="h-3 w-3 ml-auto transition-transform group-open:rotate-180"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <div className="ml-5 mt-1.5 rounded-md bg-[var(--secondary)] px-3 py-2 space-y-1">
            {entries.map(([key, value]) => (
              <div
                key={key}
                className="flex gap-2 min-w-0 text-xs"
                style={{ fontFamily: "var(--font-code)" }}
              >
                <span className="text-[var(--muted-foreground)] shrink-0">
                  {key}:
                </span>
                <span className="text-[var(--foreground)] truncate">
                  {formatValue(value)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          {statusIcon}
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span
            className="font-medium"
            style={{ fontFamily: "var(--font-code)" }}
          >
            {name}
          </span>
        </div>
      )}
    </div>
  );
}
