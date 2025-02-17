import { useTrips } from "@/lib/hooks/use-trips";
import { Map } from "leaflet";
import { Button } from "./ui/button";
import { Trash, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditPlace } from "./EditPlace";
import { useState } from "react";
import { PlaceCard } from "./PlaceCard";
import { Place } from "@/lib/types";

export type PlaceProps = {
  place: Place;
  number: number;
  map?: Map;
}

export function PlaceForMap({ place, number, map }: PlaceProps) {
  const { selectedTrip, deletePlace } = useTrips();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!selectedTrip) return null;

  const handleDelete = () => {
    deletePlace(selectedTrip.id, place.id);
  };

  const actions = (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditPlace 
          place={place} 
          onOpenChange={setDropdownOpen} 
        />
        <DropdownMenuItem 
          onClick={handleDelete}
          className="text-destructive"
        >
          <Trash className="w-4 h-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PlaceCard 
      place={place}
      number={number}
      actions={actions}
      onMouseEnter={() => {
        if (map) {
          map.panTo([place.latitude, place.longitude]);
        }
      }}
    />
  );
}
