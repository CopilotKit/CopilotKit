import type { SanitizedRequestBody } from "./request-data";

export type ProductRequestBody = SanitizedRequestBody;

export interface ProductControlState {
  checked?: boolean | "mixed";
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
  /** Filtered visible labels of at most four selected options, never their values. */
  selectedOptions?: string[];
}

export interface ProductInteractionTarget {
  tagName: string;
  /** An explicit or inferred accessibility role, never the element's text. */
  role?: string;
  /** Filtered accessible markup/text; disabled by captureAccessibleNames: false. */
  accessibleName?: string;
  /** Filtered control name, never its value. */
  name?: string;
  /** Filtered application-authored data-learning-id. */
  learningId?: string;
  /** State observed at this timestamp, not an inferred previous value. */
  state?: ProductControlState;
}

export interface ProductInteractionContext {
  /** At most eight semantic elements, with a 2 KiB serialized context budget. */
  items: (ProductInteractionTarget & {
    kind: "heading" | "region" | "group" | "status" | "content" | "control";
  })[];
  /** The node, item or byte budget prevented a complete semantic observation. */
  truncated?: true;
}

/** Observed page pathname only; no origin, query, fragment or title. */
export type ProductPageContext =
  | { pathname: string; redacted?: true }
  | { omitted: "size-limit" | "unsupported-location" };

interface ProductEventBase {
  id: string;
  /** Shared by the user action and its correlated requests/DOM outcomes. */
  actionId: string;
  /** Optional for older/manual events. Requests retain the page at initiation. */
  page?: ProductPageContext;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

/** Text observed at a native field change; this does not establish application persistence. */
export type ProductInteractionText =
  | { value: string }
  | { omitted: "sensitive-content" | "sensitive-field" | "size-limit" };

export type ProductInteractionEvent = ProductEventBase &
  (
    | {
        type: "interaction";
        action: "click" | "change" | "submit";
        target: ProductInteractionTarget;
        /** Bounded text on native text-field changes only; never a keystroke stream. */
        text?: ProductInteractionText;
        context?: ProductInteractionContext;
      }
    | {
        type: "request";
        request: {
          method: string;
          /** Allowed origin plus filtered pathname; sensitive segments redact, query/hash omitted. */
          url: string;
          /** Optional on older events. Continuations are observational correlations, not causal proof. */
          attribution?: "user-action" | "response-continuation";
          /** Prior captured request whose response/body settlement opened this continuation. */
          parentRequestId?: string;
          /** Bounded JSON request fields; no headers, response bodies, streams or binary content. */
          body?: ProductRequestBody;
          status?: number;
          durationMs: number;
          outcome: "success" | "error" | "aborted";
        };
      }
    | {
        type: "dom-change";
        changes: { added: number; removed: number; attributes: number };
        /** Updated target state/name observed at the end of the immediate action. */
        target?: ProductInteractionTarget;
        /** Updated semantic snapshot, present only when its contents changed. */
        context?: ProductInteractionContext;
      }
    | {
        /** A later observation, not a claim that the request caused the UI state. */
        type: "context";
        trigger: "request-completed";
        requestId: string;
        context: ProductInteractionContext;
      }
  );

export interface ProductInteractionCaptureOptions {
  onEvent: (event: ProductInteractionEvent) => void | Promise<void>;
  enabled?: boolean;
  /** Defaults to true. Captures direct user requests and bounded response continuations. */
  captureRequests?: boolean;
  /** Defaults to true. Filtered JSON-string bodies; also disabled by either text privacy switch. */
  captureRequestBodies?: boolean;
  /** Defaults to same-origin /api. Absolute prefixes explicitly allow other origins. */
  apiUrlPrefixes?: readonly string[];
  /** Exclusions win over inclusions. Include your event ingestion/runtime URLs. */
  excludedUrlPrefixes?: readonly string[];
  /** Defaults to true. Captures immediate structural counts and semantic outcomes. */
  captureDomChanges?: boolean;
  /** Defaults to true. Includes bounded semantic context with trusted actions. */
  captureContext?: boolean;
  /** Defaults to true. Adds a bounded, filtered pathname; false omits page metadata. */
  capturePage?: boolean;
  /** Defaults to true. Includes filtered text at native text/search/textarea changes. */
  captureTextValues?: boolean;
  /** Defaults to true. False omits labels, context and changed text, retaining finite state. */
  captureAccessibleNames?: boolean;
  /** Defaults to 120, capped at 1,000; covers all emitted event types. */
  maxEventsPerMinute?: number;
  /** Defaults to 5, capped at 20. */
  maxRequestsPerAction?: number;
}
