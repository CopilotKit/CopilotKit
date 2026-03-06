import { describe, it, expect } from "vitest";
import { matchRoute } from "../core/fetch-router";

/* ------------------------------------------------------------------------------------------------
 * basePath = "/"
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — basePath is /", () => {
  it("matches /info", () => {
    const result = matchRoute("/info", "/");
    expect(result).toEqual({ method: "info" });
  });

  it("matches /agent/:id/run", () => {
    const result = matchRoute("/agent/myAgent/run", "/");
    expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
  });

  it("matches /agent/:id/connect", () => {
    const result = matchRoute("/agent/myAgent/connect", "/");
    expect(result).toEqual({ method: "agent/connect", agentId: "myAgent" });
  });

  it("matches /agent/:id/stop/:threadId", () => {
    const result = matchRoute("/agent/myAgent/stop/t1", "/");
    expect(result).toEqual({
      method: "agent/stop",
      agentId: "myAgent",
      threadId: "t1",
    });
  });

  it("matches /transcribe", () => {
    const result = matchRoute("/transcribe", "/");
    expect(result).toEqual({ method: "transcribe" });
  });

  it("returns null for unknown path", () => {
    const result = matchRoute("/unknown", "/");
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Trailing slash normalization
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — trailing slash normalization", () => {
  it("basePath with trailing slash matches", () => {
    const result = matchRoute("/api/copilotkit/info", "/api/copilotkit/");
    expect(result).toEqual({ method: "info" });
  });

  it("basePath without trailing slash matches", () => {
    const result = matchRoute("/api/copilotkit/info", "/api/copilotkit");
    expect(result).toEqual({ method: "info" });
  });
});

/* ------------------------------------------------------------------------------------------------
 * URL decoding
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — URL decoding", () => {
  it("decodes URL-encoded agentId", () => {
    const result = matchRoute("/api/agent/my%20agent/run", "/api");
    expect(result).toEqual({ method: "agent/run", agentId: "my agent" });
  });

  it("decodes URL-encoded threadId", () => {
    const result = matchRoute(
      "/api/agent/myAgent/stop/thread%2F123",
      "/api",
    );
    expect(result).toEqual({
      method: "agent/stop",
      agentId: "myAgent",
      threadId: "thread/123",
    });
  });

  it("handles agentId with special characters", () => {
    const result = matchRoute(
      "/api/agent/agent%40domain.com/run",
      "/api",
    );
    expect(result).toEqual({ method: "agent/run", agentId: "agent@domain.com" });
  });

  it("handles already-decoded agentId", () => {
    const result = matchRoute("/api/agent/simple-agent/run", "/api");
    expect(result).toEqual({ method: "agent/run", agentId: "simple-agent" });
  });
});

/* ------------------------------------------------------------------------------------------------
 * Suffix matching (no basePath)
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — suffix matching (no basePath)", () => {
  it("matches info as last segment of any path", () => {
    const result = matchRoute("/some/deeply/nested/prefix/info");
    expect(result).toEqual({ method: "info" });
  });

  it("matches transcribe as last segment", () => {
    const result = matchRoute("/prefix/transcribe");
    expect(result).toEqual({ method: "transcribe" });
  });

  it("matches agent/:id/run as trailing pattern", () => {
    const result = matchRoute("/prefix/agent/myAgent/run");
    expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
  });

  it("matches agent/:id/connect as trailing pattern", () => {
    const result = matchRoute("/prefix/agent/myAgent/connect");
    expect(result).toEqual({ method: "agent/connect", agentId: "myAgent" });
  });

  it("matches agent/:id/stop/:threadId as trailing pattern", () => {
    const result = matchRoute("/prefix/agent/myAgent/stop/t1");
    expect(result).toEqual({
      method: "agent/stop",
      agentId: "myAgent",
      threadId: "t1",
    });
  });

  it("returns null for no matching suffix", () => {
    const result = matchRoute("/some/random/path/here");
    expect(result).toBeNull();
  });

  it("returns null for empty path", () => {
    const result = matchRoute("/");
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------
 * basePath boundary matching
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — basePath boundary", () => {
  it("does not match if basePath is a prefix but not at segment boundary", () => {
    // /apicopilotkit/info should NOT match basePath /api
    const result = matchRoute("/apicopilotkit/info", "/api");
    expect(result).toBeNull();
  });

  it("matches when basePath is exact prefix at segment boundary", () => {
    const result = matchRoute("/api/info", "/api");
    expect(result).toEqual({ method: "info" });
  });

  it("basePath matches exactly with no trailing path", () => {
    // /api with basePath /api → remainder is "/" → no match (no known route for /)
    const result = matchRoute("/api", "/api");
    expect(result).toBeNull();
  });

  it("returns null when path does not start with basePath", () => {
    const result = matchRoute("/other/info", "/api");
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Edge cases: segments and special patterns
 * --------------------------------------------------------------------------------------------- */

describe("matchRoute — segment edge cases", () => {
  it("handles double slashes by filtering empty segments", () => {
    // /api//info → segments: ["api", "info"] after filter(Boolean)
    const result = matchRoute("/api//info", "/api");
    expect(result).toEqual({ method: "info" });
  });

  it("handles path with only basePath + slash", () => {
    const result = matchRoute("/api/", "/api");
    expect(result).toBeNull();
  });

  it("matches with deep basePath", () => {
    const result = matchRoute(
      "/v1/api/copilotkit/info",
      "/v1/api/copilotkit",
    );
    expect(result).toEqual({ method: "info" });
  });

  it("matches agent route with deep basePath", () => {
    const result = matchRoute(
      "/v1/api/copilotkit/agent/default/run",
      "/v1/api/copilotkit",
    );
    expect(result).toEqual({ method: "agent/run", agentId: "default" });
  });

  it("agentId with hyphens, underscores, and dots", () => {
    const result = matchRoute("/api/agent/my-agent_v2.0/run", "/api");
    expect(result).toEqual({
      method: "agent/run",
      agentId: "my-agent_v2.0",
    });
  });

  it("single segment path without basePath matches info", () => {
    const result = matchRoute("/info");
    expect(result).toEqual({ method: "info" });
  });

  it("case-sensitive matching (INFO does not match info)", () => {
    const result = matchRoute("/api/INFO", "/api");
    expect(result).toBeNull();
  });

  it("case-sensitive matching (Agent vs agent)", () => {
    const result = matchRoute("/api/Agent/default/run", "/api");
    expect(result).toBeNull();
  });
});
