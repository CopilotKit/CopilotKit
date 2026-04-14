/**
 * Hotel booking data layer for the UI Protocols Demo.
 * Contains mock hotel data, search, room selection, and booking logic.
 */

export type RoomType = "standard" | "deluxe" | "suite" | "penthouse" | "family";

export interface City {
  id: string;
  name: string;
  country: string;
  code: string;
}

export interface Amenity {
  id: string;
  name: string;
  icon: string;
}

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  maxGuests: number;
  bedType: string;
  pricePerNight: number;
  amenities: string[];
  available: number;
}

export interface Hotel {
  id: string;
  name: string;
  city: City;
  address: string;
  rating: number;
  reviewCount: number;
  priceRange: { min: number; max: number };
  amenities: Amenity[];
  rooms: Room[];
  imageUrl?: string;
}

export interface Guest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface HotelSearch {
  id: string;
  hotels: Hotel[];
  searchParams: {
    city: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    rooms: number;
  };
  selectedHotelId?: string;
  selectedRoomId?: string;
}

export interface HotelBooking {
  confirmationNumber: string;
  hotel: Hotel;
  room: Room;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: Guest[];
  totalPrice: number;
  bookedAt: string;
}

// Mock city database
const CITIES: City[] = [
  { id: "paris", name: "Paris", country: "France", code: "PAR" },
  { id: "nyc", name: "New York", country: "USA", code: "NYC" },
  { id: "tokyo", name: "Tokyo", country: "Japan", code: "TYO" },
  { id: "london", name: "London", country: "UK", code: "LON" },
  { id: "dubai", name: "Dubai", country: "UAE", code: "DXB" },
  { id: "singapore", name: "Singapore", country: "Singapore", code: "SIN" },
  { id: "sydney", name: "Sydney", country: "Australia", code: "SYD" },
  { id: "barcelona", name: "Barcelona", country: "Spain", code: "BCN" },
];

// Common amenities
const AMENITIES: Amenity[] = [
  { id: "wifi", name: "Free WiFi", icon: "wifi" },
  { id: "pool", name: "Swimming Pool", icon: "pool" },
  { id: "spa", name: "Spa & Wellness", icon: "spa" },
  { id: "gym", name: "Fitness Center", icon: "gym" },
  { id: "restaurant", name: "Restaurant", icon: "restaurant" },
  { id: "bar", name: "Bar", icon: "bar" },
  { id: "parking", name: "Parking", icon: "parking" },
  { id: "concierge", name: "24h Concierge", icon: "concierge" },
];

// Room templates
const ROOM_TYPES: Record<RoomType, { name: string; description: string; bedType: string; amenities: string[] }> = {
  standard: {
    name: "Standard Room",
    description: "Comfortable room with city views",
    bedType: "Queen Bed",
    amenities: ["wifi", "tv", "minibar"],
  },
  deluxe: {
    name: "Deluxe Room",
    description: "Spacious room with premium amenities",
    bedType: "King Bed",
    amenities: ["wifi", "tv", "minibar", "workspace"],
  },
  suite: {
    name: "Junior Suite",
    description: "Elegant suite with separate living area",
    bedType: "King Bed",
    amenities: ["wifi", "tv", "minibar", "workspace", "bathtub"],
  },
  penthouse: {
    name: "Penthouse Suite",
    description: "Luxurious top-floor suite with panoramic views",
    bedType: "King Bed",
    amenities: ["wifi", "tv", "minibar", "workspace", "bathtub", "balcony"],
  },
  family: {
    name: "Family Room",
    description: "Spacious room perfect for families",
    bedType: "2 Double Beds",
    amenities: ["wifi", "tv", "minibar"],
  },
};

// In-memory storage
export const hotelSearches: Map<string, HotelSearch> = new Map();
export const hotelBookings: Map<string, HotelBooking> = new Map();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function generateConfirmationNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "HTL";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Generate mock hotels for a city
function generateHotelsForCity(city: City): Hotel[] {
  const hotelNames = [`Grand ${city.name} Hotel`, `${city.name} Plaza`, `The ${city.name} Residences`];

  return hotelNames.map((name, index) => {
    const basePrice = 150 + Math.floor(Math.random() * 200);
    const rating = 4 + Math.random() * 1;

    const rooms: Room[] = (["standard", "deluxe", "suite", "penthouse", "family"] as RoomType[]).map(
      (type, roomIndex) => {
        const template = ROOM_TYPES[type];
        const multiplier =
          type === "penthouse" ? 4 : type === "suite" ? 2.5 : type === "deluxe" ? 1.5 : type === "family" ? 1.3 : 1;

        return {
          id: generateId("room"),
          type,
          name: template.name,
          description: template.description,
          maxGuests: type === "family" ? 4 : type === "penthouse" ? 4 : type === "suite" ? 3 : 2,
          bedType: template.bedType,
          pricePerNight: Math.round(basePrice * multiplier),
          amenities: template.amenities,
          available: 2 + Math.floor(Math.random() * 5),
        };
      },
    );

    return {
      id: generateId("hotel"),
      name,
      city,
      address: `${100 + index * 50} ${city.name} Boulevard`,
      rating: Math.round(rating * 10) / 10,
      reviewCount: 100 + Math.floor(Math.random() * 500),
      priceRange: {
        min: Math.min(...rooms.map((r) => r.pricePerNight)),
        max: Math.max(...rooms.map((r) => r.pricePerNight)),
      },
      amenities: AMENITIES.slice(0, 4 + Math.floor(Math.random() * 4)),
      rooms,
    };
  });
}

