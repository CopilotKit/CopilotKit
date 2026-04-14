/**
 * Shared TypeScript tool implementations for CopilotKit showcase.
 *
 * Pure functions with no framework imports — consumed by
 * langgraph-typescript, mastra, claude-sdk-typescript, and any
 * future TypeScript-based showcase packages.
 */

export { getWeatherImpl } from "./get-weather";
export { queryDataImpl } from "./query-data";
export type { DataRow } from "./query-data";
export {
  manageSalesTodosImpl,
  getSalesTodosImpl,
  INITIAL_SALES_TODOS,
} from "./sales-todos";
export { searchFlightsImpl } from "./search-flights";
export { scheduleMeetingImpl } from "./schedule-meeting";
export type { ScheduleMeetingResult } from "./schedule-meeting";
export type { SalesTodo, SalesStage, Flight, WeatherResult } from "./types";
