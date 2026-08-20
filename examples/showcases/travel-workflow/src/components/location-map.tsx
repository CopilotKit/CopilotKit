"use client";

import { useEffect, useRef } from "react";
import { divIcon, latLngBounds } from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";

import type { Attraction } from "@/lib/travel";

function MapView({
  center,
  attractions,
}: {
  center: [number, number];
  attractions: Attraction[];
}) {
  const map = useMap();
  const viewKey = [
    ...center,
    ...attractions.flatMap(({ latitude, longitude }) => [latitude, longitude]),
  ].join(":");
  const previousViewKey = useRef<string | null>(null);

  useEffect(() => {
    if (viewKey === previousViewKey.current) return;
    previousViewKey.current = viewKey;

    if (attractions.length === 0) {
      map.flyTo(center, 12, { duration: 0.8 });
    } else if (attractions.length === 1) {
      map.flyTo([attractions[0].latitude, attractions[0].longitude], 13, {
        duration: 0.8,
      });
    } else {
      map.flyToBounds(
        latLngBounds(
          attractions.map(({ latitude, longitude }) => [latitude, longitude]),
        ),
        { padding: [48, 48], maxZoom: 13, duration: 0.8 },
      );
    }
  }, [attractions, center, map, viewKey]);

  return null;
}

const markerIcons = new Map<number, ReturnType<typeof divIcon>>();

function markerIcon(index: number) {
  const cachedIcon = markerIcons.get(index);
  if (cachedIcon) return cachedIcon;

  const icon = divIcon({
    className: "location-pin",
    html: `<span><b>${index + 1}</b></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -38],
    tooltipAnchor: [0, -32],
  });

  markerIcons.set(index, icon);
  return icon;
}

export default function LocationMap({
  center,
  attractions,
}: {
  center: [number, number];
  attractions: Attraction[];
}) {
  return (
    <MapContainer
      center={center}
      zoom={12}
      zoomControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="bottomleft" />
      <MapView center={center} attractions={attractions} />

      {attractions.map((attraction, index) => (
        <Marker
          key={attraction.id}
          position={[attraction.latitude, attraction.longitude]}
          icon={markerIcon(index)}
        >
          <Tooltip direction="top" opacity={1}>
            {attraction.name}
          </Tooltip>
          <Popup>
            <div className="location-popup">
              <strong>{attraction.name}</strong>
              <p>{attraction.description}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
