import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import type { Place, Trip } from "../../lib/types";

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Complete: "complete", Executing: "executing" },
}));

vi.mock("@/components/PlaceCard", () => ({
  PlaceCard: ({ place }: { place: Place }) => (
    <article aria-label={`${place.name} details`}>
      <h3>{place.name}</h3>
      <p>{place.address}</p>
      <p>{place.description}</p>
    </article>
  ),
}));

vi.mock("./ActionButtons", () => ({
  ActionButtons: () => (
    <div data-delete-trip-actions>
      <button type="button">Cancel</button>
      <button type="button">Delete</button>
    </div>
  ),
}));

import { DeleteTrips } from "./DeleteTrips";

const trip: Trip = {
  id: "trip-1",
  name: "Lisbon conference",
  center_latitude: 38.7223,
  center_longitude: -9.1393,
  zoom: 12,
  places: [
    {
      id: "place-1",
      name: "Praça do Comércio",
      address: "Praça do Comércio, Lisbon",
      latitude: 38.7078,
      longitude: -9.1366,
      rating: 4.7,
      description: "Historic plaza beside the Tagus River",
    },
  ],
};

function setup(status: ToolCallStatus, trips: readonly Trip[] = [trip]) {
  return renderToStaticMarkup(
    <DeleteTrips
      args={{ trip_ids: [trip.id] }}
      status={status}
      trips={trips}
    />,
  );
}

test("omits actions after the live trip has been deleted", () => {
  const markup = setup(ToolCallStatus.Complete, []);

  expect(markup).not.toContain("data-delete-trip-actions");
  expect(markup).not.toContain(">Cancel</button>");
  expect(markup).not.toContain(">Delete</button>");
});

test("shows trip details and actions while deletion awaits approval", () => {
  const markup = setup(ToolCallStatus.Executing);

  expect(markup).toContain(trip.name);
  expect(markup).toContain(trip.places[0].name);
  expect(markup).toContain(trip.places[0].address);
  expect(markup).toContain(trip.places[0].description);
  expect(markup).toContain("data-delete-trip-actions");
  expect(markup).toContain("Delete");
  expect(markup).toContain("Cancel");
});
