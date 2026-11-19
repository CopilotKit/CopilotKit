"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";
import type { A2UIOperation } from "@copilotkit/shared";
import { CANVAS_ID } from "./canvas";
import { useCanvasRepair } from "./use-canvas-repair";

/** One finished state of the canvas: the operations that draw it. */
export interface CanvasVersion {
  surfaceId: string;
  operations: A2UIOperation[];
  /** The operations as JSON, to tell a real change from a repeat. */
  signature: string;
}

/**
 * The canvas surface, and every version of it so far.
 *
 * A version is stored each time the agent finishes a render (the surface
 * goes from "streaming" to "ready"), unless some operations were rejected
 * and a repair is on its way: then the repaired canvas is stored instead.
 * `viewing` is the index of an older
 * version on screen, or `null` for the live canvas. A new render always
 * brings the live canvas back.
 */
export function useCanvasVersions() {
  const runtime = useGenerativeUIRuntime();
  if (!runtime) {
    throw new Error("useCanvasVersions needs <CopilotKit generativeUI={...}>");
  }
  const { manager } = runtime;
  // Re-render whenever any surface changes.
  useSyncExternalStore(
    manager.subscribe,
    manager.getVersion,
    manager.getVersion,
  );
  const surface = manager.getSurfaceForTarget(CANVAS_ID);
  const repairing = useCanvasRepair(surface);

  const [versions, setVersions] = useState<CanvasVersion[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);

  const status = surface?.status;
  const operations = surface?.operations;
  const surfaceId = surface?.surfaceId;

  useEffect(() => {
    if (status === "streaming") {
      setViewing(null);
      return;
    }
    if (status !== "ready" || repairing || !surfaceId || !operations?.length) {
      return;
    }
    const signature = JSON.stringify(operations);
    setVersions((previous) =>
      previous.at(-1)?.signature === signature
        ? previous
        : [
            ...previous,
            {
              surfaceId,
              operations: structuredClone(operations) as A2UIOperation[],
              signature,
            },
          ],
    );
  }, [status, repairing, operations, surfaceId]);

  return {
    surface,
    versions,
    viewing,
    setViewing,
    streaming: status === "streaming",
    repairing,
  };
}
