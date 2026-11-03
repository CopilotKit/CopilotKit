import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { ɵThread } from "@copilotkit/core";
import { afterEach, expect, test, vi } from "vitest";
import { WebInspectorElement } from "../../index.js";

type PlaygroundHarness = Readonly<{
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  root: ShadowRoot;
  teardown: () => void;
}>;

type PlaygroundSetupOptions = Readonly<{
  agent?: boolean;
  runtimeMode?: "sse" | "intelligence";
  threads?: ɵThread[];
}>;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function requireElement<T extends Node>(
  element: T | null | undefined,
  message: string,
): T {
  if (!element) throw new Error(message);
  return element;
}

async function setupPlayground(
  options: PlaygroundSetupOptions = {},
): Promise<PlaygroundHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents:
            options.agent === false
              ? {}
              : { default: { description: "assistant", capabilities: {} } },
          audioFileTranscriptionEnabled: false,
          mode: options.runtimeMode ?? "sse",
          threadEndpoints: {
            list: Boolean(options.threads),
            inspect: Boolean(options.threads),
            mutations: false,
            realtimeMetadata: false,
          },
          licenseStatus: "unknown",
          telemetryDisabled: true,
        });
      }
      if (url.endsWith("/memories")) return jsonResponse({ memories: [] });
      if (url.includes("/threads?")) {
        return jsonResponse({ threads: options.threads ?? [], joinCode: null });
      }
      if (url.endsWith("/threads/thread-1/messages")) {
        return jsonResponse({
          messages: [
            { id: "message-1", role: "user", content: "Earlier question" },
            {
              id: "message-2",
              role: "assistant",
              content: "Earlier answer",
            },
          ],
        });
      }
      if (url.endsWith("/threads/thread-1/state")) {
        return jsonResponse({ state: { topic: "billing" } });
      }
      if (url === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: "http://localhost:4000/api/copilotkit",
    runtimeTransport: "rest",
    deferInitialConnection: true,
  });
  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.append(inspector);
  core.connect();
  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  core.setAgents__unsafe_dev_only(
    options.agent === false
      ? {}
      : {
          default: new HttpAgent({
            agentId: "default",
            description: "assistant",
            url: "http://localhost:4000/api/copilotkit/agents/default",
          }),
        },
  );
  await inspector.updateComplete;
  requireElement(
    inspector.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    ),
    "Web Inspector opener was not rendered",
  ).click();
  await inspector.updateComplete;
  requireElement(
    inspector.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-inspector-menu-key="playground"]',
    ),
    "Playground navigation was not rendered",
  ).click();
  await inspector.updateComplete;
  const root = requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );

  return {
    core,
    inspector,
    root,
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
  document.getElementById("cpk-inspector-brand-fonts")?.remove();
});

test("creates an isolated local thread and explains ephemeral durability", async () => {
  const harness = await setupPlayground();
  try {
    expect(
      harness.root.querySelector("#cpk-main-scroll")?.textContent,
    ).toContain("Agent: default");
    const input = requireElement(
      harness.root.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Playground message"]',
      ),
      "Playground message input was not rendered",
    );
    input.value = "Hello from Inspector";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await harness.inspector.updateComplete;
    expect(
      requireElement(
        harness.root.querySelector<HTMLButtonElement>(
          'button[aria-label="Send playground message"]',
        ),
        "Playground send button was not rendered",
      ).disabled,
    ).toBe(false);

    requireElement(
      Array.from(
        harness.root.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "New thread"),
      "Playground New thread button was not rendered",
    ).click();
    await harness.inspector.updateComplete;

    const notice = requireElement(
      harness.root.querySelector<HTMLElement>(
        "[data-playground-ephemeral-notice]",
      ),
      "Ephemeral thread notice was not rendered",
    );
    expect(notice.textContent?.replace(/\s+/g, " ")).toContain(
      "deleted when your local session ends",
    );
    expect(notice.textContent).toContain("Set up Intelligence");
  } finally {
    harness.teardown();
  }
});

