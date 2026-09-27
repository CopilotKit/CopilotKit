export interface ProductInteractionTarget {
  tagName: string;
  /** An explicit or inferred accessibility role, never the element's text. */
  role?: string;
  /** Filtered explicit aria-label or title; disabled by captureAccessibleNames: false. */
  accessibleName?: string;
  /** Filtered control name, never its value. */
  name?: string;
  /** Filtered application-authored data-learning-id. */
  learningId?: string;
}

interface ProductEventBase {
  id: string;
  /** Shared by the user action and its immediate requests/DOM outcomes. */
  actionId: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

export type ProductInteractionEvent = ProductEventBase &
  (
    | {
        type: "interaction";
        action: "click" | "change" | "submit";
        target: ProductInteractionTarget;
      }
    | {
        type: "request";
        request: {
          method: string;
          /** Origin plus matched API prefix; excludes dynamic paths, query and hash. */
          url: string;
          status?: number;
          durationMs: number;
          outcome: "success" | "error" | "aborted";
        };
      }
    | {
        type: "dom-change";
        changes: { added: number; removed: number; attributes: number };
      }
  );

export interface ProductInteractionCaptureOptions {
  onEvent: (event: ProductInteractionEvent) => void | Promise<void>;
  enabled?: boolean;
  /** Defaults to true. Only requests started in a trusted user event's task are eligible. */
  captureRequests?: boolean;
  /** Defaults to same-origin /api. Absolute prefixes explicitly allow other origins. */
  apiUrlPrefixes?: readonly string[];
  /** Exclusions win over inclusions. Include your event ingestion/runtime URLs. */
  excludedUrlPrefixes?: readonly string[];
  /** Defaults to true. Captures bounded counts, never DOM snapshots or text. */
  captureDomChanges?: boolean;
  /** Defaults to true. Reads filtered explicit aria-label/title, never text content. */
  captureAccessibleNames?: boolean;
  /** Defaults to 120, capped at 1,000; covers all emitted event types. */
  maxEventsPerMinute?: number;
  /** Defaults to 5, capped at 20. */
  maxRequestsPerAction?: number;
}
