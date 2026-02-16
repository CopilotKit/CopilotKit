import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Place } from "@/lib/types";
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

export function PlaceCard({
  place,
  actions,
  onMouseEnter,
  onMouseLeave,
  className,
  number,
  checked,
  onCheck,
  shouldShowCheckbox = true,
}: PlaceCardProps) {
  return (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow duration-200",
        className,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                {number && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-foreground text-sm font-bold text-background drop-shadow-md">
                    {number}
                  </div>
                )}
                {place.name}
              </CardTitle>
              <Stars rating={place.rating} />
            </div>
            <div className="flex min-w-[2rem] flex-col items-end gap-2">
              {actions}
              {shouldShowCheckbox && (
                <Checkbox checked={checked} onCheckedChange={onCheck} />
              )}
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>{place.address}</span>
            </div>
            {place.description && (
              <div className="flex items-center gap-2 pt-2">
                <Info className="h-4 w-4" />
                <p className="flex-1">{place.description}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
