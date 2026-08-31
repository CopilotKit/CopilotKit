import { SearchProgress } from "@/components/SearchProgress";
import {
  useAgent,
  useConfigureSuggestions,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { AddTrips, EditTrips, DeleteTrips } from "@/components/humanInTheLoop";
import { defaultTrips } from "@/lib/types";
import type { AgentState, Place, Trip } from "@/lib/types";
import { z } from "zod";

const defaultSelectedTripId = defaultTrips[0]?.id ?? null;

const placeSchema = z.object({
  id: z.string().describe("The place ID"),
  name: z.string().describe("The place name"),
  address: z.string().describe("The place address"),
  latitude: z.number().describe("The place latitude"),
  longitude: z.number().describe("The place longitude"),
  rating: z.number().describe("The place rating"),
  description: z.string().optional().describe("A short place description"),
});

const tripSchema = z.object({
  id: z.string().describe("The trip ID"),
  name: z.string().describe("The trip name"),
  center_latitude: z.number().describe("The map center latitude"),
  center_longitude: z.number().describe("The map center longitude"),
  zoom_level: z.number().optional().describe("The map zoom level"),
  places: z.array(placeSchema).describe("Places included in the trip"),
});

const tripsSchema = z.object({
  trips: z.array(tripSchema).describe("The trips to review"),
});

const deleteTripsSchema = z.object({
  trip_ids: z.array(z.string()).describe("The IDs of the trips to delete"),
});

function normalizeAgentState(value: unknown): AgentState {
  const state =
    value !== null && typeof value === "object"
      ? (value as Partial<AgentState>)
      : {};

  return {
    ...state,
    trips: Array.isArray(state.trips) ? state.trips : defaultTrips,
    selected_trip_id:
      state.selected_trip_id === undefined
        ? defaultSelectedTripId
        : state.selected_trip_id,
    search_progress: Array.isArray(state.search_progress)
      ? state.search_progress
      : undefined,
  };
}

type TripsContextType = {
  trips: Trip[];
  selectedTripId: string | null;
  selectedTrip?: Trip | null;
  setSelectedTripId: (trip_id: string | null) => void;
  addTrip: (trip: Trip) => void;
  updateTrip: (id: string, updatedTrip: Trip) => void;
  deleteTrip: (id: string) => void;
  addPlace: (tripId: string, place: Place) => void;
  updatePlace: (tripId: string, placeId: string, updatedPlace: Place) => void;
  deletePlace: (tripId: string, placeId: string) => void;
};

const TripsContext = createContext<TripsContextType | undefined>(undefined);

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  const { agent, isReady } = useAgent({ agentId: "travel" });
  const state = normalizeAgentState(agent.state);

  useEffect(() => {
    if (!isReady) return;

    const currentState =
      agent.state !== null && typeof agent.state === "object"
        ? (agent.state as Partial<AgentState>)
        : {};

    if (
      Array.isArray(currentState.trips) &&
      currentState.selected_trip_id !== undefined
    ) {
      return;
    }

    agent.setState(normalizeAgentState(currentState));
  }, [agent, isReady]);

  useRenderTool(
    {
      name: "search_for_places",
      agentId: "travel",
      parameters: z.object({
        queries: z.array(z.string()).describe("The place searches to run"),
      }),
      render: () =>
        state.search_progress && state.search_progress.length > 0 ? (
          <SearchProgress progress={state.search_progress} />
        ) : (
          <></>
        ),
    },
    [state.search_progress],
  );

  useConfigureSuggestions(
    {
      consumerAgentId: "travel",
      providerAgentId: "travel",
      instructions: `Offer the user actionable suggestions on their last message, current trips and selected trip.\n ${state.selected_trip_id} \n ${JSON.stringify(state.trips)}`,
      minSuggestions: 1,
      maxSuggestions: 2,
      available: "before-first-message",
    },
    [state.trips, state.selected_trip_id],
  );

  useHumanInTheLoop({
    name: "add_trips",
    agentId: "travel",
    description: "Add some trips",
    parameters: tripsSchema,
    render: ({ args, status, respond }) => (
      <AddTrips args={args} status={status} respond={respond} />
    ),
  });

  useHumanInTheLoop(
    {
      name: "update_trips",
      agentId: "travel",
      description: "Update some trips",
      parameters: tripsSchema,
      render: ({ args, status, respond }) => (
        <EditTrips
          args={args}
          status={status}
          respond={respond}
          trips={state.trips}
          selectedTripId={state.selected_trip_id}
        />
      ),
    },
    [state.trips, state.selected_trip_id],
  );

  useHumanInTheLoop(
    {
      name: "delete_trips",
      agentId: "travel",
      description: "Delete some trips",
      parameters: deleteTripsSchema,
      render: ({ args, status, respond }) => (
        <DeleteTrips
          args={args}
          status={status}
          respond={respond}
          trips={state.trips}
        />
      ),
    },
    [state.trips],
  );

  const selectedTrip = useMemo(() => {
    if (!state.selected_trip_id || !state.trips) return null;
    return state.trips.find((trip) => trip.id === state.selected_trip_id);
  }, [state.trips, state.selected_trip_id]);

  /*
   * Helper functions for trips
   */
  const addTrip = (trip: Trip) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: [...currentState.trips, trip],
    });
  };

  const updateTrip = (id: string, updatedTrip: Trip) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: currentState.trips.map((trip) =>
        trip.id === id ? updatedTrip : trip,
      ),
    });
  };

  const deleteTrip = (id: string) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: currentState.trips.filter((trip) => trip.id !== id),
    });
  };

  const setSelectedTripId = (trip_id: string | null) => {
    agent.setState({
      ...normalizeAgentState(agent.state),
      selected_trip_id: trip_id,
    });
  };

  /*
   * Helper functions for places
   */
  const updatePlace = (
    tripId: string,
    placeId: string,
    updatedPlace: Place,
  ) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: currentState.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              places: trip.places.map((place) =>
                place.id === placeId ? updatedPlace : place,
              ),
            }
          : trip,
      ),
    });
  };

  const addPlace = (tripId: string, place: Place) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: currentState.trips.map((trip) =>
        trip.id === tripId
          ? { ...trip, places: [...trip.places, place] }
          : trip,
      ),
    });
  };

  const deletePlace = (tripId: string, placeId: string) => {
    const currentState = normalizeAgentState(agent.state);
    agent.setState({
      ...currentState,
      trips: currentState.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              places: trip.places.filter((place) => place.id !== placeId),
            }
          : trip,
      ),
    });
  };

  return (
    <TripsContext.Provider
      value={{
        trips: state.trips,
        selectedTripId: state.selected_trip_id,
        selectedTrip,
        setSelectedTripId,
        addTrip,
        updateTrip,
        deleteTrip,
        addPlace,
        updatePlace,
        deletePlace,
      }}
    >
      {children}
    </TripsContext.Provider>
  );
};

export const useTrips = () => {
  const context = useContext(TripsContext);
  if (context === undefined) {
    throw new Error("useTrips must be used within a TripsProvider");
  }
  return context;
};
