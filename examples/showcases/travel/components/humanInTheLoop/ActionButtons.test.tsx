/** @vitest-environment jsdom */

import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Executing: "executing" },
}));

import { ActionButtons } from "./ActionButtons";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  vi.restoreAllMocks();
});

function getSaveButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Save",
  );
  if (!button) {
    throw new Error("Save button was not rendered");
  }
  return button;
}

type TripPlaceIds = {
  tripId: string;
  placeIds: string[];
};

type TripPlaceSelection = {
  tripId: string;
  placeIds?: string[];
};

type RespondMock = Mock<(result: unknown) => Promise<void>>;

async function approveTrips({
  selectedPlaceIdsByTrip,
  tripPlaceIds,
  type = "edit",
}: {
  selectedPlaceIdsByTrip: Map<string, Set<string>>;
  tripPlaceIds: TripPlaceIds[];
  type?: "add" | "edit";
}) {
  const respond = vi.fn(async (_result: unknown): Promise<void> => {});

  await act(async () => {
    root.render(
      <ActionButtons
        status={ToolCallStatus.Executing}
        respond={respond}
        approve="Save"
        reject="Cancel"
        selectedPlaceIdsByTrip={selectedPlaceIdsByTrip}
        tripPlaceIds={tripPlaceIds}
        type={type}
      />,
    );
  });

  await act(async () => getSaveButton().click());
  return respond;
}

function expectResponse(
  respond: RespondMock,
  operation: "replace" | "select",
  selections: TripPlaceSelection[],
): void {
  expect(respond).toHaveBeenCalledWith(
    JSON.stringify({ operation, selections }),
  );
}

test("sends an explicit edit replacement response", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map([
      ["trip-1", new Set(["kept-place", "added-place"])],
    ]),
    tripPlaceIds: [
      { tripId: "trip-1", placeIds: ["kept-place", "added-place"] },
    ],
  });

  expectResponse(respond, "replace", [
    {
      tripId: "trip-1",
      placeIds: ["kept-place", "added-place"],
    },
  ]);
});

test("marks an untouched trip for default selection", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map(),
    tripPlaceIds: [
      { tripId: "trip-1", placeIds: ["kept-place", "added-place"] },
    ],
  });

  expectResponse(respond, "replace", [{ tripId: "trip-1" }]);
});

test("sends no place IDs for an explicitly empty trip", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map([["trip-1", new Set()]]),
    tripPlaceIds: [
      { tripId: "trip-1", placeIds: ["kept-place", "added-place"] },
    ],
  });

  expectResponse(respond, "replace", [{ tripId: "trip-1", placeIds: [] }]);
});

test("sends edit selections with their trip IDs", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map([
      ["trip-a", new Set(["a-selected"])],
      ["trip-b", new Set(["b-selected"])],
    ]),
    tripPlaceIds: [
      { tripId: "trip-a", placeIds: ["a-selected", "a-other"] },
      { tripId: "trip-b", placeIds: ["b-selected", "b-other"] },
    ],
  });

  expectResponse(respond, "replace", [
    { tripId: "trip-a", placeIds: ["a-selected"] },
    { tripId: "trip-b", placeIds: ["b-selected"] },
  ]);
});

test("sends add selections with their trip IDs", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map([
      ["trip-a", new Set(["a-selected"])],
      ["trip-b", new Set(["b-selected"])],
    ]),
    tripPlaceIds: [
      { tripId: "trip-a", placeIds: ["a-selected", "a-other"] },
      { tripId: "trip-b", placeIds: ["b-selected", "b-other"] },
    ],
    type: "add",
  });

  expectResponse(respond, "select", [
    { tripId: "trip-a", placeIds: ["a-selected"] },
    { tripId: "trip-b", placeIds: ["b-selected"] },
  ]);
});

test("keeps untouched, empty, and subset selections separate by trip", async () => {
  const respond = await approveTrips({
    selectedPlaceIdsByTrip: new Map([
      ["trip-empty", new Set()],
      ["trip-subset", new Set(["subset-selected"])],
    ]),
    tripPlaceIds: [
      { tripId: "trip-default", placeIds: ["default-place"] },
      { tripId: "trip-empty", placeIds: ["empty-place"] },
      {
        tripId: "trip-subset",
        placeIds: ["subset-selected", "subset-other"],
      },
    ],
  });

  expectResponse(respond, "replace", [
    { tripId: "trip-default" },
    { tripId: "trip-empty", placeIds: [] },
    { tripId: "trip-subset", placeIds: ["subset-selected"] },
  ]);
});
