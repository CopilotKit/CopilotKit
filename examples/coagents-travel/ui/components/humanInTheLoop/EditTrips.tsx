import { Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Save } from "lucide-react";
import { ActionButtons } from "./ActionButtons";
import { RenderFunctionStatus } from "@copilotkit/react-core";

export type EditTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
};

export const EditTrips = ({ args, status, handler}: EditTripsProps) => {
  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
      {args.trips?.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <h1 className="text-sm">Do you want to save these changes?</h1>
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
        handler={handler} 
        approve={<><Save className="w-4 h-4 mr-2" /> Save</>} 
        reject={<><X className="w-4 h-4 mr-2" /> Cancel</>} 
      />
    </div>
  );
}