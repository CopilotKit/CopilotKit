import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useTrips } from "@/lib/hooks/use-trips";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerTrigger } from "./ui/drawer";
import { Button } from "./ui/button";
import { Plane } from "lucide-react";
import { CardTitle } from "./ui/card";
import { TripSelect } from "./TripSelect";
import { TripContent } from "./TripContent";
import { ScrollArea } from "./ui/scroll-area";
import { Map } from "leaflet";

export type MobileTripCardProps = {
  className?: string;
  map?: Map;
};

export function MobileTripCard({ className, map }: MobileTripCardProps) {
  const { selectedTrip } = useTrips();

  if (selectedTrip && map) {
    map.setView(
      [selectedTrip.center_latitude, selectedTrip.center_longitude],
      selectedTrip.zoom_level || 13,
    );
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          className={cn(
            className,
            "absolute bottom-20 right-4 w-14 h-14 rounded-full",
          )}
        >
          <Plane className="h-6 w-6" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="flex max-h-[75vh] flex-col border-none bg-foreground">
        <div className="flex flex-row items-center justify-between gap-2 p-4 text-white">
          <CardTitle className="max-w-full truncate text-wrap font-bold">
            {selectedTrip?.name || "Untitled Trip"}
          </CardTitle>
          <TripSelect />
        </div>
        <div className="h-full overflow-y-auto bg-background p-4">
          {selectedTrip && (
            <>
              <div className="h-2" />
              <TripContent map={map} trip={selectedTrip} />
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
