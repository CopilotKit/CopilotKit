import { ChevronRight } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { CSSProperties } from "react";

/**
 * The A2UI behind a view, as a tree that opens one level compressed: each
 * operation shows its kind and surface, and its data model and components
 * start folded into one-line summaries. Click a node to open it.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Nodes at this depth and deeper start folded: each operation opens as one
 * line naming what it does. */
const FOLD_DEPTH = 1;

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function componentName(value: Json) {
  return isObject(value) && typeof value.component === "string"
    ? value.component
    : undefined;
}

/** The headline of an operation: its kind and the surface it touches. */
function operationTitle(value: Json) {
  if (!isObject(value) || typeof value.version !== "string") return undefined;
  const kind = Object.keys(value).find((key) => key !== "version");
  if (!kind) return undefined;
  const payload = value[kind];
  if (!isObject(payload)) return { kind, detail: "" };
  const parts: string[] = [];
  if (typeof payload.surfaceId === "string") parts.push(payload.surfaceId);
  if (Array.isArray(payload.components)) {
    const names = payload.components.map(componentName).filter(Boolean);
    parts.push(names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : ""));
  }
  if (kind === "updateDataModel") {
    if (typeof payload.path === "string") parts.push(payload.path);
    const data = payload.value;
    if (data !== undefined && (isObject(data) || Array.isArray(data)))
      parts.push(`{ ${summary(data)} }`);
  }
  return { kind, detail: parts.filter(Boolean).join(" · ") };
}

/** A one-line description of a folded object or array. */
function summary(value: Json): string {
  if (Array.isArray(value)) {
    const names = value.map(componentName).filter(Boolean) as string[];
    if (names.length === value.length && names.length > 0) {
      const shown = names.slice(0, 4).join(", ");
      return `${value.length} · ${shown}${names.length > 4 ? ", …" : ""}`;
    }
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 4).join(", ");
    return `${shown}${keys.length > 4 ? ", …" : ""}`;
  }
  return "";
}

function Scalar({ value, isName }: { value: Json; isName?: boolean }) {
  if (typeof value === "string")
    return (
      <span className={`tok ${isName ? "tok--name" : "tok--string"}`}>
        {JSON.stringify(value)}
      </span>
    );
  if (typeof value === "number")
    return <span className="tok tok--number">{String(value)}</span>;
  return <span className="tok tok--literal">{String(value)}</span>;
}

interface NodeProps {
  name?: string;
  value: Json;
  path: string;
  depth: number;
  last: boolean;
  open: (path: string, depth: number) => boolean;
  toggle: (path: string, depth: number) => void;
}

function Node({ name, value, path, depth, last, open, toggle }: NodeProps) {
  const comma = last ? null : <span className="tok tok--punct">,</span>;
  const key =
    name === undefined ? null : (
      <>
        <span className="tok tok--key">{JSON.stringify(name)}</span>
        <span className="tok tok--punct">: </span>
      </>
    );

  if (!Array.isArray(value) && !isObject(value)) {
    return (
      <div className="jt-row" style={{ "--depth": depth } as CSSProperties}>
        <span className="jt-spacer" />
        {key}
        <Scalar value={value} isName={name === "component"} />
        {comma}
      </div>
    );
  }

  const isOpen = open(path, depth);
  const operation = operationTitle(value);
  const [openBrace, closeBrace] = Array.isArray(value)
    ? ["[", "]"]
    : ["{", "}"];
  const entries: [string | undefined, Json][] = Array.isArray(value)
    ? value.map((item) => [undefined, item])
    : Object.entries(value);

  return (
    <>
      <div className="jt-row" style={{ "--depth": depth } as CSSProperties}>
        <button
          type="button"
          className="jt-toggle"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Fold" : "Open"} ${name ?? operation?.kind ?? "list"}`}
          onClick={() => toggle(path, depth)}
        >
          <ChevronRight size={12} strokeWidth={2.25} aria-hidden />
        </button>
        {key}
        <span className="tok tok--punct">{openBrace}</span>
        {!isOpen && (
          <>
            <button
              type="button"
              className={
                operation ? "jt-summary jt-summary--operation" : "jt-summary"
              }
              tabIndex={-1}
              onClick={() => toggle(path, depth)}
            >
              {operation ? (
                <>
                  <span className="jt-op">{operation.kind}</span>
                  {operation.detail && ` ${operation.detail}`}
                </>
              ) : (
                summary(value)
              )}
            </button>
            <span className="tok tok--punct">{closeBrace}</span>
            {comma}
          </>
        )}
      </div>
      {isOpen && (
        <>
          {entries.map(([childName, child], index) => (
            <Node
              key={childName ?? index}
              name={childName}
              value={child}
              path={`${path}/${childName ?? index}`}
              depth={depth + 1}
              last={index === entries.length - 1}
              open={open}
              toggle={toggle}
            />
          ))}
          <div className="jt-row" style={{ "--depth": depth } as CSSProperties}>
            <span className="jt-spacer" />
            <span className="tok tok--punct">{closeBrace}</span>
            {comma}
          </div>
        </>
      )}
    </>
  );
}

export const A2UISource = memo(function A2UISource({
  value,
}: {
  value: unknown;
}) {
  // Paths the reader opened or folded, against the default depth rule.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const open = useCallback(
    (path: string, depth: number) => overrides.get(path) ?? depth < FOLD_DEPTH,
    [overrides],
  );
  const toggle = useCallback((path: string, depth: number) => {
    setOverrides((current) => {
      const next = new Map(current);
      next.set(path, !(current.get(path) ?? depth < FOLD_DEPTH));
      return next;
    });
  }, []);

  return (
    <div className="a2ui-source">
      <div className="a2ui-source__tree">
        <Node
          value={(value ?? null) as Json}
          path=""
          depth={0}
          last
          open={open}
          toggle={toggle}
        />
      </div>
    </div>
  );
});
