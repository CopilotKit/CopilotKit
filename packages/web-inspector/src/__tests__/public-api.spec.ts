import { describe, expect, expectTypeOf, it } from "vitest";

import * as inspectorApi from "../index.js";
import type {
  Anchor,
  InspectorOpenOptions,
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
  ThreadDebuggerProviderLoadOptions,
  ThreadDebuggerToolCall,
} from "../index.js";
import type { Anchor as InternalAnchor } from "../shell/contracts.js";
import { CpkThreadInspector as InternalCpkThreadInspector } from "../domains/threads/detail/thread-inspector.js";
import { defineWebInspector } from "../register.js";
import { WebInspectorElement } from "../shell/web-inspector-element.js";
import type { InspectorOpenOptions as InternalInspectorOpenOptions } from "../shell/web-inspector-element.js";
import type {
  ThreadDebuggerEvent as InternalThreadDebuggerEvent,
  ThreadDebuggerMessage as InternalThreadDebuggerMessage,
  ThreadDebuggerMetadata as InternalThreadDebuggerMetadata,
  ThreadDebuggerProvider as InternalThreadDebuggerProvider,
  ThreadDebuggerProviderLoadOptions as InternalThreadDebuggerProviderLoadOptions,
  ThreadDebuggerToolCall as InternalThreadDebuggerToolCall,
} from "../shared/thread-debugger/types.js";

type ExpectedAnchor = {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
};

type ExpectedInspectorOpenOptions = {
  threadId?: string;
  agentId?: string;
  messageId?: string;
};

type ExpectedThreadDebuggerProviderLoadOptions = { signal: AbortSignal };
type ExpectedThreadDebuggerToolCall = {
  id: string;
  name: string;
  args: string | Record<string, unknown>;
};
type ExpectedThreadDebuggerMessage = {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ExpectedThreadDebuggerToolCall[];
  toolCallId?: string;
  activityType?: string;
};
type ExpectedThreadDebuggerEvent = {
  type: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};
type ExpectedThreadDebuggerMetadata = {
  id: string;
  name?: string | null;
  agentId?: string | null;
  endUserId?: string | null;
  createdById?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};
type ExpectedThreadDebuggerProvider = {
  getThreadMetadata?: (
    threadId: string,
    options: ExpectedThreadDebuggerProviderLoadOptions,
  ) => Promise<ExpectedThreadDebuggerMetadata | null>;
  getMessages?: (
    threadId: string,
    options: ExpectedThreadDebuggerProviderLoadOptions,
  ) => Promise<ExpectedThreadDebuggerMessage[]>;
  getEvents?: (
    threadId: string,
    options: ExpectedThreadDebuggerProviderLoadOptions,
  ) => Promise<ExpectedThreadDebuggerEvent[]>;
  getState?: (
    threadId: string,
    options: ExpectedThreadDebuggerProviderLoadOptions,
  ) => Promise<Record<string, unknown> | null>;
};

describe("web inspector public API", () => {
  it("keeps the public runtime export surface stable", () => {
    expect(Object.keys(inspectorApi).sort()).toEqual([
      "CpkThreadInspector",
      "THREAD_INSPECTOR_TAG",
      "WEB_INSPECTOR_TAG",
      "WebInspectorElement",
      "configureWebInspectorElement",
      "defineWebInspector",
      "ɵCpkThreadDetails",
      "ɵbuildCapabilityRows",
      "ɵmaxRecallScore",
      "ɵnormalizeRelevance",
      "ɵrelevanceBarWidth",
    ]);
    expect(inspectorApi.defineWebInspector).toBe(defineWebInspector);
    expect(inspectorApi.WebInspectorElement).toBe(WebInspectorElement);
  });

  it("keeps public declarations wired to their implementation types", () => {
    expectTypeOf<Anchor>().toEqualTypeOf<InternalAnchor>();
    expectTypeOf<InspectorOpenOptions>().toEqualTypeOf<InternalInspectorOpenOptions>();
    expectTypeOf<ThreadDebuggerEvent>().toEqualTypeOf<InternalThreadDebuggerEvent>();
    expectTypeOf<ThreadDebuggerMessage>().toEqualTypeOf<InternalThreadDebuggerMessage>();
    expectTypeOf<ThreadDebuggerMetadata>().toEqualTypeOf<InternalThreadDebuggerMetadata>();
    expectTypeOf<ThreadDebuggerProvider>().toEqualTypeOf<InternalThreadDebuggerProvider>();
    expectTypeOf<ThreadDebuggerProviderLoadOptions>().toEqualTypeOf<InternalThreadDebuggerProviderLoadOptions>();
    expectTypeOf<ThreadDebuggerToolCall>().toEqualTypeOf<InternalThreadDebuggerToolCall>();
    expectTypeOf(inspectorApi.CpkThreadInspector).toEqualTypeOf(
      InternalCpkThreadInspector,
    );
    expectTypeOf(inspectorApi.WebInspectorElement).toEqualTypeOf(
      WebInspectorElement,
    );
  });

  it("keeps public declarations structurally compatible with the baseline", () => {
    expectTypeOf<Anchor>().toEqualTypeOf<ExpectedAnchor>();
    expectTypeOf<InspectorOpenOptions>().toEqualTypeOf<ExpectedInspectorOpenOptions>();
    expectTypeOf<ThreadDebuggerProviderLoadOptions>().toEqualTypeOf<ExpectedThreadDebuggerProviderLoadOptions>();
    expectTypeOf<ThreadDebuggerToolCall>().toEqualTypeOf<ExpectedThreadDebuggerToolCall>();
    expectTypeOf<ThreadDebuggerMessage>().toEqualTypeOf<ExpectedThreadDebuggerMessage>();
    expectTypeOf<ThreadDebuggerEvent>().toEqualTypeOf<ExpectedThreadDebuggerEvent>();
    expectTypeOf<ThreadDebuggerMetadata>().toEqualTypeOf<ExpectedThreadDebuggerMetadata>();
    expectTypeOf<ThreadDebuggerProvider>().toEqualTypeOf<ExpectedThreadDebuggerProvider>();
  });
});
