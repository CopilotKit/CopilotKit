/**
 * Search flights tool implementation.
 *
 * Simple passthrough that wraps flights for AG-UI rendering.
 * The frontend GenUI components handle presentation.
 */

import { Flight } from "./types";

/**
 * Wrap the provided flights array for consumption by the frontend
 * flight-search GenUI component.
 */
export function searchFlightsImpl(flights: Flight[]): {
  flights: Flight[];
  schema: Record<string, unknown>;
} {
  return { flights, schema: {} };
}
