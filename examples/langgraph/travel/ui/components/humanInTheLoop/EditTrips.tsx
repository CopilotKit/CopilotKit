import { Place, Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Save } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import { RenderFunctionStatus } from "@copilotkit/react-core";
import {  useState } from "react";

export type EditTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
  trips: Trip[];
  selectedTripId: string;
};

export const EditTrips = ({ args, status, handler, trips, selectedTripId }: EditTripsProps) => {
  // const { trips, selectedTripId } = useTrips();
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const handleCheck = (placeId: string, checked: boolean) => {
    setSelectedPlaceIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(placeId);
      } else {
        newSet.delete(placeId);
      }
      return newSet;
    });
  };

  function getDelta(arr1: Place[], arr2: Place[]) {
    const arr2Ids = new Set(arr2.map(item => item.id));
    const arr1Ids = new Set(arr1.map(item => item.id));
    const onlyInArr1 = arr1.filter(item => !arr2Ids.has(item.id));
    const onlyInArr2 = arr2.filter(item => !arr1Ids.has(item.id));
    return [...onlyInArr1, ...onlyInArr2]
  }
  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
      {Array.isArray(args.trips) && args.trips.length > 0 && args.trips.map((trip: Trip) => (
        trip.id && trip.places&& Array.isArray(trip.places) && (
          <div key={trip.id} className="flex flex-col gap-4">
            <h1 className="text-sm">Do you want to save these changes?</h1>
            <hr className="my-2" />
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold">{trip.name}</h2>
              {getDelta(trip.places, trips.find((t) => t.id === selectedTripId)?.places || []).map((place) => (
                <PlaceCard key={place.id} place={place}
                  onCheck={(checked) => handleCheck(place.id, checked as boolean)}
                />
              ))}
            </div>
          </div>
        )
      ))}
      <ActionButtons
        status={status}
        handler={handler}
        placeIds={args.trips?.map((trip: Trip) => trip.places?.map((place: Place) => place.id))}
        selectedPlaceIds={selectedPlaceIds}
        approve={<><Save className="w-4 h-4 mr-2" /> Save</>}
        reject={<><X className="w-4 h-4 mr-2" /> Cancel</>}
        type="edit"
        setSelectedPlaceIds={setSelectedPlaceIds}
      />
    </div>
  );
}