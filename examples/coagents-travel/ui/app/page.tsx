"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TripsProvider } from "@/lib/hooks/use-trips";
import dynamic from "next/dynamic";

// Disable server-side rendering for the MapCanvas component, this
// is because Leaflet is not compatible with server-side rendering
//
// https://github.com/PaulLeCam/react-leaflet/issues/45
let MapCanvas: any;
MapCanvas = dynamic(() => import('@/components/MapCanvas').then((module: any) => module.MapCanvas), {
  ssr: false,
});

export default function Home() {
  return (
    <TooltipProvider>
      <TripsProvider>
        <main className="h-screen w-screen">
          <MapCanvas />
        </main>
      </TripsProvider>
    </TooltipProvider>
  );
}
