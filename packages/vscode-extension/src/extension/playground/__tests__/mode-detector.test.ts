import { describe, expect, it } from "vitest";
import { detectMode } from "../mode-detector";

describe("detectMode", () => {
  it("returns embed for relative paths", () => {
    expect(detectMode("/api/copilotkit").kind).toBe("embed");
    expect(detectMode("/copilotkit").kind).toBe("embed");
  });

  it("returns embed when runtimeUrl is missing", () => {
    expect(detectMode(undefined).kind).toBe("embed");
    expect(detectMode(null).kind).toBe("embed");
    expect(detectMode("").kind).toBe("embed");
  });

  it("returns proxy-unsupported for absolute URLs with the url captured", () => {
    const result = detectMode("https://api.example.com/copilotkit");
    expect(result.kind).toBe("proxy-unsupported");
    if (result.kind === "proxy-unsupported") {
      expect(result.url).toBe("https://api.example.com/copilotkit");
    }
  });

  it("treats http localhost as proxy-unsupported (user already has a runtime)", () => {
    const result = detectMode("http://localhost:3000/api/copilotkit");
    expect(result.kind).toBe("proxy-unsupported");
  });

  it("flags the unserializable case as proxy-unsupported-dynamic", () => {
    const result = detectMode({
      __unserializable: true,
      reason: "inline function",
      source: "getRuntimeUrl()",
      loc: { line: 0, column: 0, endLine: 0, endColumn: 10 },
    });
    expect(result.kind).toBe("proxy-unsupported-dynamic");
  });
});
