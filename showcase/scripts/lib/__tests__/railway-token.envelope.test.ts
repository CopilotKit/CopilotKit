import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRailwayToken, RailwayTokenError } from "../railway-token";

/**
 * Envelope-level tests for resolveRailwayToken — the unified resolver
 * used by redeploy-env.ts and verify-railway-image-refs.ts.
 *
 * Each failure mode must throw a DISTINCT, actionable error so the
 * silent-token-fallthrough diagnostic gap can never re-open.
 */
describe("resolveRailwayToken (envelope)", () => {
  let dir: string;
  const originalEnv = process.env.RAILWAY_TOKEN;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rwy-token-env-"));
    delete process.env.RAILWAY_TOKEN;
    process.env.HOME = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.RAILWAY_TOKEN;
    else process.env.RAILWAY_TOKEN = originalEnv;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("returns RAILWAY_TOKEN env var when set, source='env'", () => {
    process.env.RAILWAY_TOKEN = "env-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const result = resolveRailwayToken();
    expect(result.token).toBe("env-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(result.source).toBe("env");
  });

  it("returns token from ~/.railway/config.json when env unset, source='config'", () => {
    mkdirSync(join(dir, ".railway"));
    writeFileSync(
      join(dir, ".railway", "config.json"),
      JSON.stringify({
        user: { accessToken: "from-config-aaaaaaaaaaaaaaaaaaaaaaaa" },
      }),
    );
    const result = resolveRailwayToken();
    expect(result.token).toBe("from-config-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.source).toBe("config");
  });

  it("throws DISTINCT error when $HOME is unset and env-var also unset", () => {
    delete process.env.HOME;
    expect(() => resolveRailwayToken()).toThrow(RailwayTokenError);
    try {
      resolveRailwayToken();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RailwayTokenError);
      const err = e as RailwayTokenError;
      expect(err.code).toBe("NO_HOME");
      expect(err.message).toMatch(/\$HOME/);
    }
  });

  it("trims RAILWAY_TOKEN env var (padded with whitespace/newline)", () => {
    process.env.RAILWAY_TOKEN = "  padded-token-xxxxxxxxxxxxxxxxxxxxxxxx\n";
    const result = resolveRailwayToken();
    expect(result.token).toBe("padded-token-xxxxxxxxxxxxxxxxxxxxxxxx");
    expect(result.source).toBe("env");
  });

  it("treats whitespace-only RAILWAY_TOKEN as UNSET and falls through to config", () => {
    process.env.RAILWAY_TOKEN = "   ";
    mkdirSync(join(dir, ".railway"));
    writeFileSync(
      join(dir, ".railway", "config.json"),
      JSON.stringify({
        user: { accessToken: "from-config-bbbbbbbbbbbbbbbbbbbbbbbb" },
      }),
    );
    const result = resolveRailwayToken();
    expect(result.token).toBe("from-config-bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.source).toBe("config");
  });

  it("treats whitespace-only RAILWAY_TOKEN as UNSET and surfaces NO_FILE when no config exists", () => {
    process.env.RAILWAY_TOKEN = "   \n";
    try {
      resolveRailwayToken();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RailwayTokenError);
      const err = e as RailwayTokenError;
      // Must NOT be returned as source="env" with a whitespace token —
      // that produces invalid Bearer headers and silent 401s.
      expect(err.code).toBe("NO_FILE");
    }
  });

  it("throws DISTINCT error when ~/.railway/config.json does not exist", () => {
    try {
      resolveRailwayToken();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RailwayTokenError);
      const err = e as RailwayTokenError;
      expect(err.code).toBe("NO_FILE");
      expect(err.message).toMatch(/RAILWAY_TOKEN/);
      expect(err.message).toMatch(/railway login/);
    }
  });

  it("throws DISTINCT error when ~/.railway/config.json is malformed JSON", () => {
    mkdirSync(join(dir, ".railway"));
    writeFileSync(join(dir, ".railway", "config.json"), "{ not json");
    try {
      resolveRailwayToken();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RailwayTokenError);
      const err = e as RailwayTokenError;
      expect(err.code).toBe("MALFORMED");
      expect(err.message).toMatch(/Malformed ~\/\.railway\/config\.json/);
    }
  });

  it("throws DISTINCT error when config parses but yields no usable token (the silent-fallthrough gap)", () => {
    mkdirSync(join(dir, ".railway"));
    // Parses fine — just no token field at any layer.
    writeFileSync(
      join(dir, ".railway", "config.json"),
      JSON.stringify({ projects: { something: "else" } }),
    );
    try {
      resolveRailwayToken();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RailwayTokenError);
      const err = e as RailwayTokenError;
      // CRITICAL: must NOT be the generic NO_FILE message — the
      // user needs to know the file WAS found but had no token.
      expect(err.code).toBe("NO_TOKEN_IN_CONFIG");
      expect(err.message).toMatch(
        /~\/\.railway\/config\.json.*no.*token|found.*no.*token/i,
      );
      // Must also hint at the remedy.
      expect(err.message).toMatch(/railway login|RAILWAY_TOKEN/);
    }
  });
});
