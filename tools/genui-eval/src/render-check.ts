import { Worker } from "node:worker_threads";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";

/** What rendering one surface showed. */
export interface SurfaceCheck {
  surfaceId: string;
  /** The surface has a root and rendered without crashing. */
  rendered: boolean;
  /** Components that showed the error fallback (invalid props and the like). */
  errors: Array<{ componentId: string; message: string }>;
  /** Operations the client rejected when it ingested them. */
  rejected: string[];
  /** The component types of the surface. */
  components: string[];
  /** Every component only shows text: a surface that should be prose. */
  proseOnly: boolean;
  /** A render or ingest failure that took the whole surface down. */
  crash?: string;
  /** The reply deleted the surface on purpose: it is not part of the final UI. */
  deleted?: boolean;
}

export interface RenderRequest {
  id: number;
  surfaces: GenerativeUISurfaceContent[];
}

export interface RenderResult {
  id: number;
  surfaces: SurfaceCheck[];
  error?: string;
}

/**
 * Renders surfaces in a worker with jsdom, with the real surface manager
 * and SurfaceView. One worker serves every check of a run; call `close`
 * when done.
 */
export class RenderChecker {
  private worker: Worker;
  private ready: Promise<void>;
  private next = 0;
  private pending = new Map<number, (result: RenderResult) => void>();

  constructor() {
    this.worker = new Worker(
      new URL("./render-worker-boot.mjs", import.meta.url),
    );
    this.ready = new Promise((resolve, reject) => {
      this.worker.once("error", reject);
      this.worker.on(
        "message",
        (message: RenderResult | { ready: true } | { fatal: string }) => {
          if ("fatal" in message)
            return reject(
              new Error(`render worker failed to start: ${message.fatal}`),
            );
          if ("ready" in message) return resolve();
          this.pending.get(message.id)?.(message);
          this.pending.delete(message.id);
        },
      );
    });
  }

  /** The checks of `surfaces`, in order. */
  async check(surfaces: GenerativeUISurfaceContent[]): Promise<SurfaceCheck[]> {
    if (surfaces.length === 0) return [];
    await this.ready;
    const id = this.next++;
    const result = await new Promise<RenderResult>((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, surfaces } satisfies RenderRequest);
    });
    if (result.error) throw new Error(`render check failed: ${result.error}`);
    return result.surfaces;
  }

  async close() {
    await this.worker.terminate();
  }
}