test("forks saved thread history without changing the app agent", async () => {
  const harness = await setupPlayground({
    threads: [
      {
        id: "thread-1",
        organizationId: "organization-1",
        agentId: "default",
        createdById: "user-1",
        name: "Saved conversation",
        archived: false,
        createdAt: "2026-08-19T12:00:00.000Z",
        updatedAt: "2026-08-19T12:01:00.000Z",
      },
    ],
  });
  try {
    await waitFor(
      () =>
        harness.root.querySelector("#cpk-playground-thread-source") !== null,
      "saved thread selector",
    );
    const source = requireElement(
      harness.root.querySelector<HTMLSelectElement>(
        "#cpk-playground-thread-source",
      ),
      "Saved thread selector was not rendered",
    );
    source.value = "thread-1";
    source.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    );

    await waitFor(
      () => harness.root.textContent?.includes("Earlier answer") === true,
      "saved thread messages",
    );
    expect(harness.root.textContent).toContain("Earlier question");
    expect(harness.core.getAgent("default")?.messages).toEqual([]);
  } finally {
    harness.teardown();
  }
});

test("omits the durability CTA when Intelligence is active", async () => {
  const harness = await setupPlayground({ runtimeMode: "intelligence" });
  try {
    requireElement(
      Array.from(
        harness.root.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "New thread"),
      "Playground New thread button was not rendered",
    ).click();
    await harness.inspector.updateComplete;

    expect(
      harness.root.querySelector("[data-playground-ephemeral-notice]"),
    ).toBeNull();
  } finally {
    harness.teardown();
  }
});

test("disables Playground controls while no agent is available", async () => {
  const harness = await setupPlayground({ agent: false });
  try {
    expect(harness.root.textContent).toContain("Agent: waiting...");
    const input = requireElement(
      harness.root.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Playground message"]',
      ),
      "Playground message input was not rendered",
    );
    const send = requireElement(
      harness.root.querySelector<HTMLButtonElement>(
        'button[aria-label="Send playground message"]',
      ),
      "Playground send button was not rendered",
    );
    const newThread = requireElement(
      Array.from(
        harness.root.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "New thread"),
      "Playground New thread button was not rendered",
    );

    expect(input.placeholder).toBe("Waiting for an agent...");
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(newThread.disabled).toBe(true);
  } finally {
    harness.teardown();
  }
});

test("keeps the composer readable in dark mode", async () => {
  const harness = await setupPlayground();
  try {
    const inspectorWindow = requireElement(
      harness.root.querySelector<HTMLElement>(".inspector-window"),
      "Inspector window was not rendered",
    );
    requireElement(
      harness.root.querySelector<HTMLButtonElement>(
        "[data-inspector-theme-toggle]",
      ),
      "Theme toggle was not rendered",
    ).click();
    await waitFor(
      () => inspectorWindow.dataset.colorScheme === "dark",
      "dark color scheme",
    );

    expect(
      harness.root
        .querySelector('textarea[aria-label="Playground message"]')
        ?.classList.contains("cpk-playground-input"),
    ).toBe(true);
    expect(
      harness.root.querySelector(".cpk-playground-composer"),
    ).not.toBeNull();
    expect(
      harness.root
        .querySelector('button[aria-label="Send playground message"]')
        ?.classList.contains("cpk-playground-send"),
    ).toBe(true);
  } finally {
    harness.teardown();
  }
});

test("registers Playground styles in the Web Inspector shadow root", () => {
  const cssText = String(WebInspectorElement.styles);

  expect(cssText).toMatch(
    /\.cpk-playground-root\s*\{[^}]*background:\s*#fbfbfd\s*!important/s,
  );
  expect(cssText).toMatch(
    /\.cpk-playground-header\s*\{[^}]*min-height:\s*58px[^}]*background:\s*#f7f6fd\s*!important/s,
  );
  expect(cssText).toMatch(
    /\.cpk-playground-composer\s*\{[^}]*border:\s*1px solid #dcdce8/s,
  );
  expect(cssText).toContain("@keyframes cpk-playground-message-enter");
  expect(cssText).toContain("@media (prefers-reduced-motion: reduce)");
});
