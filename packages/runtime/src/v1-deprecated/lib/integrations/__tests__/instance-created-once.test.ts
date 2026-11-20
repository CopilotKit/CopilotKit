import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../../runtime/copilot-runtime";
import { ExperimentalEmptyAdapter } from "../../../service-adapters/empty/empty-adapter";
import telemetry from "../../telemetry-client";
import type { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNextJSAppRouterEndpoint } from "../nextjs/app-router";
import { copilotRuntimeNextJSPagesRouterEndpoint } from "../nextjs/pages-router";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import { copilotRuntimeNodeExpressEndpoint } from "../node-express";
import { copilotRuntimeNestEndpoint } from "../nest";

// `../shared` imports the GraphQL resolvers at load time. Their type-graphql
// decorators need emitted decorator metadata, which vitest does not produce.
// The single-route endpoints under test never use GraphQL.
vi.mock("../../../graphql/resolvers/copilot.resolver", () => ({
  CopilotResolver: class {},
}));
vi.mock("../../../graphql/resolvers/state.resolver", () => ({
  StateResolver: class {},
}));

/**
 * `oss.runtime.instance_created` must fire once per runtime, not once (or
 * twice, or three times) per HTTP request. Before this test, every v1 wrapper
 * captured the event itself AND built a v2 handler that captured it again, and
 * the Express / Nest / Pages Router wrappers added a third capture through
 * `copilotRuntimeNodeHttpEndpoint`, which also overwrote `runtime.framework`
 * with "node-http".
 */

const ENDPOINT = "/api/copilotkit";
const EVENT = "oss.runtime.instance_created";

type Build = (options: CreateCopilotRuntimeServerOptions) => {
  serve: (request: Request) => Promise<Response>;
};

const integrations: Array<{ name: string; framework: string; build: Build }> = [
  {
    name: "copilotRuntimeNextJSAppRouterEndpoint",
    framework: "nextjs-app-router",
    build: (options) => {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint(options);
      return {
        serve: (request) => handleRequest(request) as Promise<Response>,
      };
    },
  },
  {
    name: "copilotRuntimeNextJSPagesRouterEndpoint",
    framework: "nextjs-pages-router",
    build: (options) => {
      const handler = copilotRuntimeNextJSPagesRouterEndpoint(options);
      return { serve: (request) => handler(request) as Promise<Response> };
    },
  },
  {
    name: "copilotRuntimeNodeHttpEndpoint",
    framework: "node-http",
    build: (options) => {
      const handler = copilotRuntimeNodeHttpEndpoint(options);
      return { serve: (request) => handler(request) as Promise<Response> };
    },
  },
  {
    name: "copilotRuntimeNodeExpressEndpoint",
    framework: "node-express",
    build: (options) => {
      const handler = copilotRuntimeNodeExpressEndpoint(options);
      return { serve: (request) => handler(request) as Promise<Response> };
    },
  },
  {
    name: "copilotRuntimeNestEndpoint",
    framework: "nest",
    build: (options) => {
      const handler = copilotRuntimeNestEndpoint(options);
      return { serve: (request) => handler(request) as Promise<Response> };
    },
  },
];

function infoRequest(): Request {
  return new Request(`http://localhost${ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "info" }),
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeRuntime() {
  return new CopilotRuntime({
    // `info` needs a default agent. The agent is never run, so the URL is
    // never called.
    agents: { default: new HttpAgent({ url: "http://127.0.0.1:1/agent" }) },
    actions: [
      {
        name: "getWeather",
        description: "Get the weather",
        parameters: [],
        handler: async () => "sunny",
      },
    ],
  });
}

describe.each(integrations)("$name: oss.runtime.instance_created", (it_) => {
  let framework: unknown;
  let captures: Array<{ properties: unknown; framework: unknown }>;
  let setGlobalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    framework = undefined;
    captures = [];
    const original = telemetry.setGlobalProperties.bind(telemetry);
    setGlobalSpy = vi
      .spyOn(telemetry, "setGlobalProperties")
      .mockImplementation((properties: Record<string, any>) => {
        if (properties.runtime?.framework) {
          framework = properties.runtime.framework;
        }
        original(properties);
      });
  });

  afterEach(() => {
    setGlobalSpy.mockRestore();
  });

  function spyOnCaptures(runtime: CopilotRuntime) {
    vi.spyOn(runtime.telemetry, "capture").mockImplementation(
      async (event: string, properties: unknown) => {
        // Record the framework in effect when the event is sent.
        if (event === EVENT) captures.push({ properties, framework });
      },
    );
  }

  it("fires once for one endpoint that serves several requests, with the v1 payload and framework", async () => {
    const runtime = makeRuntime();
    spyOnCaptures(runtime);

    const { serve } = it_.build({
      runtime,
      serviceAdapter: new ExperimentalEmptyAdapter(),
      endpoint: ENDPOINT,
      cloud: { publicApiKey: "ck_pub_test" },
    } as CreateCopilotRuntimeServerOptions);

    for (let i = 0; i < 3; i++) {
      const response = await serve(infoRequest());
      expect(response.status).toBe(200);
      await response.text();
    }
    await settle();

    expect(captures).toHaveLength(1);
    expect(captures[0].framework).toBe(it_.framework);
    expect(captures[0].properties).toMatchObject({
      actionsAmount: 1,
      agentsAmount: 1,
      endpointsAmount: 0,
      endpointTypes: [],
      "cloud.api_key_provided": true,
      "cloud.public_api_key": "ck_pub_test",
    });
  });

  it("fires once per runtime when the endpoint is built per request", async () => {
    const runtime = makeRuntime();
    spyOnCaptures(runtime);

    for (let i = 0; i < 3; i++) {
      const { serve } = it_.build({
        runtime,
        serviceAdapter: new ExperimentalEmptyAdapter(),
        endpoint: ENDPOINT,
      } as CreateCopilotRuntimeServerOptions);
      const response = await serve(infoRequest());
      await response.text();
    }
    await settle();

    expect(captures).toHaveLength(1);
  });

  it("fires once for each distinct runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    spyOnCaptures(first);
    spyOnCaptures(second);

    for (const runtime of [first, second]) {
      it_.build({
        runtime,
        serviceAdapter: new ExperimentalEmptyAdapter(),
        endpoint: ENDPOINT,
      } as CreateCopilotRuntimeServerOptions);
    }
    await settle();

    expect(captures).toHaveLength(2);
  });
});
