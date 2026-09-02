import { expect, test } from "vitest";
import { isAgentStateInitialized, normalizeAgentState } from "./agent-state";
import { defaultTrips } from "./types";

test("falls back to default trips when an agent trip or place is invalid", () => {
  const state = normalizeAgentState({
    trips: [
      {
        id: "unsafe-trip",
        name: "Unsafe trip",
        center_latitude: 0,
        center_longitude: 0,
        places: [null],
      },
      null,
    ],
    selected_trip_id: null,
  });

  expect(state.trips).toEqual(defaultTrips);
});

test("preserves agent trips with a null place description", () => {
  const trips = [
    {
      ...defaultTrips[0],
      places: [
        {
          ...defaultTrips[0].places[0],
          description: null,
        },
      ],
    },
  ];

  const state = normalizeAgentState({
    trips,
    selected_trip_id: trips[0].id,
  });

  expect(state.trips).toEqual(trips);
});

test("drops malformed search progress", () => {
  const state = normalizeAgentState({
    trips: defaultTrips,
    selected_trip_id: defaultTrips[0]?.id,
    search_progress: [{ query: 42, done: "yes" }],
  });

  expect(state.search_progress).toBeUndefined();
});

test("uses the default selection when the selected trip ID is malformed", () => {
  const state = normalizeAgentState({
    trips: defaultTrips,
    selected_trip_id: { id: defaultTrips[1]?.id },
  });

  expect(state.selected_trip_id).toBe(defaultTrips[0]?.id);
});

test("rejects initialized state with an invalid nested trips array", () => {
  expect(
    isAgentStateInitialized({
      trips: [
        {
          ...defaultTrips[0],
          places: [null],
        },
      ],
      selected_trip_id: defaultTrips[0]?.id,
    }),
  ).toBe(false);
});

test("accepts initialized state with valid trips and a selection", () => {
  expect(
    isAgentStateInitialized({
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0]?.id,
    }),
  ).toBe(true);
});
