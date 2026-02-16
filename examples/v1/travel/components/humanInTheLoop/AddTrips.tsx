import { Place, Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Plus } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import { RenderFunctionStatus } from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import { useTrips } from "@/lib/hooks/use-trips";

export type AddTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
};

export const AddTrips = ({ args, status, handler }: AddTripsProps) => {
  useEffect(() => {
    console.log(args, "argsAddTripsargsAddTripsargsAddTrips");
  }, [args]);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(
    new Set(),
  );
  const handleCheck = (placeId: string, checked: boolean) => {
    setSelectedPlaceIds((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(placeId);
      } else {
        newSet.delete(placeId);
      }
      return newSet;
    });
  };

  return (
    <div className="w-full space-y-4 rounded-lg bg-secondary p-6">
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
                checked={selectedPlaceIds.has(place.id)}
                onCheck={(checked) => handleCheck(place.id, checked as boolean)}
              />
            ))}
          </div>
        </div>
      ))}
      <ActionButtons
        selectedPlaceIds={selectedPlaceIds}
        setSelectedPlaceIds={setSelectedPlaceIds}
        placeIds={args.trips?.map((trip: Trip) =>
          trip.places?.map((place: Place) => place.id),
        )}
        status={status}
        handler={handler}
        approve={
          <>
            <Plus className="mr-2 h-4 w-4" /> Add
          </>
        }
        reject={
          <>
            <X className="mr-2 h-4 w-4" /> Cancel
          </>
        }
      />
    </div>
  );
};
