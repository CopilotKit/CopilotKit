/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { executePlaygroundBundle } from "../bundle-loader";

describe("executePlaygroundBundle", () => {
  beforeEach(() => {
    // Tests share the same jsdom window when run in one file; clear globals
    // so leakage from one test doesn't satisfy the next test's assertion.
    (window as { __copilotkit_playground?: unknown }).__copilotkit_playground =
      undefined;
    (window as { __copilotkit_deps?: unknown }).__copilotkit_deps = undefined;
  });

  it("installs __copilotkit_deps, runs the bundle, and returns the entry component", async () => {
    const code = `
      window.__copilotkit_playground = {
        PlaygroundEntry: function PlaygroundEntry() {
          return window.__copilotkit_deps.React.createElement('div', null, 'ok');
        },
        ChatPlayground: function ChatPlayground() {
          return window.__copilotkit_deps.React.createElement('div', null, 'chat');
        }
      };
    `;
    const { PlaygroundEntry, ChatPlayground } =
      await executePlaygroundBundle(code);
    expect(typeof PlaygroundEntry).toBe("function");
    expect(typeof ChatPlayground).toBe("function");

    const deps = (window as { __copilotkit_deps?: { React?: unknown } })
      .__copilotkit_deps;
    expect(deps?.React).toBeDefined();
  });

  it("rejects when the bundle does not assign __copilotkit_playground", async () => {
    const code = `/* noop */`;
    await expect(executePlaygroundBundle(code)).rejects.toThrow(
      /PlaygroundEntry.*ChatPlayground/,
    );
  });
});
