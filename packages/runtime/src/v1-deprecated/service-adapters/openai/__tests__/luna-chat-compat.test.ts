import { describe, expect, it, vi } from "vitest";
import { OpenAIAdapter } from "../openai-adapter";
import type OpenAI from "openai";

describe("OpenAIAdapter Luna requests", () => {
  it.each([undefined, "gpt-6-luna", "gpt-4o"])(
    "keeps Chat tool calling compatible for %s",
    async (model) => {
      const stream = vi.fn((_request: any) => []);
      const adapter = new OpenAIAdapter({
        model,
        openai: { chat: { completions: { stream } } } as unknown as OpenAI,
      });
      await adapter.process({
        messages: [],
        actions: [],
        eventSource: { stream: vi.fn() },
      } as any);
      expect(stream).toHaveBeenCalledOnce();
      const request = stream.mock.calls[0][0] as any;
      expect(request.model).toBe(model ?? "gpt-6-luna");
      expect(request.reasoning_effort).toBe(
        model === "gpt-4o" ? undefined : "none",
      );
    },
  );
});
