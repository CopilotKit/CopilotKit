import { FC } from "react";
import { Skeleton } from "../ui/skeleton";

export const EmailSkeleton: FC = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-full" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-[90%]" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-[85%]" />
    </div>
  </div>
);

export const EmailListSkeleton: FC = () => (
  <div className="space-y-4">
    {Array.from({ length: 5 }).map((_, idx) => (
      <div
        key={idx}
        className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer"
      >
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2 flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" /> {/* Sender name */}
              <Skeleton className="h-3 w-24" /> {/* Time */}
            </div>
            <Skeleton className="h-3 w-3 rounded-full" />{" "}
            {/* Unread indicator */}
          </div>
          <Skeleton className="h-4 w-3/4" /> {/* Subject */}
          <Skeleton className="h-3 w-4/5" /> {/* Preview text */}
        </div>
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-4 w-4" /> {/* Star/flag */}
          <Skeleton className="h-3 w-8" /> {/* Attachment */}
        </div>
      </div>
    ))}
  </div>
);

export const ResearchPaperSkeleton: FC = () => (
  <div className="space-y-8 mt-14">
    {/* Title */}
    <div className="prose max-w-none">
      <Skeleton className="h-10 w-3/4" />
    </div>

    {/* Sections */}
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="prose max-w-none">
          <Skeleton className="h-8 w-1/3 mb-4" /> {/* Section title */}
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>

    {/* Sources */}
    <div className="prose max-w-none mt-8 pt-6 border-t">
      <Skeleton className="h-6 w-32 mb-4" /> {/* Sources title */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="space-y-2">
            <Skeleton className="h-4 w-2/3" /> {/* Source title */}
            <Skeleton className="h-4 w-full" /> {/* Source content */}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const XKCDSkeleton: FC = () => (
  <div className="space-y-4 flex flex-col items-center">
    <div className="relative w-[500px] h-[500px]">
      <Skeleton className="h-full w-full" />
      <div className="absolute top-4 right-4">
        <Skeleton className="h-8 w-32" /> {/* For the speed/function display */}
      </div>
    </div>
    <div className="flex gap-4">
      <Skeleton className="h-10 w-24" /> {/* Prev button */}
      <Skeleton className="h-10 w-24" /> {/* Next button */}
    </div>
  </div>
);

export const ChatSkeleton: FC = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-12 w-full" />
    <Skeleton className="h-12 w-full" />
  </div>
);

export const GenericSkeleton: FC = () => (
  <div className="w-full h-screen animate-pulse p-4 flex flex-col items-center justify-center">
    {/* Loading blocks */}
    <div className="w-full h-full flex items-center justify-center">
      <Skeleton className="h-48 w-48 bg-[url('/icon.png')] bg-center bg-no-repeat bg-contain opacity-20 rounded-lg shadow-lg animate-[fly-away_2s_ease-in-out_infinite]" />
    </div>
  </div>
);

export const MapSkeleton: FC = () => (
  <div className="w-full h-full relative">
    <div className="absolute inset-0">
      <div className="w-full h-full bg-[url('/map-overlay.png')] bg-cover bg-center bg-no-repeat" />
    </div>
  </div>
);
