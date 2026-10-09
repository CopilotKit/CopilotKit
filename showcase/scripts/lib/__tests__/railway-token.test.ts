import { describe, expect, it, vi } from "vitest";
import { resolveRailwayTokenFromConfig } from "../railway-token";
import type { RailwayConfigShape } from "../railway-token";

describe("resolveRailwayTokenFromConfig", () => {
  it("prefers user.accessToken when present", () => {
    const cfg: RailwayConfigShape = {
      user: {
        accessToken: "new-access-token-43-chars-or-more-aaaaaaaa",
        token: "legacy-short-token",
      },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("new-access-token-43-chars-or-more-aaaaaaaa");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to top-level accessToken", () => {
    const cfg: RailwayConfigShape = {
      accessToken: "top-level-access-token-aaaaaaaaaaaaaaaaaaaa",
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("top-level-access-token-aaaaaaaaaaaaaaaaaaaa");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to legacy user.token AND emits a deprecation warning", () => {
    const cfg: RailwayConfigShape = {
      user: { token: "legacy-short-token-aaaaaaaaaa" },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("legacy-short-token-aaaaaaaaaa");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /deprecated.*user\.token.*accessToken/i,
    );
  });

  it("falls back to top-level token with deprecation warning", () => {
    const cfg: RailwayConfigShape = { token: "legacy-top-aaaaaaaaa" };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("legacy-top-aaaaaaaaa");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns undefined and does not warn on an empty config", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig({}, { warn });
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores empty-string tokens at every layer", () => {
    const cfg: RailwayConfigShape = {
      user: { accessToken: "", token: "" },
      accessToken: "",
      token: "",
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBeUndefined();
  });

  it("treats whitespace-only user.accessToken as empty and falls through", () => {
    const cfg: RailwayConfigShape = {
      user: { accessToken: "   " },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls through whitespace-only user.accessToken to legacy user.token with warn", () => {
    const cfg: RailwayConfigShape = {
      user: {
        accessToken: "\n\t  ",
        token: "legacy-short-token-aaaaaaaaaa",
      },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("legacy-short-token-aaaaaaaaaa");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats whitespace-only tokens at every layer as empty", () => {
    const cfg: RailwayConfigShape = {
      user: { accessToken: "  ", token: "\t" },
      accessToken: "\n",
      token: "   ",
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined when config is null", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(null, { warn });
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined when config is undefined", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(undefined, { warn });
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined when config is a string (non-object JSON)", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(
      "not-an-object" as unknown as RailwayConfigShape,
      { warn },
    );
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined when config is a number", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(
      42 as unknown as RailwayConfigShape,
      { warn },
    );
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the trimmed token when user.accessToken has surrounding whitespace", () => {
    const cfg: RailwayConfigShape = {
      user: { accessToken: "  padded-token-aaaaaaaaaaaaaaaaaaaa  " },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("padded-token-aaaaaaaaaaaaaaaaaaaa");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the trimmed token when user.accessToken has a trailing newline", () => {
    const cfg: RailwayConfigShape = {
      user: { accessToken: "abc-access-token-aaaaaaaaaaaaaaaaaaaa\n" },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("abc-access-token-aaaaaaaaaaaaaaaaaaaa");
  });

  it("returns the trimmed token when top-level accessToken has surrounding whitespace", () => {
    const cfg: RailwayConfigShape = {
      accessToken: "\ttop-padded-aaaaaaaaaaaaaaaaaaaaaaaa\n",
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("top-padded-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the trimmed token for legacy user.token (with warn)", () => {
    const cfg: RailwayConfigShape = {
      user: { token: "  legacy-user-token-aaaaaaaaaa\n" },
    };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("legacy-user-token-aaaaaaaaaa");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns the trimmed token for legacy top-level token (with warn)", () => {
    const cfg: RailwayConfigShape = { token: "\nlegacy-top-aaaaaaaaa  " };
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(cfg, { warn });
    expect(result).toBe("legacy-top-aaaaaaaaa");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when config is an array", () => {
    const warn = vi.fn();
    const result = resolveRailwayTokenFromConfig(
      [] as unknown as RailwayConfigShape,
      { warn },
    );
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
