import { afterEach, describe, expect, it } from "vitest";
import { chat } from "@tanstack/ai";
import { openaiText } from "./openai-text";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

async function captureRequest(config: Parameters<typeof openaiText>[1] = {}) {
  let request:
    | {
        url: string;
        body: Record<string, unknown>;
        authorization: string | null;
      }
    | undefined;
  const adapter = openaiText("gpt-6-luna", {
    ...config,
    fetch: async (input, init) => {
      request = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization"),
      };
      return new Response(
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"offline","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  for await (const _event of chat({
    adapter,
    messages: [{ role: "user", content: "Hello" }],
    modelOptions: { reasoning: { effort: "medium", summary: "auto" } },
  })) {
    // Consume the actual SDK stream; custom fetch keeps the test offline.
  }
  return request;
}

describe("OpenAI text adapter", () => {
  it("sends Luna and reasoning through Responses at the configured proxy", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    process.env.OPENAI_BASE_URL = "https://proxy.example/v1";
    const request = await captureRequest();
    expect(request?.url).toBe("https://proxy.example/v1/responses");
    expect(request?.body.model).toBe("gpt-6-luna");
    expect(request?.authorization).toBe("Bearer test-only");
    expect(request?.body.reasoning).toEqual({
      effort: "medium",
      summary: "auto",
    });
  });

  it("honors an explicit base URL and the OPENAI_KEY fallback", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_KEY = "test-only";
    process.env.OPENAI_BASE_URL = "https://env.example/v1";
    const request = await captureRequest({
      baseURL: "https://explicit.example/v1",
    });
    expect(request?.url).toBe("https://explicit.example/v1/responses");
    expect(request?.authorization).toBe("Bearer test-only");
  });
  it("uses the official Responses URL when no proxy is configured", async () => {
    delete process.env.OPENAI_BASE_URL;
    const request = await captureRequest({ apiKey: "explicit-test-only" });
    expect(request?.url).toBe("https://api.openai.com/v1/responses");
    expect(request?.authorization).toBe("Bearer explicit-test-only");
  });
});
