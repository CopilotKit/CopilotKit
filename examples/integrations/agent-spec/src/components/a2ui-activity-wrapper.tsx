"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function getOperationSurfaceId(operation: unknown): string | null {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  if (
    "surfaceId" in operation &&
    typeof (operation as any).surfaceId === "string"
  ) {
    return (operation as any).surfaceId;
  }

  const op = operation as any;
  return (
    op?.beginRendering?.surfaceId ??
    op?.surfaceUpdate?.surfaceId ??
    op?.dataModelUpdate?.surfaceId ??
    op?.deleteSurface?.surfaceId ??
    null
  );
}

export function withA2UIActivityMessage(baseRenderer: any) {
  function A2UIActivityMessage(props: any) {
    const operations = props?.content?.operations as unknown[] | undefined;

    const surfaceCount = useMemo(() => {
      if (!Array.isArray(operations) || operations.length === 0) {
        return 0;
      }
      const ids = new Set<string>();
      for (const op of operations) {
        const id = getOperationSurfaceId(op);
        if (id) {
          ids.add(id);
        }
      }
      return ids.size || 1;
    }, [operations]);

    const activityLabel = useMemo(() => {
      if (!Array.isArray(operations) || operations.length === 0) return "Interactive UI";
      return surfaceCount > 1
        ? `Interactive UI \u00B7 ${surfaceCount} surfaces`
        : "Interactive UI";
    }, [operations, surfaceCount]);

    const [collapsed, setCollapsed] = useState(false);
    const [flash, setFlash] = useState(false);
    const lastSignatureRef = useRef<string | null>(null);

    const signature = useMemo(() => {
      if (!Array.isArray(operations)) {
        return null;
      }
      try {
        return JSON.stringify(operations);
      } catch {
        return String(operations.length);
      }
    }, [operations]);

    useEffect(() => {
      if (!signature) {
        lastSignatureRef.current = null;
        return;
      }

      if (lastSignatureRef.current && lastSignatureRef.current !== signature) {
        lastSignatureRef.current = signature;
        setFlash(true);
        const timeout = window.setTimeout(() => setFlash(false), 700);
        return () => window.clearTimeout(timeout);
      }

      lastSignatureRef.current = signature;
    }, [signature]);

    if (!Array.isArray(operations) || operations.length === 0) {
      return null;
    }

    const Inner = baseRenderer.render as any;
    const classes = [
      "a2ui-activity-message",
      collapsed ? "a2ui-activity-message--collapsed" : "",
      flash ? "a2ui-activity-message--flash" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={classes} data-a2ui-activity-message>
        <div className="a2ui-activity-header">
          <div className="a2ui-activity-header-left">
            <span className="a2ui-activity-dot" aria-hidden="true" />
            <span>{activityLabel}</span>
          </div>
          <button
            type="button"
            className="a2ui-activity-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
        <div className="a2ui-activity-body">
          <Inner {...props} />
        </div>
      </div>
    );
  }

  return {
    ...baseRenderer,
    render: A2UIActivityMessage,
  };
}

