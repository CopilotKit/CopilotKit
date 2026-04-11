/**
 * Flight booking data layer for the UI Protocols Demo.
 * Contains mock airport/airline data, flight search, seat selection, and booking logic.
 */

// Type definitions
export type CabinClass = "economy" | "business" | "first";
export type SeatStatus = "available" | "occupied" | "selected" | "exit";

export interface Airport {
  code: string;
  city: string;
  name: string;
  country: string;
}

export interface Airline {
  code: string;
  name: string;
  color: string;
}

export interface Seat {
  id: string;
  row: number;
  position: string;
  status: SeatStatus;
  isWindow: boolean;
  isAisle: boolean;
  isExitRow: boolean;
  price: number;
}

export interface Flight {
  id: string;
  airline: Airline;
  flightNumber: string;
  origin: Airport;
  destination: Airport;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  aircraft: string;
  price: number;
  cabinClass: CabinClass;
  seatsAvailable: number;
}

export interface FlightSearch {
  id: string;
  flights: Flight[];
  searchParams: {
    origin: string;
    destination: string;
    date: string;
    passengers: number;
    cabinClass: CabinClass;
  };
  selectedFlightId?: string;
  selectedSeats?: string[];
}

export interface Passenger {
  name: string;
  email: string;
  phone: string;
}

export interface Booking {
  confirmationNumber: string;
  flight: Flight;
  passengers: Passenger[];
  seats: string[];
  totalPrice: number;
  bookedAt: string;
}

// Mock airport database
const AIRPORTS: Airport[] = [
  {
    code: "JFK",
    city: "New York",
    name: "John F. Kennedy International",
    country: "US",
  },
  {
    code: "LAX",
    city: "Los Angeles",
    name: "Los Angeles International",
    country: "US",
  },
  { code: "LHR", city: "London", name: "Heathrow", country: "UK" },
  { code: "CDG", city: "Paris", name: "Charles de Gaulle", country: "FR" },
  { code: "NRT", city: "Tokyo", name: "Narita International", country: "JP" },
  { code: "DXB", city: "Dubai", name: "Dubai International", country: "AE" },
  { code: "SIN", city: "Singapore", name: "Changi", country: "SG" },
  {
    code: "SFO",
    city: "San Francisco",
    name: "San Francisco International",
    country: "US",
  },
];

// Mock airline database
const AIRLINES: Airline[] = [
  { code: "AA", name: "American Airlines", color: "#0078D2" },
  { code: "UA", name: "United Airlines", color: "#002244" },
  { code: "DL", name: "Delta Air Lines", color: "#003366" },
  { code: "BA", name: "British Airways", color: "#075AAA" },
  { code: "EK", name: "Emirates", color: "#D71921" },
];

const AIRCRAFT_TYPES = [
  "Boeing 737-800",
  "Boeing 777-300ER",
  "Boeing 787-9",
  "Airbus A320neo",
  "Airbus A350-900",
];

// In-memory storage
export const flightSearches: Map<string, FlightSearch> = new Map();
export const bookings: Map<string, Booking> = new Map();

export function getAirports(): Airport[] {
  return AIRPORTS.map((a) => ({ ...a }));
}

export function getAirportByCode(code: string): Airport | undefined {
  return AIRPORTS.find((a) => a.code.toUpperCase() === code.toUpperCase());
}

function generateSearchId(): string {
  return `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateFlightId(): string {
  return `flight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateConfirmationNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function calculateDuration(
  origin: string,
  destination: string,
): { duration: string; hours: number } {
  const distances: Record<string, Record<string, number>> = {
    JFK: { LAX: 5.5, LHR: 7, CDG: 7.5, NRT: 14, DXB: 12, SIN: 18, SFO: 6 },
    LAX: { JFK: 5.5, LHR: 10, CDG: 11, NRT: 11, DXB: 16, SIN: 17, SFO: 1.5 },
    LHR: { JFK: 7, LAX: 10, CDG: 1, NRT: 11.5, DXB: 7, SIN: 13, SFO: 10.5 },
    CDG: { JFK: 7.5, LAX: 11, LHR: 1, NRT: 12, DXB: 6.5, SIN: 12.5, SFO: 11 },
    SFO: { JFK: 6, LAX: 1.5, LHR: 10.5, CDG: 11, NRT: 10, DXB: 16, SIN: 16 },
  };

  const hours =
    distances[origin]?.[destination] || distances[destination]?.[origin] || 5;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);

  return {
    duration: m > 0 ? `${h}h ${m}m` : `${h}h`,
    hours,
  };
}

