import { z } from "zod";
import { defaultTrips } from "./types";
import type { AgentState } from "./types";

const defaultSelectedTripId = defaultTrips[0]?.id ?? null;

export const placeSchema = z.object({
  id: z.string().describe("The place ID"),
  name: z.string().describe("The place name"),
  address: z.string().describe("The place address"),
  latitude: z.number().describe("The place latitude"),
  longitude: z.number().describe("The place longitude"),
  rating: z.number().describe("The place rating"),
  description: z.string().nullable().describe("A short place description"),
});

export const tripSchema = z.object({
  id: z.string().describe("The trip ID"),
  name: z.string().describe("The trip name"),
  center_latitude: z.number().describe("The map center latitude"),
  center_longitude: z.number().describe("The map center longitude"),
  zoom_level: z.number().optional().describe("The map zoom level"),
  places: z.array(placeSchema).describe("Places included in the trip"),
});

export const tripsSchema = z.object({
  trips: z.array(tripSchema).describe("The trips to review"),
});

const agentTripsSchema = tripsSchema.shape.trips;
const selectedTripIdSchema = z.string().nullable();
const searchProgressSchema = z.array(
  z.object({
    query: z.string(),
    done: z.boolean(),
  }),
);
const initializedAgentStateSchema = z.object({
  trips: agentTripsSchema,
  selected_trip_id: selectedTripIdSchema,
  search_progress: searchProgressSchema.optional(),
});

/**
 * Checks whether the agent state already contains safe values for the UI.
 */
export function isAgentStateInitialized(value: unknown): boolean {
  return initializedAgentStateSchema.safeParse(value).success;
}

/**
 * Fills missing agent state with the travel example defaults.
 */
export function normalizeAgentState(value: unknown): AgentState {
  const state =
    value !== null && typeof value === "object"
      ? (value as Partial<AgentState>)
      : {};
  const trips = agentTripsSchema.safeParse(state.trips);
  const selectedTripId = selectedTripIdSchema.safeParse(state.selected_trip_id);
  const searchProgress = searchProgressSchema.safeParse(state.search_progress);

  return {
    ...state,
    trips: trips.success ? trips.data : defaultTrips,
    selected_trip_id:
      selectedTripId.success && state.selected_trip_id !== undefined
        ? selectedTripId.data
        : defaultSelectedTripId,
    search_progress: searchProgress.success ? searchProgress.data : undefined,
  };
}
