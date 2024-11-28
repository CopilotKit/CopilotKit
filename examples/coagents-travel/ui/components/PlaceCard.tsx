import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Place  } from "@/lib/types";
import { Stars } from "@/components/Stars";
import { MapPin, Info } from "lucide-react";
import { ReactNode } from "react";

type PlaceCardProps = {
  place: Place;
  actions?: ReactNode;
  onMouseEnter?: () => void;
};

export function PlaceCard({ place, actions, onMouseEnter }: PlaceCardProps) {
  return (
    <Card 
      className="hover:shadow-md transition-shadow duration-200"
      onMouseEnter={onMouseEnter}
    >
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <CardTitle className="text-xl font-semibold">{place.name}</CardTitle>
              <Stars rating={place.rating} />
            </div>
            {actions}
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              <span>{place.address}</span>
            </div>
            {place.description && (
              <div className="flex items-center gap-2 pt-2">
                <Info className="w-4 h-4" />
                <p className="flex-1">{place.description}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 