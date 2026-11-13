import type { Sample } from "./types";
import type { ComponentName } from "../definitions";

export const mapsSamples: Partial<Record<ComponentName, Sample>> = {
  MapView: {
    wide: true,
    components: [
      {
        id: "root",
        component: "MapView",
        title: "Weekend in Lisbon",
        height: 340,
        markers: [
          {
            name: "Belém Tower",
            lat: 38.6916,
            lon: -9.216,
            description: "16th century fortified tower",
          },
          { name: "Jerónimos Monastery", lat: 38.6979, lon: -9.2068 },
          { name: "LX Factory", lat: 38.7036, lon: -9.1786 },
          { name: "Time Out Market", lat: 38.7069, lon: -9.1459 },
          { name: "São Jorge Castle", lat: 38.7139, lon: -9.1335 },
          { name: "Miradouro da Graça", lat: 38.7163, lon: -9.1311 },
        ],
      },
    ],
  },
  RouteMap: {
    components: [
      {
        id: "root",
        component: "RouteMap",
        title: "Cycling route",
        from: "Golden Gate Park",
        to: "Ferry Building",
        distance: "8.4 km",
        duration: "32 min",
        height: 300,
        coordinates: [
          [-122.4862, 37.7694],
          [-122.4655, 37.7712],
          [-122.4536, 37.7727],
          [-122.4473, 37.7726],
          [-122.4378, 37.7733],
          [-122.4313, 37.7734],
          [-122.4248, 37.7745],
          [-122.4192, 37.7752],
          [-122.4135, 37.7799],
          [-122.4078, 37.7843],
          [-122.4019, 37.7891],
          [-122.3966, 37.7935],
          [-122.3936, 37.7955],
        ],
      },
    ],
  },
  LocationCard: {
    components: [
      {
        id: "root",
        component: "LocationCard",
        name: "Blue Bottle Coffee",
        address: "66 Mint St, San Francisco, CA 94103",
        lat: 37.7825,
        lon: -122.4073,
        category: "Coffee shop",
        rating: 4.6,
        hours: "Open until 6 PM",
      },
    ],
  },
  PlaceList: {
    wide: true,
    components: [
      {
        id: "root",
        component: "PlaceList",
        title: "Ramen near Shibuya",
        source: "Sample data",
        places: [
          {
            name: "Ichiran Shibuya",
            lat: 35.6614,
            lon: 139.7005,
            address: "1-22-7 Jinnan, Shibuya",
            category: "Tonkotsu",
            rating: 4.5,
            distanceKm: 0.4,
          },
          {
            name: "Afuri Ebisu",
            lat: 35.6467,
            lon: 139.7087,
            address: "1-1-7 Ebisu, Shibuya",
            category: "Yuzu shio",
            rating: 4.4,
            distanceKm: 1.6,
          },
          {
            name: "Nagi Shinjuku Golden Gai",
            lat: 35.6941,
            lon: 139.7046,
            address: "1-1-10 Kabukicho, Shinjuku",
            category: "Niboshi",
            rating: 4.3,
            distanceKm: 3.7,
          },
          {
            name: "Kikanbo Kanda",
            lat: 35.6936,
            lon: 139.7712,
            address: "2-10-9 Kajicho, Chiyoda",
            category: "Spicy miso",
            rating: 4.4,
            distanceKm: 8.1,
          },
          {
            name: "Tsuta Yoyogi-Uehara",
            lat: 35.6687,
            lon: 139.6797,
            address: "3-2-4 Nishihara, Shibuya",
            category: "Shoyu",
            rating: 4.2,
            distanceKm: 2.4,
          },
        ],
      },
    ],
  },
};
