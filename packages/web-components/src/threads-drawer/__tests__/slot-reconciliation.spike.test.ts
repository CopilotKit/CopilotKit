/**
 * De-risk spike (required by the design).
 *
 * Proves that the id-keyed per-row `<slot name="row:{id}">` projection survives
 * a live reorder of `threads` WITHOUT remounting/recreating the slotted row
 * content. Two independent identity guarantees are asserted across a reorder:
 *
 *  1. The wrapper-provided light-DOM node (projected into the slot) is never
 *     touched by the element — it is the same DOM node before and after.
 *  2. The shadow-side `<slot name="row:{id}">` element for a given thread id is
 *     reused (same node identity), because `repeat()` is keyed by thread id —
 *     so projection is preserved rather than torn down and re-established.
 */
import { afterEach, expect, test, vi } from "vitest";
import {
  COPILOTKIT_THREADS_DRAWER_TAG,
  defineCopilotKitThreadsDrawer,
} from "../index";
import type { DrawerThread, CopilotKitThreadsDrawer } from "../index";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function flush(element: CopilotKitThreadsDrawer) {
  await element.updateComplete;
  await tick();
  await element.updateComplete;
}

function thread(id: string, updatedAt: string): DrawerThread {
  return {
    id,
    name: `Thread ${id}`,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

test("id-keyed per-row slot reconciliation survives a live reorder without remounting slotted content", async () => {
  defineCopilotKitThreadsDrawer();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }) as unknown as typeof window.matchMedia;

  const element = document.createElement(
    COPILOTKIT_THREADS_DRAWER_TAG,
  ) as CopilotKitThreadsDrawer;

  // Newest-first ordering by updatedAt → initial order is [a, b].
  element.threads = [
    thread("a", "2026-06-20T00:00:00.000Z"),
    thread("b", "2026-06-10T00:00:00.000Z"),
  ];

  // Wrapper projects per-row light-DOM content for each thread id.
  const rowA = document.createElement("span");
  rowA.slot = "row:a";
  rowA.id = "wrapper-row-a";
  const rowB = document.createElement("span");
  rowB.slot = "row:b";
  rowB.id = "wrapper-row-b";
  element.append(rowA, rowB);

  document.body.appendChild(element);
  await flush(element);

  const shadow = element.shadowRoot as ShadowRoot;
  const slotForBefore = (id: string) =>
    shadow.querySelector(`slot[name="row:${id}"]`) as HTMLSlotElement;

  const slotABefore = slotForBefore("a");
  const slotBBefore = slotForBefore("b");
  const orderBefore = Array.from(shadow.querySelectorAll("li.row")).map((el) =>
    el.getAttribute("data-thread-id"),
  );
  expect(orderBefore).toEqual(["a", "b"]);
  expect(slotABefore.assignedElements()[0]).toBe(rowA);
  expect(slotBBefore.assignedElements()[0]).toBe(rowB);

  // Live reorder: bump b to be the newest → order should become [b, a].
  element.threads = [
    thread("a", "2026-06-20T00:00:00.000Z"),
    thread("b", "2026-06-25T00:00:00.000Z"),
  ];
  await flush(element);

  const slotAAfter = shadow.querySelector(
    'slot[name="row:a"]',
  ) as HTMLSlotElement;
  const slotBAfter = shadow.querySelector(
    'slot[name="row:b"]',
  ) as HTMLSlotElement;
  const orderAfter = Array.from(shadow.querySelectorAll("li.row")).map((el) =>
    el.getAttribute("data-thread-id"),
  );

  // The visual order changed...
  expect(orderAfter).toEqual(["b", "a"]);

  // ...but the keyed slot nodes were REUSED (node identity preserved), not
  // recreated — keyed reconciliation moved them rather than tearing down.
  expect(slotAAfter).toBe(slotABefore);
  expect(slotBAfter).toBe(slotBBefore);

  // ...and the projected wrapper light-DOM nodes are the exact same instances,
  // still assigned to their id-matched slots (no remount of slotted content).
  expect(slotAAfter.assignedElements()[0]).toBe(rowA);
  expect(slotBAfter.assignedElements()[0]).toBe(rowB);
  expect(document.getElementById("wrapper-row-a")).toBe(rowA);
  expect(document.getElementById("wrapper-row-b")).toBe(rowB);

  element.remove();
});
