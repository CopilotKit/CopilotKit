/** @vitest-environment jsdom */

import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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

async function approveEdit(
  selectedPlaceIds: Set<string>,
  placeIds?: string[][],
) {
  const respond = vi.fn(async (_result: unknown): Promise<void> => {});

  await act(async () => {
    root.render(
      <ActionButtons
        status={ToolCallStatus.Executing}
        respond={respond}
        approve="Save"
        reject="Cancel"
        selectedPlaceIdsByTrip={new Map([["trip-1", selectedPlaceIds]])}
        tripPlaceIds={(placeIds || [Array.from(selectedPlaceIds)]).map(
          (currentPlaceIds) => ({
            tripId: "trip-1",
            placeIds: currentPlaceIds,
          }),
        )}
        type="edit"
      />,
    );
  });

  await act(async () => getSaveButton().click());
  return respond;
}

test("sends an explicit edit replacement response", async () => {
  const respond = await approveEdit(new Set(["kept-place", "added-place"]));

  expect(respond).toHaveBeenCalledWith(
    JSON.stringify({
      operation: "replace",
      selections: [
        {
          tripId: "trip-1",
          placeIds: ["kept-place", "added-place"],
        },
      ],
    }),
  );
});

test("uses every proposed place for an untouched edit approval", async () => {
  const respond = await approveEdit(new Set(), [["kept-place", "added-place"]]);

  expect(respond).toHaveBeenCalledWith(
    JSON.stringify({
      operation: "replace",
      selections: [
        {
          tripId: "trip-1",
          placeIds: ["kept-place", "added-place"],
        },
      ],
    }),
  );
});

async function approveMultipleTrips(type: "add" | "edit") {
  const respond = vi.fn(async (_result: unknown): Promise<void> => {});

  await act(async () => {
    root.render(
      <ActionButtons
        status={ToolCallStatus.Executing}
        respond={respond}
        approve="Save"
        reject="Cancel"
        selectedPlaceIdsByTrip={
          new Map([
            ["trip-a", new Set(["a-selected"])],
            ["trip-b", new Set(["b-selected"])],
          ])
        }
        tripPlaceIds={[
          { tripId: "trip-a", placeIds: ["a-selected", "a-other"] },
          { tripId: "trip-b", placeIds: ["b-selected", "b-other"] },
        ]}
        type={type}
      />,
    );
  });

  await act(async () => getSaveButton().click());
  return respond;
}

function expectMultiTripResponse(
  respond: ReturnType<typeof vi.fn>,
  operation: "replace" | "select",
): void {
  expect(respond).toHaveBeenCalledWith(
    JSON.stringify({
      operation,
      selections: [
        { tripId: "trip-a", placeIds: ["a-selected"] },
        { tripId: "trip-b", placeIds: ["b-selected"] },
      ],
    }),
  );
}

test("sends edit selections with their trip IDs", async () => {
  expectMultiTripResponse(await approveMultipleTrips("edit"), "replace");
});

test("sends add selections with their trip IDs", async () => {
  expectMultiTripResponse(await approveMultipleTrips("add"), "select");
});
