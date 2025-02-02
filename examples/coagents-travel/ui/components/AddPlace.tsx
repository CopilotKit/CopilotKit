import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTrips } from "@/lib/hooks/use-trips";
import { Plus, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Map, Marker } from "leaflet";
import { PlaceForm } from "./PlaceForm";
import { Place } from "@/lib/types";

export function AddPlace({ map }: { map: Map }) {
  const { selectedTrip, addPlace } = useTrips();
  const [open, setOpen] = useState(false);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);

  if (!selectedTrip) return null;

  const handleStartPlacing = () => {
    setIsPlacing(true);
    map.getContainer().style.cursor = 'crosshair';
    
    const clickHandler = (e: any) => {
      const latlng = e.latlng;
      if (marker) {
        marker.remove();
      }
      const newMarker = new Marker(latlng).addTo(map);
      setMarker(newMarker);
      setPosition([latlng.lat, latlng.lng]);
      map.getContainer().style.cursor = '';
      map.off('click', clickHandler);
      setIsPlacing(false);
      setOpen(true);
    };
    
    map.on('click', clickHandler);
  };

  const handleStopPlacing = () => {
    setIsPlacing(false);
    map.getContainer().style.cursor = '';
  };

  const handleAddPlace = (place: Place) => {
    if (!position) return;
    
    const [latitude, longitude] = position;
    const newPlace = { 
      ...place,
      latitude,
      longitude,
    };

    addPlace(selectedTrip.id, newPlace);

    setOpen(false);
    setPosition(null);
    if (marker) {
      marker.remove();
      setMarker(null);
    }
  };

  return (
    <>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button 
            size="icon" 
            className={`bg-white text-black hover:bg-white/80 ring-2 ring-border shadow-xl border-black rounded-full ${isPlacing ? 'ring-2 ring-primary' : ''}`}
            onClick={isPlacing ? handleStopPlacing : handleStartPlacing}
          >
            {isPlacing ? <MapPin className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isPlacing ? 'Click on map to place marker' : 'Add a place'}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Plus className="w-4 h-4 mr-2" />
              Add a New Place
            </DialogTitle>
          </DialogHeader>
          <PlaceForm 
            onSubmit={handleAddPlace} 
          />
        </DialogContent>
      </Dialog>
    </>
  );
}