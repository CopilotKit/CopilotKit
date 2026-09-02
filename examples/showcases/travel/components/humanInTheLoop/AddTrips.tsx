import type { Place, Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Plus } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import type { PlaceSelectionsByTrip } from "./ActionButtons";
import type { ToolCallStatus } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

export type AddTripsProps = {
  args: Partial<{ trips: Trip[] }>;
  status: ToolCallStatus;
  respond?: (result: unknown) => Promise<void>;
};

export const AddTrips = ({ args, status, respond }: AddTripsProps) => {
  useEffect(() => {
    console.log(args, "argsAddTripsargsAddTripsargsAddTrips");
  }, [args]);
  const [selectedPlaceIdsByTrip, setSelectedPlaceIdsByTrip] = useState(
    new Map<string, Set<string>>(),
  );
  const handleCheck = (tripId: string, placeId: string, checked: boolean) => {
    setSelectedPlaceIdsByTrip((previousSelections) => {
      const nextSelections: PlaceSelectionsByTrip = new Map(previousSelections);
      const selectedPlaceIds = new Set(nextSelections.get(tripId));
      if (checked) {
        selectedPlaceIds.add(placeId);
      } else {
        selectedPlaceIds.delete(placeId);
      }
      nextSelections.set(tripId, selectedPlaceIds);
      return nextSelections;
    });
  };

  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
      {args.trips?.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <h1 className="text-sm">The following trips will be added:</h1>
          <hr className="my-2" />
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{trip.name}</h2>
            {trip.places?.map((place) => (
              <PlaceCard
                key={place.id}
                place={place}
                checked={selectedPlaceIdsByTrip.get(trip.id)?.has(place.id)}
                onCheck={(checked) =>
                  handleCheck(trip.id, place.id, checked as boolean)
                }
              />
            ))}
          </div>
        </div>
      ))}
      <ActionButtons
        selectedPlaceIdsByTrip={selectedPlaceIdsByTrip}
        setSelectedPlaceIdsByTrip={setSelectedPlaceIdsByTrip}
        tripPlaceIds={args.trips?.map((trip: Trip) => ({
          tripId: trip.id,
          placeIds: trip.places?.map((place: Place) => place.id),
        }))}
        status={status}
        respond={respond}
        approve={
          <>
            <Plus className="w-4 h-4 mr-2" /> Add
          </>
        }
        reject={
          <>
            <X className="w-4 h-4 mr-2" /> Cancel
          </>
        }
      />
    </div>
  );
};
