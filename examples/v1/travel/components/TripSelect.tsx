"use client";

import { useTrips } from "@/lib/hooks/use-trips";
import { Button } from "./ui/button";
import { Plane } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function TripSelect() {
  const { trips, selectedTripId, setSelectedTripId } = useTrips();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" className="bg-white text-black hover:bg-white/80">
          <Plane className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {trips?.map((trip) => (
          <DropdownMenuItem
            className={cn(
              "flex items-center",
              selectedTripId === trip.id
                ? "font-bold text-gray-900"
                : "text-muted-foreground",
            )}
            key={trip.id}
            onClick={() => setSelectedTripId(trip.id)}
          >
            <Plane className="mr-2 h-4 w-4" />
            {trip.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