export function getCities(): City[] {
  return CITIES.map((c) => ({ ...c }));
}

export function searchHotels(params: {
  city: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms?: number;
}): HotelSearch {
  const { city, checkIn, checkOut, guests, rooms = 1 } = params;

  const matchedCity = CITIES.find(
    (c) => c.name.toLowerCase().includes(city.toLowerCase()) || c.code.toLowerCase() === city.toLowerCase(),
  );

  if (!matchedCity) {
    throw new Error(`City not found: ${city}`);
  }

  const searchId = generateId("search");
  const hotels = generateHotelsForCity(matchedCity);

  const search: HotelSearch = {
    id: searchId,
    hotels,
    searchParams: { city: matchedCity.name, checkIn, checkOut, guests, rooms },
  };

  hotelSearches.set(searchId, search);
  return search;
}

export function getHotelSearch(searchId: string): HotelSearch | undefined {
  return hotelSearches.get(searchId);
}

export function selectHotel(searchId: string, hotelId: string): { hotel: Hotel; rooms: Room[] } | undefined {
  const search = hotelSearches.get(searchId);
  if (!search) return undefined;

  const hotel = search.hotels.find((h) => h.id === hotelId);
  if (!hotel) return undefined;

  search.selectedHotelId = hotelId;

  return { hotel, rooms: hotel.rooms };
}

export function selectRoom(
  searchId: string,
  roomId: string,
):
  | {
      room: Room;
      priceBreakdown: { perNight: number; nights: number; total: number };
    }
  | undefined {
  const search = hotelSearches.get(searchId);
  if (!search || !search.selectedHotelId) return undefined;

  const hotel = search.hotels.find((h) => h.id === search.selectedHotelId);
  if (!hotel) return undefined;

  const room = hotel.rooms.find((r) => r.id === roomId);
  if (!room) return undefined;

  search.selectedRoomId = roomId;

  // Calculate nights
  const checkIn = new Date(search.searchParams.checkIn);
  const checkOut = new Date(search.searchParams.checkOut);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

  return {
    room,
    priceBreakdown: {
      perNight: room.pricePerNight,
      nights,
      total: room.pricePerNight * nights * search.searchParams.rooms,
    },
  };
}

export function createHotelBooking(
  searchId: string,
  guests: Guest[],
): { success: boolean; message: string; booking?: HotelBooking } {
  const search = hotelSearches.get(searchId);
  if (!search) return { success: false, message: "Search session not found" };
  if (!search.selectedHotelId) return { success: false, message: "No hotel selected" };
  if (!search.selectedRoomId) return { success: false, message: "No room selected" };

  const hotel = search.hotels.find((h) => h.id === search.selectedHotelId);
  if (!hotel) return { success: false, message: "Hotel not found" };

  const room = hotel.rooms.find((r) => r.id === search.selectedRoomId);
  if (!room) return { success: false, message: "Room not found" };

  const checkIn = new Date(search.searchParams.checkIn);
  const checkOut = new Date(search.searchParams.checkOut);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  const totalPrice = room.pricePerNight * nights * search.searchParams.rooms;

  const confirmationNumber = generateConfirmationNumber();

  const booking: HotelBooking = {
    confirmationNumber,
    hotel,
    room,
    checkIn: search.searchParams.checkIn,
    checkOut: search.searchParams.checkOut,
    nights,
    guests,
    totalPrice,
    bookedAt: new Date().toISOString(),
  };

  hotelBookings.set(confirmationNumber, booking);
  hotelSearches.delete(searchId);

  return {
    success: true,
    message: `Hotel booking confirmed! Your confirmation number is ${confirmationNumber}`,
    booking,
  };
}

export function getHotelBooking(confirmationNumber: string): HotelBooking | undefined {
  return hotelBookings.get(confirmationNumber);
}
