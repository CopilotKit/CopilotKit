import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarsProps {
  rating: number;
  showNumber?: boolean;
  interactive?: boolean;
  onHover?: (rating: number) => void;
  onRate?: (rating: number) => void;
  className?: string;
}

export function Stars({ 
  rating, 
  showNumber = true, 
  interactive = false,
  onHover,
  onRate,
  className
}: StarsProps) {
  return (
    <div className={cn("flex items-center", className)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <div key={star} className="relative">
          {interactive ? (
            <button
              type="button"
              className="p-0 hover:scale-110 transition-transform"
              onMouseEnter={() => onHover?.(star)}
              onMouseLeave={() => onHover?.(0)}
              onClick={() => onRate?.(star)}
            >
              <Star
                className={cn(
                  "w-5 h-5",
                  rating >= star
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-gray-300"
                )}
              />
            </button>
          ) : (
            <div className="relative">
              <Star className="w-5 h-5 text-gray-300" aria-hidden="true" />
              <div 
                className="absolute inset-0 overflow-hidden" 
                style={{ 
                  width: `${Math.min(100, Math.max(0, (rating - (star - 1)) * 100))}%` 
                }}
              >
                <Star
                  className="w-5 h-5 text-yellow-400 fill-yellow-400"
                  aria-hidden="true"
                />
              </div>
            </div>
          )}
        </div>
      ))}
      {showNumber && rating && (
        <p className="text-sm text-muted-foreground ml-2">{rating.toFixed(1)}</p>
      )}
    </div>
  );
}