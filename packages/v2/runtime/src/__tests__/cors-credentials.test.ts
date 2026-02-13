import { describe, it, expect, vi } from "vitest";
import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "../endpoints";
import { CopilotRuntime } from "../runtime";
import type { AbstractAgent } from "@ag-ui/client";

const createMockRuntime = (options: { beforeRequestMiddleware?: any } = {}) => {
  const createMockAgent = () => {
    const agent: unknown = {
      execute: async () => ({ events: [] }),
    };
    (agent as { clone: () => unknown }).clone = () => createMockAgent();
    return agent as AbstractAgent;
  };

  return new CopilotRuntime({
    agents: { default: createMockAgent() },
    ...options,
  });
};

describe("CORS credentials configuration", () => {
  describe("createCopilotEndpoint", () => {
    it("sets Access-Control-Allow-Credentials header when credentials is true", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: "https://myapp.com",
          credentials: true,
        },
      });

      // Make a preflight OPTIONS request
      const request = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://myapp.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response = await endpoint.fetch(request);

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://myapp.com",
      );
    });

    it("does not set Access-Control-Allow-Credentials header when credentials is false", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: "https://myapp.com",
          credentials: false,
        },
      });

      const request = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://myapp.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response = await endpoint.fetch(request);

      // When credentials is false, the header should not be present or be "false"
      const credentialsHeader = response.headers.get(
        "Access-Control-Allow-Credentials",
      );
      expect(credentialsHeader === null || credentialsHeader === "false").toBe(
        true,
      );
    });

    it("defaults to no credentials when cors config is not provided", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        // No cors config - should default to origin: "*" without credentials
      });

      const request = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://somesite.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response = await endpoint.fetch(request);

      // Should allow any origin but not credentials
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const credentialsHeader = response.headers.get(
        "Access-Control-Allow-Credentials",
      );
      expect(credentialsHeader === null || credentialsHeader === "false").toBe(
        true,
      );
    });

    it("receives cookies in request when client sends them", async () => {
      const receivedCookies: string[] = [];

      const runtime = createMockRuntime({
        beforeRequestMiddleware: async ({ request }: { request: Request }) => {
          const cookie = request.headers.get("Cookie");
          if (cookie) {
            receivedCookies.push(cookie);
          }
          return undefined; // Don't modify the request
        },
      });

      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: "https://myapp.com",
          credentials: true,
        },
      });

      // Simulate a request with cookies (as a browser would send with credentials: "include")
      const request = new Request("https://example.com/info", {
        method: "GET",
        headers: {
          Origin: "https://myapp.com",
          Cookie: "session=abc123; user=john",
        },
      });

      const response = await endpoint.fetch(request);

      expect(response.status).toBe(200);
      expect(receivedCookies).toContain("session=abc123; user=john");
    });
  });

  describe("createCopilotEndpointSingleRoute", () => {
    it("sets Access-Control-Allow-Credentials header when credentials is true", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({
        runtime,
        basePath: "/api/copilotkit",
        cors: {
          origin: "https://myapp.com",
          credentials: true,
        },
      });

      const request = new Request("https://example.com/api/copilotkit", {
        method: "OPTIONS",
        headers: {
          Origin: "https://myapp.com",
          "Access-Control-Request-Method": "POST",
        },
      });

      const response = await endpoint.fetch(request);

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://myapp.com",
      );
    });

    it("receives cookies in POST request body", async () => {
      const receivedCookies: string[] = [];

      const runtime = createMockRuntime({
        beforeRequestMiddleware: async ({ request }: { request: Request }) => {
          const cookie = request.headers.get("Cookie");
          if (cookie) {
            receivedCookies.push(cookie);
          }
          return undefined;
        },
      });

      const endpoint = createCopilotEndpointSingleRoute({
        runtime,
        basePath: "/api/copilotkit",
        cors: {
          origin: "https://myapp.com",
          credentials: true,
        },
      });

      const request = new Request("https://example.com/api/copilotkit", {
        method: "POST",
        headers: {
          Origin: "https://myapp.com",
          "Content-Type": "application/json",
          Cookie: "auth_token=xyz789",
        },
        body: JSON.stringify({ method: "info" }),
      });

      const response = await endpoint.fetch(request);

      expect(response.status).toBe(200);
      expect(receivedCookies).toContain("auth_token=xyz789");
    });
  });

  describe("origin configuration", () => {
    it("supports string origin", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: "https://specific-origin.com",
          credentials: true,
        },
      });

      const request = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://specific-origin.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response = await endpoint.fetch(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://specific-origin.com",
      );
    });

    it("supports array of origins", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: ["https://app1.com", "https://app2.com"],
          credentials: true,
        },
      });

      // Request from first allowed origin
      const request1 = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app1.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response1 = await endpoint.fetch(request1);
      expect(response1.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app1.com",
      );

      // Request from second allowed origin
      const request2 = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app2.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response2 = await endpoint.fetch(request2);
      expect(response2.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app2.com",
      );
    });

    it("supports function origin for dynamic resolution", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        cors: {
          origin: (origin: string) => {
            // Only allow origins ending with .mycompany.com
            if (origin.endsWith(".mycompany.com")) {
              return origin;
            }
            return null;
          },
          credentials: true,
        },
      });

      // Allowed origin
      const request1 = new Request("https://example.com/info", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.mycompany.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      const response1 = await endpoint.fetch(request1);
      expect(response1.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.mycompany.com",
      );
    });
  });
});