function generateDepartureTimes(count: number): string[] {
  const times: string[] = [];
  const startHour = 6;
  const endHour = 22;
  const interval = (endHour - startHour) / (count - 1);

  for (let i = 0; i < count; i++) {
    const hour = Math.floor(startHour + i * interval);
    const minute = Math.floor(Math.random() * 4) * 15;
    times.push(
      `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    );
  }

  return times;
}

function calculateArrivalTime(
  departure: string,
  durationHours: number,
): string {
  const [depHour, depMinute] = departure.split(":").map(Number);
  const totalMinutes = depHour * 60 + depMinute + durationHours * 60;
  const arrHour = Math.floor(totalMinutes / 60) % 24;
  const arrMinute = Math.floor(totalMinutes % 60);
  return `${arrHour.toString().padStart(2, "0")}:${arrMinute.toString().padStart(2, "0")}`;
}

function generatePrice(durationHours: number, cabinClass: CabinClass): number {
  let basePrice = durationHours * 50 + 100;
  basePrice *= 0.8 + Math.random() * 0.4;
  const classMultiplier =
    cabinClass === "first" ? 4 : cabinClass === "business" ? 2.5 : 1;
  return Math.round(basePrice * classMultiplier);
}

export function searchFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
  passengers: number;
  cabinClass?: CabinClass;
}): FlightSearch {
  const {
    origin,
    destination,
    departureDate,
    passengers,
    cabinClass = "economy",
  } = params;

  const originAirport = getAirportByCode(origin);
  const destAirport = getAirportByCode(destination);

  if (!originAirport || !destAirport) {
    throw new Error(
      `Invalid airport code: ${!originAirport ? origin : destination}`,
    );
  }

  const searchId = generateSearchId();
  const { duration, hours } = calculateDuration(origin, destination);

  const flightCount = 5 + Math.floor(Math.random() * 4);
  const departureTimes = generateDepartureTimes(flightCount);

  const flights: Flight[] = departureTimes.map((depTime, index) => {
    const airline = AIRLINES[index % AIRLINES.length];
    const flightNum = `${airline.code}${100 + Math.floor(Math.random() * 900)}`;
    const price = generatePrice(hours, cabinClass);
    const stops = Math.random() < 0.7 ? 0 : Math.random() < 0.7 ? 1 : 2;
    const seatsAvailable = 10 + Math.floor(Math.random() * 50);

    return {
      id: generateFlightId(),
      airline,
      flightNumber: flightNum,
      origin: originAirport,
      destination: destAirport,
      departureTime: depTime,
      arrivalTime: calculateArrivalTime(depTime, hours + stops * 1.5),
      duration:
        stops > 0
          ? `${Math.floor(hours + stops * 1.5)}h ${Math.round(((hours + stops * 1.5) % 1) * 60)}m`
          : duration,
      stops,
      aircraft:
        AIRCRAFT_TYPES[Math.floor(Math.random() * AIRCRAFT_TYPES.length)],
      price,
      cabinClass,
      seatsAvailable,
    };
  });

  flights.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  const search: FlightSearch = {
    id: searchId,
    flights,
    searchParams: {
      origin,
      destination,
      date: departureDate,
      passengers,
      cabinClass,
    },
  };

  flightSearches.set(searchId, search);
  return search;
}

export function getFlightSearch(searchId: string): FlightSearch | undefined {
  return flightSearches.get(searchId);
}

export function selectFlight(
  searchId: string,
  flightId: string,
): { flight: Flight; seatMap: Seat[][] } | undefined {
  const search = flightSearches.get(searchId);
  if (!search) return undefined;

  const flight = search.flights.find((f) => f.id === flightId);
  if (!flight) return undefined;

  search.selectedFlightId = flightId;

  return {
    flight,
    seatMap: generateSeatMap(flightId),
  };
}

export function generateSeatMap(flightId: string): Seat[][] {
  let hash = 0;
  for (let i = 0; i < flightId.length; i++) {
    hash = (hash << 5) - hash + flightId.charCodeAt(i);
    hash = hash & hash;
  }

  const seededRandom = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };

  const rows: Seat[][] = [];
  const positions = ["A", "B", "C", "D", "E", "F"];
  const rowCount = 20;
  const exitRows = [10, 11];
  const occupancyRate = 0.3 + seededRandom() * 0.3;

  for (let row = 1; row <= rowCount; row++) {
    const rowSeats: Seat[] = [];
    const isExitRow = exitRows.includes(row);

    for (const pos of positions) {
      const isWindow = pos === "A" || pos === "F";
      const isAisle = pos === "C" || pos === "D";
      const isOccupied = seededRandom() < occupancyRate;
      const extraPrice = isExitRow ? 35 : isWindow ? 15 : isAisle ? 10 : 0;

      rowSeats.push({
        id: `${row}${pos}`,
        row,
        position: pos,
        status: isOccupied ? "occupied" : isExitRow ? "exit" : "available",
        isWindow,
        isAisle,
        isExitRow,
        price: extraPrice,
      });
    }

    rows.push(rowSeats);
  }

  return rows;
}

export function selectSeats(
  searchId: string,
  flightId: string,
  seatIds: string[],
): {
  success: boolean;
  message: string;
  selectedSeats?: string[];
  totalSeatFee?: number;
} {
  const search = flightSearches.get(searchId);
  if (!search) return { success: false, message: "Search session not found" };
  if (search.selectedFlightId !== flightId)
    return { success: false, message: "Flight not selected" };

  const seatMap = generateSeatMap(flightId);
  const flatSeats = seatMap.flat();

  let totalFee = 0;
  for (const seatId of seatIds) {
    const seat = flatSeats.find((s) => s.id === seatId);
    if (!seat) return { success: false, message: `Seat ${seatId} not found` };
    if (seat.status === "occupied")
      return { success: false, message: `Seat ${seatId} is already taken` };
    totalFee += seat.price;
  }

  search.selectedSeats = seatIds;

  return {
    success: true,
    message: `Selected ${seatIds.length} seat(s): ${seatIds.join(", ")}`,
    selectedSeats: seatIds,
    totalSeatFee: totalFee,
  };
}

export function createBooking(
  searchId: string,
  passengers: Passenger[],
): { success: boolean; message: string; booking?: Booking } {
  const search = flightSearches.get(searchId);
  if (!search) return { success: false, message: "Search session not found" };
  if (!search.selectedFlightId)
    return { success: false, message: "No flight selected" };
  if (!search.selectedSeats || search.selectedSeats.length === 0)
    return { success: false, message: "No seats selected" };

  const flight = search.flights.find((f) => f.id === search.selectedFlightId);
  if (!flight) return { success: false, message: "Selected flight not found" };

  const seatMap = generateSeatMap(flight.id);
  const flatSeats = seatMap.flat();
  let seatFees = 0;
  for (const seatId of search.selectedSeats) {
    const seat = flatSeats.find((s) => s.id === seatId);
    if (seat) seatFees += seat.price;
  }

  const totalPrice = flight.price * passengers.length + seatFees;
  const confirmationNumber = generateConfirmationNumber();

  const booking: Booking = {
    confirmationNumber,
    flight,
    passengers,
    seats: search.selectedSeats,
    totalPrice,
    bookedAt: new Date().toISOString(),
  };

  bookings.set(confirmationNumber, booking);
  flightSearches.delete(searchId);

  return {
    success: true,
    message: `Booking confirmed! Your confirmation number is ${confirmationNumber}`,
    booking,
  };
}

export function getBooking(confirmationNumber: string): Booking | undefined {
  return bookings.get(confirmationNumber);
}
