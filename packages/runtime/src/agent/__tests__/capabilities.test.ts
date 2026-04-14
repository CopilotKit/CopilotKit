import { describe, it, expect } from "vitest";
import { BuiltInAgent } from "../index";

describe("BuiltInAgent.getCapabilities", () => {
  it("should return default inferred capabilities", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
    });

    const capabilities = await agent.getCapabilities();

    expect(capabilities).toEqual({
      tools: {
        supported: true,
        clientProvided: true,
      },
      transport: {
        streaming: true,
      },
    });
  });

  it("should merge explicit overrides with inferred defaults", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      capabilities: {
        reasoning: {
          supported: true,
          streaming: true,
        },
        identity: {
          name: "my-agent",
          type: "custom",
        },
      },
    });

    const capabilities = await agent.getCapabilities();

    expect(capabilities).toEqual({
      tools: {
        supported: true,
        clientProvided: true,
      },
      transport: {
        streaming: true,
      },
      reasoning: {
        supported: true,
        streaming: true,
      },
      identity: {
        name: "my-agent",
        type: "custom",
      },
    });
  });

  it("should allow overrides to replace entire categories", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      capabilities: {
        tools: {
          supported: true,
          clientProvided: true,
          parallelCalls: true,
        },
      },
    });

    const capabilities = await agent.getCapabilities();

    expect(capabilities.tools).toEqual({
      supported: true,
      clientProvided: true,
      parallelCalls: true,
    });
    // transport still inferred
    expect(capabilities.transport).toEqual({ streaming: true });
  });
});
