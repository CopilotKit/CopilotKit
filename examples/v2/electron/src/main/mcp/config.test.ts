import { describe, it, expect } from "vitest";
import { parseMcpConfig, loadMcpConfig } from "./config";
import type { StdioServerConfig, RemoteServerConfig } from "./config";

// ---------------------------------------------------------------------------
// parseMcpConfig
// ---------------------------------------------------------------------------

describe("parseMcpConfig — stdio entry", () => {
  it("maps a stdio entry to { name, kind:'stdio', command, args, env }", () => {
    const result = parseMcpConfig({
      servers: {
        myTool: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          env: { MY_VAR: "hello" },
        },
      },
    });

    expect(result).toHaveLength(1);
    const cfg = result[0] as StdioServerConfig;
    expect(cfg.name).toBe("myTool");
    expect(cfg.kind).toBe("stdio");
    expect(cfg.command).toBe("npx");
    expect(cfg.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
    ]);
    expect(cfg.env).toEqual({ MY_VAR: "hello" });
  });

  it("handles a stdio entry without optional args", () => {
    const result = parseMcpConfig({
      servers: {
        bare: { command: "python3" },
      },
    });

    const cfg = result[0] as StdioServerConfig;
    expect(cfg.kind).toBe("stdio");
    expect(cfg.command).toBe("python3");
    expect(cfg.args).toBeUndefined();
    expect(cfg.env).toBeUndefined();
  });
});

describe("parseMcpConfig — remote entry", () => {
  it("maps a remote entry to { name, kind:'remote', url, headers }", () => {
    const result = parseMcpConfig({
      servers: {
        myRemote: {
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token123" },
        },
      },
    });

    expect(result).toHaveLength(1);
    const cfg = result[0] as RemoteServerConfig;
    expect(cfg.name).toBe("myRemote");
    expect(cfg.kind).toBe("remote");
    expect(cfg.url).toBe("https://example.com/mcp");
    expect(cfg.headers).toEqual({ Authorization: "Bearer token123" });
  });

  it("handles a remote entry without optional headers", () => {
    const result = parseMcpConfig({
      servers: {
        noHeaders: { url: "https://api.example.com/mcp" },
      },
    });

    const cfg = result[0] as RemoteServerConfig;
    expect(cfg.kind).toBe("remote");
    expect(cfg.url).toBe("https://api.example.com/mcp");
    expect(cfg.headers).toBeUndefined();
  });

  it("rejects a remote entry with an invalid URL", () => {
    expect(() =>
      parseMcpConfig({
        servers: {
          bad: { url: "not-a-url" },
        },
      }),
    ).toThrow(/Invalid MCP config/);
  });
});

describe("parseMcpConfig — env passthrough", () => {
  it("passes env values through unchanged", () => {
    const result = parseMcpConfig({
      servers: {
        withEnv: {
          command: "node",
          args: ["server.js"],
          env: { PATH: "/usr/bin", DEBUG: "true" },
        },
      },
    });

    const cfg = result[0] as StdioServerConfig;
    expect(cfg.env).toEqual({ PATH: "/usr/bin", DEBUG: "true" });
  });
});

describe("parseMcpConfig — bad shapes", () => {
  it("throws when an entry has neither command nor url", () => {
    expect(() =>
      parseMcpConfig({
        servers: {
          broken: { notCommand: "oops" },
        },
      }),
    ).toThrow(/Invalid MCP config/);
  });

  it("throws when the top-level servers key is missing", () => {
    expect(() => parseMcpConfig({ notServers: {} })).toThrow(
      /Invalid MCP config/,
    );
  });

  it("throws when raw is null", () => {
    expect(() => parseMcpConfig(null)).toThrow(/Invalid MCP config/);
  });

  it("throws when servers is an array instead of a record", () => {
    expect(() => parseMcpConfig({ servers: [{ command: "ls" }] })).toThrow(
      /Invalid MCP config/,
    );
  });
});

describe("parseMcpConfig — multiple entries", () => {
  it("returns one config per server entry in insertion order", () => {
    const result = parseMcpConfig({
      servers: {
        first: { command: "echo", args: ["hello"] },
        second: { url: "https://remote.example.com/mcp" },
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("first");
    expect(result[0].kind).toBe("stdio");
    expect(result[1].name).toBe("second");
    expect(result[1].kind).toBe("remote");
  });
});

// ---------------------------------------------------------------------------
// loadMcpConfig
// ---------------------------------------------------------------------------

describe("loadMcpConfig — happy path", () => {
  it("parses a valid JSON string returned by the injected read fn", () => {
    const payload = JSON.stringify({
      servers: {
        tool: { command: "node", args: ["index.js"] },
      },
    });

    const read = (_path: string) => payload;
    const result = loadMcpConfig(read, "/some/path/mcp.json");

    expect(result).toHaveLength(1);
    const cfg = result[0] as StdioServerConfig;
    expect(cfg.kind).toBe("stdio");
    expect(cfg.command).toBe("node");
    expect(cfg.args).toEqual(["index.js"]);
  });
});

describe("loadMcpConfig — ENOENT", () => {
  it("returns [] when the injected read fn throws with code ENOENT", () => {
    const read = (_path: string): string => {
      const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    const result = loadMcpConfig(read, "/missing/mcp.json");
    expect(result).toEqual([]);
  });
});

describe("loadMcpConfig — non-ENOENT error", () => {
  it("rethrows errors that are not ENOENT", () => {
    const read = (_path: string): string => {
      const err = new Error(
        "EACCES: permission denied",
      ) as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    expect(() => loadMcpConfig(read, "/forbidden/mcp.json")).toThrow(/EACCES/);
  });

  it("rethrows errors with no code", () => {
    const read = (_path: string): string => {
      throw new Error("some other error");
    };

    expect(() => loadMcpConfig(read, "/broken/mcp.json")).toThrow(
      /some other error/,
    );
  });
});
