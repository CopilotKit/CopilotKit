import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import type { Ref } from "react";
import { A2UISource } from "./A2UISource";

function countComponents(operations: readonly unknown[]) {
  let count = 0;
  for (const operation of operations as Array<
    Record<string, { components?: unknown[] }>
  >) {
    count += operation.createSurface?.components?.length ?? 0;
    count += operation.updateComponents?.components?.length ?? 0;
  }
  return count;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The dark plate under a generated view: the A2UI operations the agent sent
 * for it, with a count and a Copy button.
 */
export function SourcePlate({
  operations,
  rejected,
  revealed,
  ref,
}: {
  operations: readonly unknown[];
  /** Operations the renderer refused, shown after the rest. */
  rejected: readonly unknown[];
  /** Whether any of the plate is on screen; hidden plates leave the tab order. */
  revealed: boolean;
  ref: Ref<HTMLDivElement>;
}) {
  const [copied, setCopied] = useState(false);
  const componentCount = useMemo(
    () => countComponents(operations),
    [operations],
  );
  const source = useMemo(
    () => (rejected.length ? { operations, rejected } : operations),
    [operations, rejected],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(operations, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions); the
      // source stays selectable in the plate.
    }
  };

  return (
    <div
      ref={ref}
      className="surface__source"
      aria-hidden={!revealed}
      inert={!revealed ? true : undefined}
    >
      <div className="surface__source-bar">
        <span className="surface__source-meta">
          A2UI v1.0 · {plural(operations.length, "operation")} ·{" "}
          {plural(componentCount, "component")}
        </span>
        <button type="button" className="surface__copy" onClick={copy}>
          {copied ? (
            <Check size={14} aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <A2UISource value={source} />
    </div>
  );
}
