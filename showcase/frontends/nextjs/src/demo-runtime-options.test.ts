import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";

// The MCP Apps middleware fetches with `redirect: "error"`, so the default
// server URL must be the MCP endpoint itself. https://mcp.excalidraw.com
// answers 308 to /mcp, which the middleware refuses.
function defaultServerUrl(demo: string) {
  return DEMO_RUNTIME_OPTIONS[demo]?.mcpApps?.servers[0]?.url;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DEMO_RUNTIME_OPTIONS MCP Apps server", () => {
  it.each(["mcp-apps", "headless-complete", "beautiful-chat"])(
    "%s connects to the Excalidraw MCP endpoint when MCP_SERVER_URL is unset",
    (demo) => {
      vi.stubEnv("MCP_SERVER_URL", "");

      expect(defaultServerUrl(demo)).toBe("https://mcp.excalidraw.com/mcp");
    },
  );

  it("connects to MCP_SERVER_URL when it is set", () => {
    vi.stubEnv("MCP_SERVER_URL", "http://mcp.local:9000/mcp");

    expect(defaultServerUrl("mcp-apps")).toBe("http://mcp.local:9000/mcp");
  });
});
