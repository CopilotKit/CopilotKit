import { cn } from "@/lib/cn";

export type RunStatus = "passed" | "failed" | "error" | "running" | "idle";

const LABEL: Record<RunStatus, string> = {
  passed: "Passing",
  failed: "Failing",
  error: "Broken",
  running: "Running",
  idle: "No test runs yet",
};

const TONE: Record<RunStatus, string> = {
  passed: "text-pass bg-pass/10 ring-pass/25",
  failed: "text-fail bg-fail/10 ring-fail/25",
  error: "text-warn bg-warn/10 ring-warn/25",
  running: "text-accent bg-accent/10 ring-accent/25",
  idle: "text-dim bg-tint-2 ring-line",
};

export function StatusPill({
  status,
  idleLabel,
  className,
}: {
  status: RunStatus;
  /** Replaces "No test runs yet" for panels that are not about tests. */
  idleLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[30px] items-center gap-2 rounded-full px-3 text-[14px] font-semibold tracking-wide uppercase ring-1 ring-inset",
        TONE[status],
        className,
      )}
    >
      <span
        className="size-2 rounded-full bg-current"
        style={
          status === "running"
            ? { animation: "pulse-dot 1.2s ease-in-out infinite" }
            : undefined
        }
      />
      {status === "idle" && idleLabel ? idleLabel : LABEL[status]}
    </span>
  );
}

/** Pass/fail split as one bar. */
export function TestBar({
  passed,
  failed,
  className,
}: {
  passed: number;
  failed: number;
  className?: string;
}) {
  const total = passed + failed;
  const passShare = total === 0 ? 0 : (passed / total) * 100;
  return (
    <div
      className={cn(
        "flex h-2 w-full overflow-hidden rounded-full bg-tint-3",
        className,
      )}
      role="img"
      aria-label={`${passed} passed, ${failed} failed`}
    >
      <div
        className="h-full bg-pass transition-[width] duration-700 ease-out"
        style={{ width: `${passShare}%` }}
      />
      {failed > 0 && (
        <div className="ml-px h-full flex-1 bg-fail" style={{ minWidth: 3 }} />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 animate-spin", className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <path
        d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
