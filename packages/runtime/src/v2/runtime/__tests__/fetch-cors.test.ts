import { describe, it, expect, vi } from "vitest";
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

    it.each<[string, CopilotCorsConfig["origin"]]>([
      ["a string", "https://example.com"],
      ["an array", ["https://other.com", "https://example.com"]],
      ["a function", (origin: string) => origin],
    ])(
      "echoes the requested headers when credentials are enabled and origin is %s",
      (_, origin) => {
        const request = new Request("http://localhost/api", {
          method: "OPTIONS",
          headers: {
            Origin: "https://example.com",
            "Access-Control-Request-Headers": "content-type,authorization",
          },
        });
        const response = handleCors(request, { origin, credentials: true })!;
        // Per Fetch spec, "*" is a literal header name on credentialed
        // requests, so a wildcard here would make the browser block the real
        // request.
        expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
          "content-type,authorization",
        );
      },
    );

    it("omits Allow-Headers on a credentialed preflight that requests none", () => {
      // Only safelisted headers are in play, and those need no Allow-Headers.
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      });
      const response = handleCors(request, {
        origin: "https://example.com",
        credentials: true,
      })!;
      expect(response.headers.has("Access-Control-Allow-Headers")).toBe(false);
    });

    it.each<[string, CopilotCorsConfig]>([
      ["no origin", { credentials: true }],
      ['origin "*"', { origin: "*", credentials: true }],
      [
        'an origin function returning "*"',
        { origin: () => "*", credentials: true },
      ],
    ])(
      "does not echo requested headers when credentials resolve to %s",
      (_, config) => {
        // These configurations do not name a specific origin, so echoing
        // requested headers would let an arbitrary site send credentialed
        // requests. (Without an origin the response carries no CORS headers
        // at all, see the "credentials without a configured origin" suite.)
        const request = new Request("http://localhost/api", {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example",
            "Access-Control-Request-Headers": "content-type,authorization",
          },
        });
        const response = handleCors(request, config)!;
        expect(response.headers.get("Access-Control-Allow-Headers")).toBe("*");
      },
    );

    it("keeps the wildcard header list without credentials", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": "content-type" },
      });
      const response = handleCors(request, {})!;
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("*");
    });

    it("prefers configured allowHeaders over the requested headers", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": "x-other" },
      });
      const response = handleCors(request, {
        credentials: true,
        allowHeaders: ["Content-Type"],
      })!;
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type",
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

  describe("credentials without a configured origin", () => {
    // https://github.com/CopilotKit/CopilotKit/issues/8025
    // Reflecting the request origin when `credentials` is on and `origin`
    // is not configured answers every origin with
    // `Access-Control-Allow-Origin: <that origin>` +
    // `Access-Control-Allow-Credentials: true`, so any site can read
    // authenticated responses. The documented contract requires an explicit
    // origin with credentials, so no CORS headers are sent instead.

    it("does not reflect the request origin on a preflight", () => {
      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      });
      const response = handleCors(request, { credentials: true })!;
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
    });

    // `resolveOrigin` maps every falsy origin to "*", so an empty string from
    // `process.env.CORS_ORIGIN || ""` (or a null from parsed config) used to
    // skip the guard and reflect the request origin with credentials.
    it.each<[string, unknown]>([
      ["an empty string", ""],
      ["null", null],
    ])("does not reflect the request origin when origin is %s", (_, origin) => {
      const config = { credentials: true, origin } as CopilotCorsConfig;

      const preflight = handleCors(
        new Request("http://localhost/api", {
          method: "OPTIONS",
          headers: { Origin: "https://evil.example" },
        }),
        config,
      )!;
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(
        preflight.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();

      const decorated = addCorsHeaders(
        new Response("ok", { status: 200 }),
        config,
        "https://evil.example",
      );
      expect(decorated.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(
        decorated.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
    });

    it("does not reflect the request origin on an actual response", () => {
      const response = new Response("ok", { status: 200 });
      const result = addCorsHeaders(
        response,
        { credentials: true },
        "https://evil.example",
      );
      expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(result.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("warns once, not per request", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.resetModules();
      try {
        const { handleCors: freshHandleCors } =
          await import("../core/fetch-cors");
        for (let i = 0; i < 3; i++) {
          const request = new Request("http://localhost/api", {
            method: "OPTIONS",
            headers: { Origin: "https://evil.example" },
          });
          freshHandleCors(request, { credentials: true });
        }
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(
          /credentials.*origin|origin.*credentials/i,
        );
      } finally {
        warn.mockRestore();
        vi.resetModules();
      }
    });

    it("still reflects an explicit wildcard with credentials", () => {
      // An explicit `origin: "*"` is a deliberate configuration; the
      // Fetch-spec wildcard+credentials workaround keeps reflecting it.
      const response = new Response("ok", { status: 200 });
      const result = addCorsHeaders(
        response,
        { origin: "*", credentials: true },
        "https://example.com",
      );
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(result.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });

    it("keeps permissive CORS when credentials are off", () => {
      const response = new Response("ok", { status: 200 });
      const result = addCorsHeaders(response, {}, "https://example.com");
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(result.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });
});
