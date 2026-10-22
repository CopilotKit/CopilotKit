import { describe, it, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";

import { createCopilotkitMiddleware } from "../middleware";
import { withForwardedHeaders } from "../../header-propagation";

describe("forwarded request headers", () => {
  it("never override headers the developer set on the model", async () => {
    const middleware = createCopilotkitMiddleware();
    const request = {
      state: {},
      model: {},
      tools: [],
      messages: [],
      runtime: {},
      modelSettings: { headers: { "x-api-key": "developer-key" } },
    };
    let received: { modelSettings?: { headers?: Record<string, string> } } =
      request;
    await withForwardedHeaders(
      { "x-api-key": "caller-key", "x-aimock-test": "1" },
      () =>
        middleware.wrapModelCall(request as never, async (req) => {
          received = req;
          return new AIMessage("ok");
        }),
    );
    expect(received.modelSettings?.headers).toEqual({
      "x-api-key": "developer-key",
      "x-aimock-test": "1",
    });
  });

  it("resolves header conflicts regardless of case", async () => {
    const middleware = createCopilotkitMiddleware();
    const request = {
      state: {},
      model: {},
      tools: [],
      messages: [],
      runtime: {},
      modelSettings: { headers: { "X-Api-Key": "developer-key" } },
    };
    let received: { modelSettings?: { headers?: Record<string, string> } } =
      request;
    await withForwardedHeaders({ "x-api-key": "caller-key" }, () =>
      middleware.wrapModelCall(request as never, async (req) => {
        received = req;
        return new AIMessage("ok");
      }),
    );
    expect(received.modelSettings?.headers).toEqual({
      "X-Api-Key": "developer-key",
    });
  });
});
