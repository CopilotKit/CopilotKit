import { Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Trash } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import { RenderFunctionStatus } from "@copilotkit/react-core";

export type DeleteTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
  trips: Trip[];
};

export const DeleteTrips = ({ args, status, handler, trips }: DeleteTripsProps) => {
  const tripsToDelete = trips.filter((trip: Trip) => args?.trip_ids?.includes(trip.id));

  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
    <h1 className="text-sm">The following trips will be deleted:</h1>
      {status !== "complete" && tripsToDelete?.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <>
            <hr className="my-2" />
            <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{trip.name}</h2>
            {trip.places?.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
            </div>
          </>
        </div>
      ))}
      { status !== "complete" && (
        <ActionButtons
          status={status} 
          handler={handler} 
          approve={<><Trash className="w-4 h-4 mr-2" /> Delete</>} 
          reject={<><X className="w-4 h-4 mr-2" /> Cancel</>} 
        />
      )}
    </div>
  );
};