import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { Place, Trip } from "../../lib/types";

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Executing: "executing" },
}));

vi.mock("@/components/PlaceCard", () => ({
  PlaceCard: ({ place }: { place: Place }) => (
    <span data-place-id={place.id}>{place.name}</span>
  ),
}));

vi.mock("./ActionButtons", () => ({
  ActionButtons: vi.fn(),
}));

import { EditTrips } from "./EditTrips";

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

function renderEditTrips(proposals: Trip[], currentTrips: Trip[]): string {
  return renderToStaticMarkup(
    <EditTrips
      args={{ trips: proposals }}
      status={ToolCallStatus.Executing}
      trips={currentTrips}
    />,
  );
}

function expectRenderedPlace(markup: string, id: string): void {
  expect(markup).toContain(`data-place-id="${id}"`);
}

function expectHiddenPlace(markup: string, id: string): void {
  expect(markup).not.toContain(`data-place-id="${id}"`);
}

describe("EditTrips place deltas", () => {
  test("compares a non-selected proposal with the trip that has its ID", () => {
    const currentTrips = [
      trip("selected-trip", ["selected-kept"]),
      trip("other-trip", ["other-kept", "other-removed"]),
    ];

    const markup = renderEditTrips(
      [trip("other-trip", ["other-kept", "other-added"])],
      currentTrips,
    );

    expectRenderedPlace(markup, "other-added");
    expectRenderedPlace(markup, "other-removed");
    expectHiddenPlace(markup, "other-kept");
    expectHiddenPlace(markup, "selected-kept");
  });

  test("matches each proposal independently when several trips are edited", () => {
    const currentTrips = [
      trip("selected-trip", ["selected-kept", "selected-removed"]),
      trip("other-trip", ["other-kept", "other-removed"]),
    ];

    const markup = renderEditTrips(
      [
        trip("selected-trip", ["selected-kept", "selected-added"]),
        trip("other-trip", ["other-kept", "other-added"]),
      ],
      currentTrips,
    );

    expectRenderedPlace(markup, "selected-added");
    expectRenderedPlace(markup, "selected-removed");
    expectRenderedPlace(markup, "other-added");
    expectRenderedPlace(markup, "other-removed");
    expectHiddenPlace(markup, "selected-kept");
    expectHiddenPlace(markup, "other-kept");
  });
});
