import type { Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Trash } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import type { ToolCallStatus } from "@copilotkit/react-core/v2";

export type DeleteTripsProps = {
  args: Partial<{ trip_ids: string[] }>;
  status: ToolCallStatus;
  respond?: (result: unknown) => Promise<void>;
  trips: Trip[];
};

export const DeleteTrips = ({
  args,
  status,
  respond,
  trips,
}: DeleteTripsProps) => {
  const tripsToDelete = trips.filter((trip: Trip) =>
    args?.trip_ids?.includes(trip.id),
  );

  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
      <h1 className="text-sm">The following trips will be deleted:</h1>
      {tripsToDelete.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <hr className="my-2" />
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{trip.name}</h2>
            {trip.places?.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
          </div>
        </div>
      ))}
      <ActionButtons
        status={status}
        respond={respond}
        approve={
          <>
            <Trash className="w-4 h-4 mr-2" /> Delete
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
