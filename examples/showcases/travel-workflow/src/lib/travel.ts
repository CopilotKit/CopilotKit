export type Attraction = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
};

export type TravelState = {
  status: string;
  search_area: string;
  center: [number, number];
  attractions: Attraction[];
};
