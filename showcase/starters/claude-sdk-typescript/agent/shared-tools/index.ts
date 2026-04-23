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
export {
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
  RENDER_A2UI_TOOL_SCHEMA,
  CUSTOM_CATALOG_ID,
} from "./generate-a2ui";
export type {
  GenerateA2UIInput,
  GenerateA2UIResult,
  A2UIOperation,
} from "./generate-a2ui";
export type { SalesTodo, SalesStage, Flight, WeatherResult } from "./types";
