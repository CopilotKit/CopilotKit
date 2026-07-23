/**
 * Shared type definitions for showcase tools.
 *
 * These mirror the Python types in showcase/shared/python/tools/types.py
 * and the frontend types in showcase/shared/frontend/src/types.ts.
 */

export type SalesStage =
  | "prospect"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed-won"
  | "closed-lost";

export interface SalesTodo {
  id: string;
  title: string;
  stage: SalesStage;
  value: number;
  dueDate: string;
  assignee: string;
  completed: boolean;
}

export interface Flight {
  airline: string;
  airlineLogo: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  status: string;
  statusColor: string;
  price: string;
  currency: string;
}

export interface WeatherResult {
  city: string;
  temperature: number;
  humidity: number;
  wind_speed: number;
  feels_like: number;
  conditions: string;
}
