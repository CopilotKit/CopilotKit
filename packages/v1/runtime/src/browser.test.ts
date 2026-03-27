import { describe, expect, it } from "vitest";
import {
  BedrockAdapter,
  ExperimentalOllamaAdapter,
  GoogleGenerativeAIAdapter,
  LangChainAdapter,
  RemoteChain,
} from "./browser-stubs";

describe("browser entry", () => {
  it("keeps LangChain-backed adapters out of browser bundles", () => {
    expect(() => new LangChainAdapter()).toThrow(
      /not available in browser bundles/i,
    );
    expect(() => new GoogleGenerativeAIAdapter()).toThrow(
      /not available in browser bundles/i,
    );
    expect(() => new BedrockAdapter()).toThrow(
      /not available in browser bundles/i,
    );
    expect(() => new ExperimentalOllamaAdapter()).toThrow(
      /not available in browser bundles/i,
    );
    expect(() => new RemoteChain()).toThrow(/not available in browser bundles/i);
  });
});
