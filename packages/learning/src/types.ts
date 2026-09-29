import type {
  SanitizedRequestBody,
  SanitizedResponseBody,
} from "./request-data";

export type ProductRequestBody = SanitizedRequestBody;
export type ProductResponseBody = SanitizedResponseBody;

export interface ProductObjectReference {
  /** Zero-based nonempty pathname segment. Raw identifiers are never included. */
  pathSegment: number;
  reference: string;
}

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
    /** Filtered current field content, also subject to the context byte budget. */
    text?: ProductInteractionText;
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
  /** Scopes ephemeral object aliases to this capture instance; absent on legacy/manual events. */
  captureId?: string;
  /** Optional for older/manual events. Requests retain the page at initiation. */
  page?: ProductPageContext;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

/** Filtered observed text; field observations do not establish application persistence. */
export type ProductInteractionText =
  | { value: string }
  | {
      omitted:
        | "sensitive-content"
        | "sensitive-field"
        | "size-limit"
        | "in-progress";
    };

export type ProductInteractionEvent = ProductEventBase &
  (
    | {
        type: "interaction";
        actionId: string;
        action:
          | "click"
          | "change"
          | "submit"
          | "shortcut"
          | "dragstart"
          | "drop"
          | "selection";
        target: ProductInteractionTarget;
        /** Bounded committed control text or a public selection; never a keystroke stream. */
        text?: ProductInteractionText;
        /** Earlier observed state, never an inferred application value. */
        previous?: {
          text?: ProductInteractionText;
          state?: ProductControlState;
        };
        /** Only a bounded command-key vocabulary; never ordinary typing. */
        shortcut?: string;
        dragSource?: ProductInteractionTarget;
        context?: ProductInteractionContext;
      }
    | {
        type: "request";
        actionId: string;
        request: {
          method: string;
          /** Allowed origin plus filtered pathname; sensitive segments redact, query/hash omitted. */
          url: string;
          /** Optional on older events. Continuations are observational correlations, not causal proof. */
          attribution?: "user-action" | "response-continuation";
          /** Prior captured request whose response/body settlement opened this continuation. */
          parentRequestId?: string;
          /** Bounded JSON request fields; no headers, streams or binary content. */
          body?: ProductRequestBody;
          references?: ProductObjectReference[];
          status?: number;
          durationMs: number;
          outcome: "success" | "error" | "aborted";
        };
      }
    | {
        type: "response";
        actionId: string;
        requestId: string;
        /** Filtered JSON consumed by the application; headers and streams are not read. */
        response: {
          method: string;
          url: string;
          body: ProductResponseBody;
          references?: ProductObjectReference[];
        };
      }
    | {
        type: "dom-change";
        actionId: string;
        changes: { added: number; removed: number; attributes: number };
        /** Updated target state/name observed at the end of the immediate action. */
        target?: ProductInteractionTarget;
        /** Updated semantic snapshot, present only when its contents changed. */
        context?: ProductInteractionContext;
      }
    | ({
        /** A later observation, not a claim that the request caused the UI state. */
        type: "context";
        context: ProductInteractionContext;
      } & (
        | { trigger: "request-completed"; actionId: string; requestId: string }
        | {
            trigger: "initial" | "navigation" | "screen-change";
            actionId?: never;
            requestId?: never;
          }
      ))
  );

export interface ProductInteractionCaptureOptions {
  onEvent: (event: ProductInteractionEvent) => void | Promise<void>;
  enabled?: boolean;
  /** Defaults to true. Captures direct user requests and bounded response continuations. */
  captureRequests?: boolean;
  /** Defaults to true. Filtered JSON-string bodies; also disabled by either text privacy switch. */
  captureRequestBodies?: boolean;
  /** Defaults to true. Filtered application-consumed JSON; disabled by either text privacy switch. */
  captureResponseBodies?: boolean;
  /** Defaults to same-origin /api. Absolute prefixes explicitly allow other origins. */
  apiUrlPrefixes?: readonly string[];
  /** Exclusions win over inclusions. Include your event ingestion/runtime URLs. */
  excludedUrlPrefixes?: readonly string[];
  /** Defaults to true. Captures immediate structural counts and semantic outcomes. */
  captureDomChanges?: boolean;
  /** Defaults to true. Includes semantic context on actions and bounded standalone screen observations. */
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
