import { useToolContext } from "mcp-use/react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Marker } from "./schema.js";
import "./view.css";

// The colors the model can pick from in markerSchema, as hex values.
const COLORS: Record<NonNullable<Marker["color"]>, string> = {
  red: "#e74c3c",
  blue: "#3498db",
  green: "#2ecc71",
  orange: "#f39c12",
  purple: "#9b59b6",
};

export default function MapView() {
  // The show-map result arrives here, typed from the tool's outputSchema.
  const view = useToolContext<"show-map">();

  // The view can load before the tool finishes, so handle those states first.
  if (view.status === "pending") {
    return <p className="map-status">Loading map…</p>;
  }
  if (view.status === "error") {
    return <p className="map-status">{view.error.message}</p>;
  }

  const { title, center, zoom, markers } = view.toolOutput;

  return (
    <div className="map-view">
      {title && <div className="map-title">{title}</div>}
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        zoomControl={false}
      >
        {/* The map images, from OpenStreetMap. The tool's csp allows this host. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {/* One colored dot per marker, with its title on hover. */}
        {markers.map((marker) => (
          <CircleMarker
            key={`${marker.lat},${marker.lng}`}
            center={[marker.lat, marker.lng]}
            radius={10}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: COLORS[marker.color ?? "blue"],
              fillOpacity: 0.85,
            }}
          >
            <Tooltip>
              {marker.title}
              {marker.description && ` · ${marker.description}`}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
