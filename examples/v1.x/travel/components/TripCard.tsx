"use client";

import { useTrips } from "@/lib/hooks/use-trips";
import { Map } from "leaflet";
import { TripSelect } from "@/components/TripSelect";
import { TripContent } from "@/components/TripContent";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { useState } from "react";
import { Button } from "./ui/button";
import { ChevronDown, ChevronUp, Plane } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { Drawer, DrawerContent, DrawerTrigger } from "./ui/drawer";

export type TripCardProps = {
  className?: string;
  map: Map;
}

export function TripCard({ className, map }: TripCardProps) {
  const { selectedTrip } = useTrips();
  const [minimized, setMinimized] = useState(false);

  if (selectedTrip) {
    map.setView([selectedTrip.center_latitude, selectedTrip.center_longitude], selectedTrip.zoom_level || 13);
  }

  return (
    <Card className={cn("z-50 bg-white/40 backdrop-blur-md border-none shadow-2xl flex flex-col h-[calc(100vh-8rem)]", 
      className,
      minimized ? "h-fit" : "h-[calc(100vh-8rem)]"
    )}>
        <CardHeader className={cn("flex flex-row justify-between items-center bg-black text-white rounded-t-lg flex-shrink-0",
          minimized ? "rounded-b-lg" : ""
        )}>
          <div className="flex flex-row items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMinimized(!minimized)}>
              {minimized ? <ChevronDown /> : <ChevronUp />}
            </Button>
            <CardTitle className="text-wrap truncate max-w-full font-bold">{selectedTrip?.name || "Untitled Trip"}</CardTitle>
          </div>
          <TripSelect />
        </CardHeader>

        {!minimized && (
          <ScrollArea className="flex-1">
            <CardContent className="pt-4">
              {selectedTrip && <TripContent map={map} trip={selectedTrip} />}
            </CardContent>
          </ScrollArea>
        )}
    </Card>
  );
} 