"use client";
import * as Skeletons from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { AvailableAgents } from "@/lib/available-agents";
import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { Icon, LatLngTuple } from "leaflet";
import "leaflet-defaulticon-compatibility";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import "leaflet/dist/leaflet.css";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Marker, Popup, TileLayer } from "react-leaflet";

const customIcon = new Icon({
  iconUrl: "/icon.png",
  iconSize: [40, 40],
  iconAnchor: [12, 25],
  popupAnchor: [0, -25],
});

interface Place {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  description: string;
}

const Map = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  {
    ssr: false,
  }
);

export default function MapComponent() {
  const [pointsFrom, setPointsFrom] = useState<Place[]>([]);
  const [center, setCenter] = useState<LatLngTuple>([0, 0]);
  const hasProcessedTrips = useRef(false);
  const hasInProgress = useRef(false);
  
  const researchAgentActive = useRef(false);
  const { running: researchAgentRunning } = useCoAgent({
    name: AvailableAgents.RESEARCH_AGENT,
  });

  if (researchAgentRunning !== researchAgentActive.current) {
    researchAgentActive.current = researchAgentRunning;
  }

  const { stop: stopTravelAgent } = useCoAgent({
    name: AvailableAgents.TRAVEL_AGENT,
  });

  useCopilotAction({
    name: "add_trips",
    description: "Add some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to add",
        required: true,
        attributes: [
          {
            name: "id",
            type: "string",
            description: "Unique identifier for the trip",
          },
          {
            name: "name",
            type: "string",
            description: "Name of the trip",
          },
          {
            name: "center_latitude",
            type: "number",
            description: "Center latitude coordinate for the trip map view",
          },
          {
            name: "center_longitude",
            type: "number",
            description: "Center longitude coordinate for the trip map view",
          },
          {
            name: "zoom",
            type: "number",
            description: "Zoom level for the trip map view",
          },
          {
            name: "places",
            type: "object[]",
            description: "List of places included in the trip",
            attributes: [
              {
                name: "id",
                type: "string",
                description: "Unique identifier for the place",
              },
              {
                name: "name",
                type: "string",
                description: "Name of the place",
              },
              {
                name: "address",
                type: "string",
                description: "Full address of the place",
              },
              {
                name: "latitude",
                type: "number",
                description: "Latitude coordinate of the place",
              },
              {
                name: "longitude",
                type: "number",
                description: "Longitude coordinate of the place",
              },
              {
                name: "rating",
                type: "number",
                description: "Rating of the place (0-5)",
              },
              {
                name: "description",
                type: "string",
                description: "Brief description of the place",
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse({ args, status, respond }) {
      if (["inProgress", "executing"].includes(status)) {
        hasInProgress.current = true;
      }

      if (status == "executing") {
        const trips = args.trips;
        if (!hasProcessedTrips.current) {
          setTimeout(() => {
            trips.forEach((trip) => {
              setPointsFrom((prev) => [...prev, ...trip.places]);
              setCenter([trip.center_latitude, trip.center_longitude]);
            });
          }, 0);
          hasProcessedTrips.current = true;
        }
      }

      if (status === "complete") {
        hasInProgress.current = false;
      }

      return (
        <div className="p-4 bg-gray-100 rounded-md">
          {(() => {
            const isLoading = status === "inProgress";
            const isExecuting = status === "executing";
            const pending = isLoading || isExecuting;
            const colorClass = pending ? "text-blue-600" : "text-emerald-600";
            const Icon = pending ? Loader2 : CheckCircle;
            const message = isLoading
              ? "Adding Trips..."
              : isExecuting
              ? "Please Confirm"
              : "Trips Added Successfully!";

            return (
              <div className="flex items-start py-2 px-3">
                <span className={colorClass}>
                  <Icon
                    className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
                  />
                </span>
                <span className="ml-3 font-semibold capitalize">{message}</span>
              </div>
            );
          })()}
          <div className="p-2">
            <div
              key={`trips-list-${args.trips?.length ?? 0}`}
              className="space-y-6"
            >
              {args.trips?.map((trip) => (
                <div key={trip.id} className="rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-medium text-gray-900">
                      {trip.name}
                    </h3>
                    <span className="text-sm text-gray-500">
                      {trip.places?.length || 0} places
                    </span>
                  </div>
                  <div className="flex flex-col gap-4">
                    {trip.places?.map((place) => (
                      <div
                        key={place.id}
                        className="bg-white p-4 rounded-md shadow-sm"
                      >
                        <h4 className="font-medium text-gray-800">
                          {place.name}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {place.address}
                        </p>
                        <div className="flex items-center mt-2">
                          <span className="text-yellow-500">
                            {"★".repeat(Math.round(place.rating))}
                          </span>
                          <span className="text-gray-400">
                            {"★".repeat(5 - Math.round(place.rating))}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-2">
                          {place.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {status === "executing" ? (
            <div className="w-full flex items-center justify-between px-8 py-4">
              <Button
                variant="default"
                className="flex-1 flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 text-white"
                onClick={() => {
                  respond?.("SEND");
                  setTimeout(() => {
                    stopTravelAgent();
                  }, 3000);
                }}
              >
                <CheckCircle className="h-5 w-5" />
                <span>Confirm</span>
              </Button>
              <Button
                variant="destructive"
                className="flex-1 mx-4 flex items-center justify-center space-x-2 px-4 py-2 hover:bg-red-600 focus:outline-none text-white bg-red-500"
                onClick={() => {
                  respond?.("CANCEL");
                }}
              >
                <XCircle className="h-5 w-5" />
                <span>Cancel</span>
              </Button>
            </div>
          ) : null}
          {status === "complete" ? (
            <div className="flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="ml-2">Trips added Successfully!</span>
            </div>
          ) : null}
        </div>
      );
    },
    followUp: false,
  });

  useCopilotAction({
    name: "search_for_places",
    parameters: [
      {
        name: "queries",
        type: "string[]",
        description: "The query to search for",
        required: true,
      },
    ],
    render({ args, status }) {
      /**
       * Dirty hack to mark the agent as in progress
       */
      if (!hasInProgress.current) {
        hasInProgress.current = true;
      }

      if (!args.queries) {
        return (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <span className="ml-3">Searching for Places...</span>
          </div>
        );
      }

      return (
        <div className="p-4 bg-gray-100 rounded-md">
          <h3 className="font-semibold mb-3">
            {status === "executing" || status === "inProgress"
              ? "Searching for places..."
              : "Searched for places"}
          </h3>
          <ul className="space-y-2 text-gray-700">
            {args.queries.map((q: string, i: number) => (
              <li key={i} className="flex items-center py-2 px-3 rounded-lg">
                {status === "executing" || status === "inProgress" ? (
                  <span className="text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                ) : (
                  <span className="text-emerald-600">
                    <CheckCircle className="h-4 w-4" />
                  </span>
                )}
                <span className="ml-3 font-medium capitalize">{q}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    },
  });

  // Show skeleton during initial load or research
  if (hasInProgress.current) {
    return <Skeletons.MapSkeleton />;
  }

  // Return null for initial state when no points are set
  if (!pointsFrom.length) {
    return null;
  }

  // Show map with points
  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <Map 
        center={center} 
        zoom={13} 
        style={{ height: "100%", width: "100%" }}
        className="leaflet-container"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className="leaflet-tile-container"
          maxZoom={19}
          minZoom={3}
          updateWhenZooming={false}
          updateWhenIdle={true}
          keepBuffer={2}
        />
        {pointsFrom.map((point) => (
          <Marker
            key={point.id}
            position={[point.latitude, point.longitude] as LatLngTuple}
            icon={customIcon}
          >
            <Popup>
              <h3 className="font-bold">{point.name}</h3>
              <p>{point.description}</p>
            </Popup>
          </Marker>
        ))}
      </Map>
      {researchAgentActive.current && (
        <div className="absolute inset-0 z-[100] pointer-events-none">
          <div className="w-full h-full bg-[url('/map-overlay.png')] bg-cover bg-center bg-no-repeat" />
        </div>
      )}
    </div>
  );
}
