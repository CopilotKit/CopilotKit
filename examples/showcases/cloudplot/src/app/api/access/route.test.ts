import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("CloudPlot access exchange", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOUDPLOT_ACCESS_CODE", "correct horse");
    vi.stubEnv("CLOUDPLOT_SESSION_SECRET", "session-secret-for-tests");
  });

  it("rejects an invalid access code", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://cloudplot.test/api/access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "198.51.100.8",
        },
        body: JSON.stringify({ accessCode: "wrong" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("sets a protected session cookie for the correct code", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://cloudplot.test/api/access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "198.51.100.9",
        },
        body: JSON.stringify({ accessCode: "correct horse" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("cloudplot_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
