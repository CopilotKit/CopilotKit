/**
 * #1937: `useMakeStandardAutosuggestionFunction` used to read
 * `copilotApiConfig.headers` directly in its render body (building a
 * `headers` local that was itself dead — the actual GraphQL request is
 * commented out, and `runtimeClient` is a stub; that local's only mention
 * was building it). With an async `headers` builder on `<CopilotKit>`
 * (`packages/react-core`'s v1 wrapper, which `CopilotTextarea` mounts under
 * — see `copilot-textarea.tsx`), that render-time read called the builder
 * on every render of `CopilotTextarea`. The dead `headers` local has been
 * deleted; this test proves the hook's render body never touches
 * `copilotApiConfig.headers` at all, so mounting (and re-rendering) it under
 * an async builder never invokes that builder.
 *
 * react-textarea has no jsdom / `@testing-library/react` setup (see
 * `vitest.config.mjs`: `environment: "node"`). Rather than add that
 * infrastructure for one regression test, this renders through
 * `react-dom/server`'s `renderToStaticMarkup` — a real React render pass
 * (the same kind that ran the old, buggy read) that needs no DOM. Calling
 * it repeatedly stands in for repeated re-renders: each call re-executes
 * every component's render body, which is exactly the code path the bug
 * lived in.
 */
import { CopilotKit } from "@copilotkit/react-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSuggestionsApiConfig } from "../../../types/autosuggestions-config/suggestions-api-config";
import { useMakeStandardAutosuggestionFunction } from "../use-make-standard-autosuggestions-function";

function Probe() {
  // Same call shape as `CopilotTextarea` (see copilot-textarea.tsx:208-212).
  useMakeStandardAutosuggestionFunction(
    "a test textarea",
    ["global"],
    defaultSuggestionsApiConfig,
  );
  return null;
}

describe("useMakeStandardAutosuggestionFunction — async headers builder (#1937)", () => {
  it("never calls an async headers builder during render, across repeated renders", () => {
    let builderCalls = 0;

    function App() {
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={async () => {
            builderCalls++;
            return { Authorization: "Bearer tok-1" };
          }}
        >
          <Probe />
        </CopilotKit>
      );
    }

    // Discriminating assertion FIRST: mounting is itself a render, and the
    // old code called the builder right there, in `useMakeStandard...`'s
    // hook body, before any effect ever ran.
    renderToStaticMarkup(<App />);
    expect(builderCalls).toBe(0);

    // Repeated renders (each call is a fresh, independent render pass
    // through the same tree) must never invoke the builder either — the
    // bug scaled with render COUNT, not just with mounting once.
    for (let i = 0; i < 10; i++) {
      renderToStaticMarkup(<App />);
    }
    expect(builderCalls).toBe(0);
  });
});
