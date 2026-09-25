const COLORS = { Packing: "blue", Shipping: "green", Delayed: "red" } as const;

type Order = {
  id: string;
  name: string;
  status: keyof typeof COLORS;
  lat: number;
  lng: number;
};

export const orders: Order[] = [
  {
    id: "FIZZ-1042",
    name: "Mission Bodega",
    status: "Packing",
    lat: 37.7599,
    lng: -122.4148,
  },
  {
    id: "FIZZ-1043",
    name: "Corner Store Deluxe",
    status: "Shipping",
    lat: 37.7785,
    lng: -122.395,
  },
  {
    id: "FIZZ-1045",
    name: "Sunset Snacks",
    status: "Delayed",
    lat: 37.7534,
    lng: -122.494,
  },
  {
    id: "FIZZ-1046",
    name: "Marina Mini Mart",
    status: "Packing",
    lat: 37.8037,
    lng: -122.4368,
  },
];

// The complete show-map arguments, so the model never has to guess coordinates.
export const orderMap = {
  title: "Orders · San Francisco",
  center: { lat: 37.777, lng: -122.44 },
  zoom: 12,
  markers: orders.map((order) => ({
    lat: order.lat,
    lng: order.lng,
    title: `${order.id} · ${order.name}`,
    description: order.status,
    color: COLORS[order.status],
  })),
};
