import { afterEach, expect, test, vi } from "vitest";

import { CpkThreadInspector, setInspectorJsonRenderer } from "../index.js";
import type { ThreadDebuggerProvider } from "../index.js";

const MESSAGES = [
  { id: "user", role: "user", content: "Find a meeting time" },
  {
    id: "tool-message",
    role: "assistant",
    toolCalls: [
      { id: "calendar", name: "check_calendars", args: { day: "Thursday" } },
    ],
  },
  {
    id: "result",
    role: "tool",
    toolCallId: "calendar",
    content: '{"available":true}',
  },
];

afterEach(() => {
  setInspectorJsonRenderer(null);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/**
 * Runs `requestAnimationFrame` callbacks at once, like the other inspector
 * specs, so layout work finishes inside a flush.
 */
function installImmediateAnimationFrame(): void {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

/**
 * Waits for the inspector and the updates it starts to settle.
 *
 * @param detail - The inspector element.
 */
async function flush(detail: CpkThreadInspector): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
    await detail.updateComplete;
  }
}

/**
 * Mounts a thread inspector with one tool call and opens that tool call.
 *
 * @returns The inspector element.
 */
async function mountWithOpenToolCall(): Promise<CpkThreadInspector> {
  installImmediateAnimationFrame();
  const provider: ThreadDebuggerProvider = {
    getMessages: vi.fn().mockResolvedValue(MESSAGES),
    getEvents: vi.fn().mockResolvedValue([]),
  };
  const detail = new CpkThreadInspector();
  detail.threadId = "json-renderer-thread";
  detail.provider = provider;
  document.body.append(detail);
  await flush(detail);
  detail
    .shadowRoot!.querySelector<HTMLElement>(".cpk-td__tool-header")!
    .click();
  await flush(detail);
  return detail;
}

test("a host renderer draws tool arguments and results into light-DOM containers", async () => {
  const drawn: Array<{ container: HTMLElement; value: unknown }> = [];
  setInspectorJsonRenderer((container, value) => {
    drawn.push({ container, value });
    container.textContent = `host:${JSON.stringify(value)}`;
  });

  const detail = await mountWithOpenToolCall();
  const body = detail.shadowRoot!.querySelector(".cpk-td__tool-body")!;

  expect(body.querySelector("pre.cpk-json-block")).toBeNull();
  expect(drawn).toHaveLength(2);
  expect(JSON.stringify(drawn[0]?.value)).toContain("Thursday");
  expect(JSON.stringify(drawn[1]?.value)).toContain("available");
  for (const { container } of drawn) {
    // The container belongs to the inspector's light DOM, so page styles
    // reach it, and a slot inside the tool body shows it in place.
    expect(container.parentElement).toBe(detail);
    const slot = body.querySelector<HTMLSlotElement>(
      `slot[name="${container.slot}"]`,
    );
    expect(slot?.assignedElements()).toEqual([container]);
  }
});

test("closing the tool call runs the cleanup and removes the containers", async () => {
  const cleanup = vi.fn();
  setInspectorJsonRenderer(() => cleanup);

  const detail = await mountWithOpenToolCall();
  expect(detail.querySelectorAll("[slot^='cpk-json-']")).toHaveLength(2);

  detail
    .shadowRoot!.querySelector<HTMLElement>(".cpk-td__tool-header")!
    .click();
  await flush(detail);

  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(detail.querySelectorAll("[slot^='cpk-json-']")).toHaveLength(0);
});

test("a render with the same values does not draw again", async () => {
  const renderer = vi.fn();
  setInspectorJsonRenderer(renderer);

  const detail = await mountWithOpenToolCall();
  expect(renderer).toHaveBeenCalledTimes(2);

  detail.requestUpdate();
  await flush(detail);

  expect(renderer).toHaveBeenCalledTimes(2);
});

test("without a host renderer the built-in highlighted block stays", async () => {
  const detail = await mountWithOpenToolCall();
  const body = detail.shadowRoot!.querySelector(".cpk-td__tool-body")!;

  expect(body.querySelectorAll("pre.cpk-json-block")).toHaveLength(2);
  expect(body.querySelector("cpk-json-block")).toBeNull();
});
