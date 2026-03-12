"use client";
import dynamic from "next/dynamic";
import * as Skeletons from "@/components/skeletons";
const MapComponent = dynamic(() => import("./map-container"), {
  ssr: false,
  loading: () => <Skeletons.GenericSkeleton />,
});

export default function Map() {
  return <MapComponent />;
}
