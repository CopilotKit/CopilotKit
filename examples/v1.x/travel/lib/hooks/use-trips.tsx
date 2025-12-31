import { SearchProgress } from "@/components/SearchProgress";
import { useCoAgent, useCoAgentStateRender, useCopilotAction } from "@copilotkit/react-core";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { createContext, useContext, ReactNode, useMemo } from "react";
import { AddTrips, EditTrips, DeleteTrips } from "@/components/humanInTheLoop";
import { Trip, Place, AgentState, defaultTrips} from "@/lib/types";

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
  const { state, setState } = useCoAgent<AgentState>({
    name: "travel",
    initialState: {
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0].id || "1",
    },
  });

  useCoAgentStateRender<AgentState>({
    name: "travel",
    render: ({ state }) => {
      if (state.search_progress && state.search_progress.length > 0) {
        return <SearchProgress progress={state.search_progress} />
      }
      return null;
    },
  });

  useCopilotChatSuggestions({
    instructions: `Offer the user actionable suggestions on their last message, current trips and selected trip.\n ${state.selected_trip_id} \n ${JSON.stringify(state.trips)}`,
    minSuggestions: 1,
    maxSuggestions: 2,
  }, [state.trips]);

  useCopilotAction({ 
    name: "add_trips",
    description: "Add some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to add",
        required: true,
      },
    ],
    renderAndWait: AddTrips,
  });

  useCopilotAction({
    name: "update_trips",
    description: "Update some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to update",
        required: true,
      },
    ],
    renderAndWait: (props) => EditTrips({ ...props, trips: state.trips, selectedTripId: state.selected_trip_id as string }),
  });

  useCopilotAction({
    name: "delete_trips",
    description: "Delete some trips",
    parameters: [
      {
        name: "trip_ids",
        type: "string[]",
        description: "The ids of the trips to delete",
        required: true,
      },
    ],
    renderAndWait: (props) => DeleteTrips({ ...props, trips: state.trips }),
  });

  const selectedTrip = useMemo(() => {
    if (!state.selected_trip_id || !state.trips) return null;
    return state.trips.find((trip) => trip.id === state.selected_trip_id);
  }, [state.trips, state.selected_trip_id]);

  /*
  * Helper functions for trips
  */
  const addTrip = (trip: Trip) => {
    setState({ ...state, trips: [...state.trips, trip]});
  };

  const updateTrip = (id: string, updatedTrip: Trip) => {
    setState({
      ...state,
      trips: state.trips.map((trip) =>
        trip.id === id ? updatedTrip : trip
      ),
    });
  };

  const deleteTrip = (id: string) => {
    setState({ ...state, trips: state.trips.filter((trip) => trip.id !== id) });
  };

  const setSelectedTripId = (trip_id: string | null) => {
    setState({ ...state, selected_trip_id: trip_id });
  };

  /*
  * Helper functions for places
  */
  const updatePlace = (tripId: string, placeId: string, updatedPlace: Place) => {
    setState({
      ...state,
      trips: state.trips.map((trip) =>
        trip.id === tripId ? { ...trip, places: trip.places.map((place) => place.id === placeId ? updatedPlace : place) } : trip
      ),
    });
  };

  const addPlace = (tripId: string, place: Place) => {
    setState({
      ...state,
      trips: state.trips.map((trip) => trip.id === tripId ? { ...trip, places: [...trip.places, place] } : trip),
    });
  };

  const deletePlace = (tripId: string, placeId: string) => {
    setState({
      ...state,
      trips: state.trips.map((trip) => trip.id === tripId ? { ...trip, places: trip.places.filter((place) => place.id !== placeId) } : trip),
    });
  };

  return (
    <TripsContext.Provider value={{ 
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
    }}>
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