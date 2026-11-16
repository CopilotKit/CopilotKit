import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// The pairs come from the real manifests: strands lists agentic-chat, and
// only mastra lists background-agents.

function visit(pathname: string) {
  return middleware(new NextRequest(`http://localhost:3000${pathname}`));
}

describe("middleware", () => {
  it("passes a listed demo on with its path in x-pathname", () => {
    const response = visit("/demos/strands/agentic-chat");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    // How NextResponse.next() hands an overridden request header to the page.
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/demos/strands/agentic-chat",
    );
  });

  it("answers 404 for a demo the integration's manifest does not list", () => {
    expect(visit("/demos/strands/background-agents").status).toBe(404);
  });

  it("answers 404 for an integration no manifest has", () => {
    expect(visit("/demos/no-such-integration/agentic-chat").status).toBe(404);
    expect(visit("/demos/no-such-integration").status).toBe(404);
  });
});
