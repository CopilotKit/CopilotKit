import { Hono } from "hono";
import { describe, it, expect, afterEach } from "vitest";
import {
  bearerAuth,
  MissingAuthTokenError,
  constantTimeEqual,
} from "./auth.js";

const ENV_VAR = "OPS_TRIGGER_TOKEN_TEST";

function makeApp(token: string): Hono {
  const app = new Hono();
  app.use("/protected/*", bearerAuth({ expectedToken: token }));
  app.post("/protected/trigger", (c) => c.json({ ok: true }));
  return app;
}

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("abcdef", "abcdeg")).toBe(false);
  });

  it("returns false for strings of differing length without throwing", () => {
    // Length mismatch must NOT throw — that would leak length via timing.
    // Returning false is the correct constant-time-safe behavior.
    expect(constantTimeEqual("a", "abc")).toBe(false);
    expect(constantTimeEqual("abc", "a")).toBe(false);
  });

  it("returns false when either input is empty", () => {
    expect(constantTimeEqual("", "x")).toBe(false);
    expect(constantTimeEqual("x", "")).toBe(false);
    // Two empty strings: defensively false — empty is never a valid token.
    expect(constantTimeEqual("", "")).toBe(false);
  });
});

describe("bearerAuth construction", () => {
  afterEach(() => {
    delete process.env[ENV_VAR];
    delete process.env.OPS_TRIGGER_TOKEN;
  });

  it("throws MissingAuthTokenError when env var is unset and no expectedToken given", () => {
    delete process.env[ENV_VAR];
    expect(() => bearerAuth({ envVar: ENV_VAR })).toThrow(
      MissingAuthTokenError,
    );
  });

  it("throws MissingAuthTokenError when env var is empty string and no expectedToken given", () => {
    process.env[ENV_VAR] = "";
    expect(() => bearerAuth({ envVar: ENV_VAR })).toThrow(
      MissingAuthTokenError,
    );
  });

  it("does not throw when explicit expectedToken provided (env var unset)", () => {
    delete process.env[ENV_VAR];
    expect(() =>
      bearerAuth({ expectedToken: "explicit-tok", envVar: ENV_VAR }),
    ).not.toThrow();
  });

  it("explicit expectedToken takes priority over env lookup", () => {
    process.env[ENV_VAR] = "env-token";
    const mw = bearerAuth({ expectedToken: "explicit-tok", envVar: ENV_VAR });
    expect(mw).toBeTypeOf("function");
  });

  it("defaults to OPS_TRIGGER_TOKEN env var when envVar option not provided", () => {
    delete process.env.OPS_TRIGGER_TOKEN;
    expect(() => bearerAuth()).toThrow(MissingAuthTokenError);
    process.env.OPS_TRIGGER_TOKEN = "from-default-env";
    expect(() => bearerAuth()).not.toThrow();
  });
});

describe("bearerAuth middleware", () => {
  const TOKEN = "s3cr3t-trigger-token";

  it("returns 401 with JSON {error: 'unauthorized'} when Authorization header is missing", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when Authorization header lacks the Bearer prefix", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: TOKEN }, // no "Bearer "
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when Authorization header uses a non-Bearer scheme (Basic, Token, etc.)", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: `Token ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer prefix is present but token is wrong", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when Bearer is present but token portion is empty", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("calls next() when token matches — handler runs and returns 200", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("is case-sensitive on the token (constant-time-safe compare)", async () => {
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN.toUpperCase()}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token of different length without throwing", async () => {
    // Constant-time compare must handle length mismatch gracefully —
    // a throw here would leak length via timing AND surface as a 500.
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the Bearer scheme case-insensitively (RFC 6750)", async () => {
    // RFC 6750 §2.1: "Bearer" auth-scheme is case-insensitive. Be lenient
    // on the scheme match; strict only on the token.
    const app = makeApp(TOKEN);
    const res = await app.request("/protected/trigger", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});
