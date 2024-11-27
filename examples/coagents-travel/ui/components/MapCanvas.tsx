import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import { useTrips } from "@/lib/hooks/use-trips";
import { useState } from "react";
import { Map } from "leaflet";
import { cn } from "@/lib/utils";
import { TripCard } from "./TripCard";
import { Card } from "./ui/card";

export type MapCanvasProps = {
  className?: string;
}

export function MapCanvas({ className }: MapCanvasProps) {
	const [map, setMap] = useState<Map | null>(null);
	const { selectedTrip } = useTrips();

  return (
		<div className="">
			<MapContainer
				className={cn("w-screen h-screen", className)}
				style={{ zIndex: 0 }}
				center={[0, 0]}
				zoom={1}
				zoomAnimationThreshold={100}
				zoomControl={false}
				ref={setMap}
			>
				<TileLayer
					url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
					attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				/>
      {selectedTrip && selectedTrip.places.map((place, i) => (
        <Marker key={i} position={[place.latitude, place.longitude]}>
          <Tooltip>{place.name}</Tooltip>
        </Marker>
      ))}
      </MapContainer>
      {map &&
        <div className="absolute h-screen top-0 p-10 pointer-events-none flex items-start w-[30%] md:w-[50%] lg:w-[40%] 2xl:w-[35%]">
          <TripCard
            className="w-full h-full pointer-events-auto" 
            map={map} 
          />
        </div>
      }
		</div>
  );
}
