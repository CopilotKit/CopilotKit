import { describe, it, expect } from "vitest";
import { matchRoute } from "../core/fetch-router";

describe("fetch-router", () => {
  describe("with basePath (strict prefix stripping)", () => {
    const basePath = "/api/copilotkit";

    it("matches GET /info", () => {
      const result = matchRoute("/api/copilotkit/info", basePath);
      expect(result).toEqual({ method: "info" });
    });

    it("matches POST /transcribe", () => {
      const result = matchRoute("/api/copilotkit/transcribe", basePath);
      expect(result).toEqual({ method: "transcribe" });
    });

    it("matches POST /agent/:agentId/run", () => {
      const result = matchRoute("/api/copilotkit/agent/myAgent/run", basePath);
      expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
    });

    it("matches POST /agent/:agentId/connect", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/myAgent/connect",
        basePath,
      );
      expect(result).toEqual({ method: "agent/connect", agentId: "myAgent" });
    });

    it("matches POST /agent/:agentId/stop/:threadId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/myAgent/stop/thread-123",
        basePath,
      );
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "myAgent",
        threadId: "thread-123",
      });
    });

    it("returns null for paths not starting with basePath", () => {
      const result = matchRoute("/other/info", basePath);
      expect(result).toBeNull();
    });

    it("returns null for unmatched subpaths after basePath", () => {
      const result = matchRoute("/api/copilotkit/unknown", basePath);
      expect(result).toBeNull();
    });

    it("returns null when basePath is a prefix but not a segment boundary", () => {
      const result = matchRoute("/api/copilotkitextra/info", basePath);
      expect(result).toBeNull();
    });

    it("handles basePath with trailing slash", () => {
      const result = matchRoute("/api/copilotkit/info", "/api/copilotkit/");
      expect(result).toEqual({ method: "info" });
    });

    it("handles URL-encoded agentId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/my%20agent/run",
        basePath,
      );
      expect(result).toEqual({ method: "agent/run", agentId: "my agent" });
    });

    it("handles URL-encoded threadId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/ag/stop/thread%2F123",
        basePath,
      );
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "ag",
        threadId: "thread/123",
      });
    });

    it("matches basePath with just root /", () => {
      const result = matchRoute("/info", "/");
      expect(result).toEqual({ method: "info" });
    });
  });

  describe("without basePath (suffix matching)", () => {
    it("matches /info suffix", () => {
      const result = matchRoute("/anything/info");
      expect(result).toEqual({ method: "info" });
    });

    it("matches /transcribe suffix", () => {
      const result = matchRoute("/anything/transcribe");
      expect(result).toEqual({ method: "transcribe" });
    });

    it("matches /agent/:agentId/run suffix", () => {
      const result = matchRoute("/anything/agent/myAgent/run");
      expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
    });

    it("matches /agent/:agentId/connect suffix", () => {
      const result = matchRoute("/anything/agent/myAgent/connect");
      expect(result).toEqual({
        method: "agent/connect",
        agentId: "myAgent",
      });
    });

    it("matches /agent/:agentId/stop/:threadId suffix", () => {
      const result = matchRoute("/anything/agent/ag/stop/t1");
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "ag",
        threadId: "t1",
      });
    });

    it("returns null when no known suffix matches", () => {
      const result = matchRoute("/anything/unknown");
      expect(result).toBeNull();
    });

    it("works with deeply nested mount prefix", () => {
      const result = matchRoute("/api/v2/copilotkit/agent/a1/run");
      expect(result).toEqual({ method: "agent/run", agentId: "a1" });
    });
  });
});
