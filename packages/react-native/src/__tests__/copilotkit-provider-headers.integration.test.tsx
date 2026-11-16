import React, { useContext } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitContext } from "@copilotkit/react-core/v2/context";
import { CopilotKitProvider } from "../CopilotKitProvider";

// #7513: the provider tests mock the core. These use the real core and a fake
// `fetch`, and check the Authorization header a request actually carries after
// a token rotates with no provider re-render.

let sentAuthorization: (string | null)[];

beforeEach(() => {
  sentAuthorization = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentAuthorization.push(new Headers(init?.headers).get("authorization"));
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Render the provider and return the real core it created. */
function renderProvider(
  headers: React.ComponentProps<typeof CopilotKitProvider>["headers"],
) {
  let core: any;
  function ReadCore() {
    core = (useContext(CopilotKitContext) as any).copilotkit;
    return null;
  }
  render(
    <CopilotKitProvider runtimeUrl="https://api.test" headers={headers}>
      <ReadCore />
    </CopilotKitProvider>,
  );
  return core;
}

/** Send one request through the core; return the Authorization it carried. */
async function sendRequest(core: any): Promise<string | null | undefined> {
  sentAuthorization.length = 0;
  await core.ɵruntimeFetch("https://api.test/request", { method: "POST" });
  return sentAuthorization.at(-1);
}

describe("CopilotKitProvider (React Native) headers, with the real core", () => {
  it("sends a rotated token from a sync builder without a re-render", async () => {
    let token = "token-a";
    const core = renderProvider(() => ({ Authorization: `Bearer ${token}` }));

    expect(await sendRequest(core)).toBe("Bearer token-a");
    token = "token-b";
    expect(await sendRequest(core)).toBe("Bearer token-b");
  });

  it("sends a rotated token from an async builder without a re-render", async () => {
    let token = "token-a";
    const core = renderProvider(async () => ({
      Authorization: `Bearer ${token}`,
    }));

    expect(await sendRequest(core)).toBe("Bearer token-a");
    token = "token-b";
    expect(await sendRequest(core)).toBe("Bearer token-b");
  });

  it("omits a header the builder sets to undefined", async () => {
    const core = renderProvider(() => ({ Authorization: undefined }));

    expect(await sendRequest(core)).toBeNull();
  });
});
