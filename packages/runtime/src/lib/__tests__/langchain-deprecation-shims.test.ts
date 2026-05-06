/**
 * Pins the user-facing UX of the LangChain deprecation shims at
 * `service-adapters/langchain-deprecated-shims.ts`. The error message
 * thrown on construction is the entire surface a user upgrading to 1.58.0
 * will see, so each piece (new path, codemod URL, BuiltInAgent pointer,
 * the symbol's own name) is asserted independently. A future refactor
 * that re-routes any of these to the real adapter would make these tests
 * fail.
 */
import { describe, it, expect } from "vitest";

import {
  LangChainAdapter,
  BedrockAdapter,
  GoogleGenerativeAIAdapter,
  RemoteChain,
} from "../../service-adapters/langchain-deprecated-shims";

const SHIM_CASES = [
  { name: "LangChainAdapter", Ctor: LangChainAdapter },
  { name: "BedrockAdapter", Ctor: BedrockAdapter },
  { name: "GoogleGenerativeAIAdapter", Ctor: GoogleGenerativeAIAdapter },
  { name: "RemoteChain", Ctor: RemoteChain },
] as const;

describe("LangChain deprecation shims (root path)", () => {
  for (const { name, Ctor } of SHIM_CASES) {
    describe(name, () => {
      let caught: Error | undefined;
      try {
        new (Ctor as unknown as { new (): unknown })();
      } catch (err) {
        caught = err as Error;
      }

      it("throws on construction", () => {
        expect(caught).toBeInstanceOf(Error);
      });

      it("includes the symbol name in the message", () => {
        expect(caught?.message).toContain(name);
      });

      it("points at the new subexport path", () => {
        expect(caught?.message).toContain("@copilotkit/runtime/langchain");
      });

      it("includes the jscodeshift codemod URL", () => {
        expect(caught?.message).toContain(
          "https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/langchain-subexport.cjs",
        );
      });

      it("points at BuiltInAgent as the v2 destination", () => {
        expect(caught?.message).toContain("BuiltInAgent");
      });
    });
  }
});
