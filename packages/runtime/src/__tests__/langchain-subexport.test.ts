/**
 * Verifies that `@copilotkit/runtime/langchain` re-exports the real adapter
 * classes, NOT the deprecation shims that live at the root path. A future
 * refactor that mistakenly re-routes the subexport entry to the shims would
 * produce dist artifacts that still build, typecheck, and pass attw/publint,
 * but would deny users the very migration target the deprecation message
 * points them at. This test guards against that regression.
 */
import { describe, it, expect } from "vitest";

import {
  LangChainAdapter as ShimLangChainAdapter,
  BedrockAdapter as ShimBedrockAdapter,
  GoogleGenerativeAIAdapter as ShimGoogleGenerativeAIAdapter,
  RemoteChain as ShimRemoteChain,
} from "../service-adapters/langchain-deprecated-shims";
import {
  LangChainAdapter,
  BedrockAdapter,
  GoogleGenerativeAIAdapter,
  RemoteChain,
} from "../langchain";

describe("@copilotkit/runtime/langchain subexport", () => {
  it("re-exports the real LangChainAdapter, not the shim", () => {
    expect(LangChainAdapter).not.toBe(ShimLangChainAdapter);
  });

  it("re-exports the real BedrockAdapter, not the shim", () => {
    expect(BedrockAdapter).not.toBe(ShimBedrockAdapter);
  });

  it("re-exports the real GoogleGenerativeAIAdapter, not the shim", () => {
    expect(GoogleGenerativeAIAdapter).not.toBe(ShimGoogleGenerativeAIAdapter);
  });

  it("re-exports the real RemoteChain, not the shim", () => {
    expect(RemoteChain).not.toBe(ShimRemoteChain);
  });

  it("real RemoteChain does not throw the deprecation error on construction", () => {
    let caught: Error | undefined;
    try {
      // RemoteChain takes a config but the real constructor accepts an empty
      // call too (it throws its own error if misconfigured at use time, not
      // here). What matters: the message must not be the deprecation throw.
      new (RemoteChain as unknown as { new (): unknown })();
    } catch (err) {
      caught = err as Error;
    }
    if (caught) {
      expect(caught.message).not.toContain(
        "is no longer exported from '@copilotkit/runtime'",
      );
    }
  });
});
