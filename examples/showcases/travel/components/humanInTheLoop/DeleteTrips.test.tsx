import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import type { Place, Trip } from "../../lib/types";

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Complete: "complete", Executing: "executing" },
}));

vi.mock("@/components/PlaceCard", () => ({
  PlaceCard: ({ place }: { place: Place }) => (
    <span data-place-id={place.id}>{place.name}</span>
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
      description: null,
    },
  ],
};

test("keeps deleted-trip details and disabled controls in the completed card", () => {
  const markup = renderToStaticMarkup(
    <DeleteTrips
      args={{ trip_ids: [trip.id] }}
      status={ToolCallStatus.Complete}
      trips={[trip]}
    />,
  );

  expect(markup).toContain("Lisbon conference");
  expect(markup).toContain('data-place-id="place-1"');
  expect(markup).toContain("Delete");
  expect(markup).toContain("Cancel");
  expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
});
