import { describe, it, expect } from "vitest";
import { handleCors, addCorsHeaders } from "../core/fetch-cors";
import type { CopilotCorsConfig } from "../core/fetch-cors";

describe("fetch-cors", () => {
  describe("handleCors (preflight)", () => {
    it("returns null for non-OPTIONS requests", () => {
      const request = new Request("http://localhost/api", { method: "GET" });
      expect(handleCors(request, {})).toBeNull();
    });

    it("returns null for POST requests", () => {
      const request = new Request("http://localhost/api", { method: "POST" });
      expect(handleCors(request, {})).toBeNull();
    });

    it("returns 204 for OPTIONS requests", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const response = handleCors(request, {});
      expect(response).not.toBeNull();
      expect(response!.status).toBe(204);
    });

    it("adds permissive CORS headers with empty config (cors: true equivalent)", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const response = handleCors(request, {})!;
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "GET",
      );
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST",
      );
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("*");
    });

    it("reflects custom origin string", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://myapp.com" },
      });
      const config: CopilotCorsConfig = { origin: "https://myapp.com" };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://myapp.com",
      );
    });

    it("reflects request origin when in allowed array", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://b.com" },
      });
      const config: CopilotCorsConfig = {
        origin: ["https://a.com", "https://b.com"],
      };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://b.com",
      );
    });

    it("does not set origin when request origin is not in allowed array", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://c.com" },
      });
      const config: CopilotCorsConfig = {
        origin: ["https://a.com", "https://b.com"],
      };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("uses origin function to resolve", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://dynamic.com" },
      });
      const config: CopilotCorsConfig = {
        origin: (origin: string) => (origin.endsWith(".com") ? origin : null),
      };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://dynamic.com",
      );
    });

    it("sets credentials header when configured", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://myapp.com" },
      });
      const config: CopilotCorsConfig = {
        origin: "https://myapp.com",
        credentials: true,
      };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });

    it("sets custom allowMethods", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const config: CopilotCorsConfig = { allowMethods: ["GET", "POST"] };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, POST",
      );
    });

    it("sets custom allowHeaders", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const config: CopilotCorsConfig = {
        allowHeaders: ["Content-Type", "Authorization"],
      };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type, Authorization",
      );
    });

    it("sets maxAge header", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
      });
      const config: CopilotCorsConfig = { maxAge: 86400 };
      const response = handleCors(request, config)!;
      expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    it("auto-resolves wildcard to request origin when credentials enabled", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      });
      const config: CopilotCorsConfig = { origin: "*", credentials: true };
      const response = handleCors(request, config)!;
      // Per Fetch spec, wildcard + credentials is invalid. We auto-resolve
      // the wildcard to the actual request origin when credentials are enabled.
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });
  });

  describe("addCorsHeaders (response decoration)", () => {
    it("adds CORS headers to an existing response", () => {
      const response = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const config: CopilotCorsConfig = {};
      const result = addCorsHeaders(response, config, null);
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(result.headers.get("Content-Type")).toBe("application/json");
      expect(result.status).toBe(200);
    });

    it("adds CORS headers to error responses", () => {
      const response = new Response("Not found", { status: 404 });
      const config: CopilotCorsConfig = {};
      const result = addCorsHeaders(response, config, null);
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(result.status).toBe(404);
    });

    it("sets exposeHeaders", () => {
      const response = new Response(null, { status: 200 });
      const config: CopilotCorsConfig = {
        exposeHeaders: ["X-Request-Id", "X-Custom"],
      };
      const result = addCorsHeaders(response, config, null);
      expect(result.headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Request-Id, X-Custom",
      );
    });

    it("adds Vary: Origin when origin is not wildcard", () => {
      const response = new Response(null, { status: 200 });
      const config: CopilotCorsConfig = { origin: "https://myapp.com" };
      const result = addCorsHeaders(response, config, "https://myapp.com");
      expect(result.headers.get("Vary")).toContain("Origin");
    });

    it("does not add Vary when origin is wildcard", () => {
      const response = new Response(null, { status: 200 });
      const config: CopilotCorsConfig = {};
      const result = addCorsHeaders(response, config, null);
      expect(result.headers.get("Vary")).toBeNull();
    });
  });
});
