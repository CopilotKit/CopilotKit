import { z } from "zod";
import { def } from "./shared";

const point = z.object({ id: z.string().optional(), name: z.string(), lat: z.number(), lon: z.number(), description: z.string().optional(), category: z.string().optional() });

export const mapDefinitions = {
  MapView: def("Maps", "Interactive dark map (MapLibre) with numbered markers; fits all markers. markers [{name,lat,lon,description?}].", z.object({ title: z.string().optional(), markers: z.array(point), height: z.number().optional(), zoom: z.number().optional() })),
  RouteMap: def("Maps", "Map with a route line through coordinates [[lon,lat],...] plus start/end pins and distance/duration.", z.object({ title: z.string().optional(), from: z.string(), to: z.string(), coordinates: z.array(z.array(z.number())), distance: z.string().optional(), duration: z.string().optional(), height: z.number().optional() })),
  LocationCard: def("Maps", "Single place (venue, hotel, office): mini map, name, address, category, rating, actions. Use instead of MapView for one place.", z.object({ name: z.string(), address: z.string().optional(), lat: z.number(), lon: z.number(), category: z.string().optional(), rating: z.number().optional(), hours: z.string().optional() })),
  PlaceList: def("Maps", "Split view: ranked list of places linked to a map; hovering/clicking a row highlights its marker. selected (row index) starts with that row highlighted.", z.object({ title: z.string().optional(), places: z.array(point.extend({ address: z.string().optional(), distanceKm: z.number().optional(), rating: z.number().optional() })), source: z.string().optional(), selected: z.number().optional(), height: z.number().optional(), basemap: z.enum(["dark", "streets", "liberty"]).optional() })),
};
