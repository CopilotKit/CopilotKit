import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// The pairs come from the real data: the strands manifest lists agentic-chat,
// src/integrations/strands/extra-demos.json lists
// threadid-frontend-tool-roundtrip, and only mastra has background-agents.

function visit(pathname: string) {
  return middleware(new NextRequest(`http://localhost:3000${pathname}`));
}

describe("middleware", () => {
  it.each([
    ["a demo the manifest lists", "/demos/strands/agentic-chat"],
    ["an extra demo", "/demos/strands/threadid-frontend-tool-roundtrip"],
  ])("passes %s on with its path in x-pathname", (_, pathname) => {
    const response = visit(pathname);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    // How NextResponse.next() hands an overridden request header to the page.
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      pathname,
    );
  });

  it("answers 404 for a demo that is not in the manifest or the extra demos", () => {
    expect(visit("/demos/strands/background-agents").status).toBe(404);
  });

  it("answers 404 for an integration no manifest has", () => {
    expect(visit("/demos/no-such-integration/agentic-chat").status).toBe(404);
    expect(visit("/demos/no-such-integration").status).toBe(404);
  });
});
