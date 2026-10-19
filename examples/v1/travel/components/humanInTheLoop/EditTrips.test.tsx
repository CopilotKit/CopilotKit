/** @vitest-environment jsdom */

import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import type { Place, Trip } from "../../lib/types";
import { EditTrips } from "./EditTrips";

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Executing: "executing" },
}));

/** Create a place with enough data for the real place card. */
function createPlace(id: string): Place {
  return {
    id,
    name: id,
    address: `${id} address`,
    latitude: 0,
    longitude: 0,
    rating: 5,
    description: null,
  };
}

/** Create independent trip fixtures. */
function trip(id: string, placeIds: string[]): Trip {
  return {
    id,
    name: id,
    center_latitude: 0,
    center_longitude: 0,
    zoom: 10,
    places: placeIds.map(createPlace),
  };
}

/** Mount the real edit form and clean up every resource owned by a test. */
async function setup(proposals: Trip[], currentTrips: Trip[]) {
  const previousActEnvironment = Reflect.get(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const respond = vi.fn(async (_result: unknown): Promise<void> => {});
  await act(async () => {
    root.render(
      <EditTrips
        args={{ trips: proposals }}
        status={ToolCallStatus.Executing}
        trips={currentTrips}
        respond={respond}
      />,
    );
  });

  return {
    container,
    respond,
    checkbox(index: number): HTMLButtonElement {
      const checkbox =
        container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[
          index
        ];
      if (!checkbox) throw new Error(`Missing checkbox ${index}`);
      return checkbox;
    },
    async save(): Promise<void> {
      const save = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Save",
      );
      if (!save) throw new Error("Missing Save button");
      await act(async () => save.click());
    },
    teardown(): void {
      act(() => root.unmount());
      container.remove();
      Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      });
    },
  };
}

test("keeps unchanged places when a proposed addition is deselected", async () => {
  const form = await setup(
    [trip("trip-1", ["kept", "added"])],
    [trip("trip-1", ["kept"])],
  );
  try {
    await act(async () => form.checkbox(0).click());
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [{ tripId: "trip-1", placeIds: ["kept"] }],
      }),
    );
  } finally {
    form.teardown();
  }
});

test("selecting an addition again preserves the hidden unchanged place", async () => {
  const form = await setup(
    [trip("trip-1", ["kept", "added"])],
    [trip("trip-1", ["kept"])],
  );
  try {
    expect(form.checkbox(0).getAttribute("aria-checked")).toBe("true");
    await act(async () => form.checkbox(0).click());
    await act(async () => form.checkbox(0).click());
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [{ tripId: "trip-1", placeIds: ["kept", "added"] }],
      }),
    );
  } finally {
    form.teardown();
  }
});

test("a removed place can be selected to keep it", async () => {
  const form = await setup(
    [trip("trip-1", ["kept", "added"])],
    [trip("trip-1", ["kept", "removed"])],
  );
  try {
    expect(form.checkbox(1).getAttribute("aria-checked")).toBe("false");
    await act(async () => form.checkbox(1).click());
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [
          { tripId: "trip-1", placeIds: ["kept", "added", "removed"] },
        ],
      }),
    );
  } finally {
    form.teardown();
  }
});

test("matches each trip independently and keeps hidden places when both are edited", async () => {
  const form = await setup(
    [
      trip("other", ["other-kept", "other-added"]),
      trip("selected", ["selected-kept", "selected-added"]),
    ],
    [
      trip("selected", ["selected-kept", "selected-removed"]),
      trip("other", ["other-kept", "other-removed"]),
    ],
  );
  try {
    expect(form.container.textContent).not.toContain("other-kept");
    expect(form.container.textContent).not.toContain("selected-kept");
    expect(form.container.textContent).toContain("other-removed");
    expect(form.container.textContent).toContain("selected-removed");
    await act(async () => form.checkbox(0).click());
    await act(async () => form.checkbox(3).click());
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [
          { tripId: "other", placeIds: ["other-kept"] },
          {
            tripId: "selected",
            placeIds: ["selected-kept", "selected-added", "selected-removed"],
          },
        ],
      }),
    );
  } finally {
    form.teardown();
  }
});

test("saving without checkbox changes approves every proposal", async () => {
  const form = await setup(
    [trip("trip-1", ["kept", "added"]), trip("trip-2", [])],
    [trip("trip-1", ["kept", "removed"]), trip("trip-2", ["removed-2"])],
  );
  try {
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [{ tripId: "trip-1" }, { tripId: "trip-2" }],
      }),
    );
    expect(form.checkbox(0).getAttribute("aria-checked")).toBe("true");
    expect(form.checkbox(1).getAttribute("aria-checked")).toBe("false");
  } finally {
    form.teardown();
  }
});

test("deselecting a restored place can leave an explicitly empty trip", async () => {
  const form = await setup([trip("trip-1", [])], [trip("trip-1", ["removed"])]);
  try {
    await act(async () => form.checkbox(0).click());
    await act(async () => form.checkbox(0).click());
    await form.save();

    expect(form.respond).toHaveBeenCalledWith(
      JSON.stringify({
        operation: "replace",
        selections: [{ tripId: "trip-1", placeIds: [] }],
      }),
    );
  } finally {
    form.teardown();
  }
});
