import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Place  } from "@/lib/types";
import { Stars } from "@/components/Stars";
import { MapPin, Info } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

type PlaceCardProps = {
  place: Place;
  className?: string;
  number?: number;
  actions?: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  checked?: boolean;
  onCheck?: (checked: boolean) => void;
  shouldShowCheckbox?: boolean;
};

export function PlaceCard({ place, actions, onMouseEnter, onMouseLeave, className, number, checked, onCheck, shouldShowCheckbox = true }: PlaceCardProps) {
  return (
    <Card 
      className={cn("hover:shadow-md transition-shadow duration-200", className)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                {number && (
                  <div className="text-sm text-background drop-shadow-md bg-foreground rounded-full flex items-center justify-center font-bold border-2 border-white w-7 h-7">
                    {number}
                  </div>
                )}
                {place.name}
              </CardTitle>
              <Stars rating={place.rating} />
            </div>
            <div className="flex flex-col items-end gap-2 min-w-[2rem]">
              {actions}
              {shouldShowCheckbox && <Checkbox checked={checked} onCheckedChange={onCheck} />}
            </div>
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