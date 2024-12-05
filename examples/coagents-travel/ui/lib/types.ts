export type Place = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  description?: string;
};
  
export type Trip = {
  id: string;
  name: string;
  center_latitude: number;
  center_longitude: number;
  zoom_level?: number | 13; 
  places: Place[];
};

export type SearchProgress = {
  query: string;
  done: boolean;
};

export type AgentState = {
  trips: Trip[];
  selected_trip_id: string | null;
  search_progress?: SearchProgress[];
};

export const defaultTrips: Trip[] = [
  {
    id: "1",
    name: "Business Trip to NYC",
    center_latitude: 40.7484,
    center_longitude: -73.9857,
    places: [
      {
        id: "1",
        name: "Empire State Building",
        address: "20 W 34th St, New York, NY 10001",
        description: "A famous building in New York City",
        latitude: 40.7484,
        longitude: -73.9857,
        rating: 4.8,
      },
      {
        id: "2",
        name: "Central Park",
        address: "New York, NY 10024",
        description: "A famous park in New York City",
        latitude: 40.785091,
        longitude: -73.968285,
        rating: 4.7,
      },
      {
        id: "3",
        name: "Times Square",
        address: "Times Square, New York, NY 10036",
        description: "A famous square in New York City",
        latitude: 40.755499,
        longitude: -73.985701,
        rating: 4.6,
      },
    ],
    zoom_level: 14,
  },
  {
    id: "2",
    name: "Vacation in Paris",
    center_latitude: 48.8566,
    center_longitude: 2.3522,
    places: [
      {
        id: "1",
        name: "Eiffel Tower",
        address: "Champ de Mars",
        description: "A famous tower in Paris",
        latitude: 48.8584,
        longitude: 2.2945,
        rating: 4.8,
      },
      {
        id: "2",
        name: "Louvre Museum",
        address: "Rue de Rivoli",
        description: "A famous museum in Paris",
        latitude: 48.8606,
        longitude: 2.3376,
        rating: 4.9,
      },
      {
        id: "3",
        name: "Notre-Dame Cathedral",
        address: "Place Jean-Paul-II",
        description: "A famous cathedral in Paris",
        latitude: 48.8566,
        longitude: 2.3522,
        rating: 4.7,
      },
    ],
    zoom_level: 12,
  },
];