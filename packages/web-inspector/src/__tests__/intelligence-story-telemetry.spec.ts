import { CopilotKitCore } from "@copilotkit/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import {
  TELEMETRY_EVENTS,
  TELEMETRY_INGEST_URL,
} from "../shared/telemetry/transport.js";

type TelemetryBody = {
  event: string;
  properties: Readonly<{ [key: string]: unknown }>;
};

type Harness = {
  inspector: WebInspectorElement;
  telemetryBodies: TelemetryBody[];
  root: ShadowRoot;
  teardown: () => void;
};

class TelemetryDisabledCore extends CopilotKitCore {
  override get telemetryDisabled() {
    return true;
  }
}

function isProperties(
  value: unknown,
): value is Readonly<{ [key: string]: unknown }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isProperties(parsed) ||
    typeof parsed.event !== "string" ||
    !isProperties(parsed.properties)
  ) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return { event: parsed.event, properties: parsed.properties };
}

function requireElement<T extends Node>(element: T | null, message: string): T {
  if (!element) throw new Error(message);
  return element;
}

async function mount(
  options: { telemetryDisabled?: boolean } = {},
): Promise<Harness> {
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({ selectedMenu: "home", hasOpenedInspector: true }),
  );
  const telemetryBodies: TelemetryBody[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === TELEMETRY_INGEST_URL) {
        telemetryBodies.push(parseTelemetryBody(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      if (String(input) === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected Inspector request: ${String(input)}`);
    }),
  );

  const inspector = new WebInspectorElement();
  const core = options.telemetryDisabled
    ? new TelemetryDisabledCore({
        runtimeUrl: "http://localhost:4000/api/copilotkit",
        deferInitialConnection: true,
      })
    : null;
  inspector.core = core;
  document.body.append(inspector);
  await inspector.updateComplete;
  inspector.openInspector("floating_button");
  await inspector.updateComplete;
  await Promise.resolve();

  const root = requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );
  return {
    inspector,
    telemetryBodies,
    root,
    teardown: () => {
      inspector.remove();
      core?.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
    },
  };
}

function storyEvents(harness: Harness) {
  return harness.telemetryBodies.filter(
    ({ event }) => event === TELEMETRY_EVENTS.homeStoryBeatSelected,
  );
}

function storyTab(root: ShadowRoot, label: string) {
  return requireElement(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        ".inspector-intelligence-story-tab",
      ),
    ).find((button) => button.textContent?.trim() === label) ?? null,
    `Intelligence story tab was not rendered: ${label}`,
  );
}

function reducedMotionQuery(query: string): MediaQueryList {
  return {
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

test("a pressed rail button reports the beat by id and position", async () => {
  const harness = await mount();
  try {
    storyTab(harness.root, "Skills").click();
    await harness.inspector.updateComplete;

    expect(storyEvents(harness)).toHaveLength(1);
    expect(storyEvents(harness)[0]?.properties).toMatchObject({
      beat: "skill",
      beat_index: 2,
    });
  } finally {
    harness.teardown();
  }
});

test("the story advancing on its own reports nothing", async () => {
  const harness = await mount();
  try {
    await vi.advanceTimersByTimeAsync(13_000);
    await harness.inspector.updateComplete;

    expect(
      harness.root
        .querySelector("[data-inspector-intelligence-story]")
        ?.getAttribute("data-beat"),
    ).toBe("skill");
    expect(storyEvents(harness)).toHaveLength(0);
  } finally {
    harness.teardown();
  }
});

test("reduced motion parks the story until the developer selects a beat", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(reducedMotionQuery);
  const harness = await mount();
  try {
    await harness.inspector.updateComplete;
    expect(
      harness.root
        .querySelector("[data-inspector-intelligence-story]")
        ?.getAttribute("data-beat"),
    ).toBe("intelligence");

    storyTab(harness.root, "Learning").click();
    await harness.inspector.updateComplete;

    expect(
      harness.root
        .querySelector("[data-inspector-intelligence-story]")
        ?.getAttribute("data-beat"),
    ).toBe("learning");
  } finally {
    harness.teardown();
  }
});

test("a telemetry-disabled runtime reports nothing at all", async () => {
  const harness = await mount({ telemetryDisabled: true });
  try {
    storyTab(harness.root, "Learning").click();
    await harness.inspector.updateComplete;

    expect(storyEvents(harness)).toHaveLength(0);
  } finally {
    harness.teardown();
  }
});
