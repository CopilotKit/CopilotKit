import { MCPServer } from "mcp-use";
import { mapSchema } from "./views/map-view/schema.js";

const server = new MCPServer({
  name: "fizzy-maps",
  title: "Fizzy Maps",
  version: "1.0.0",
  description: "Deliveries on an interactive map.",
  // Guidance for the model, sent to every client that connects.
  instructions:
    "Use show-map to draw markers. Each call replaces the whole map, so always pass the complete marker set.",
});

export const showMap = server.tool(
  {
    name: "show-map",
    description: "Show an interactive map with colored, titled markers.",
    inputSchema: mapSchema,
    outputSchema: mapSchema,
    view: {
      name: "map-view", // loads views/map-view/view.tsx
      description: "Interactive Leaflet map",
      prefersBorder: false,
      csp: {
        resourceDomains: ["https://tile.openstreetmap.org"],
        connectDomains: ["https://tile.openstreetmap.org"],
      },
    },
  },
  // The tool just hands the map back. The view does the drawing.
  async (map) => ({
    content: [{ type: "text", text: `Showing ${map.markers.length} markers.` }],
    structuredContent: map,
  }),
);

export default server;
