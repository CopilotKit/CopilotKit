import { Trip } from "@/lib/types";
import { Map } from "leaflet";
import { PlaceForMap } from "@/components/PlaceForMap";
import { AddPlace } from "./AddPlace";

export type TripContentProps = {
  map?: Map;
  trip: Trip;
}

export function TripContent({ map, trip }: TripContentProps) {
  if (!trip) return null;

  return (
    <div className="flex flex-col gap-3">
      {map && (
        <div className="flex justify-center">
          <AddPlace map={map} />
        </div>
      )}
      {trip.places && trip.places.map((place, i) => (
        <PlaceForMap key={i} place={place} map={map} number={i + 1} />
      ))}
    </div>
  );
}
