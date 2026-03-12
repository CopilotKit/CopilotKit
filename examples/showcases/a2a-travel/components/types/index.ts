/**
 * Shared Type Definitions
 *
 * This file contains all TypeScript interfaces and types used across
 * the travel planning demo components. Centralizing types makes them
 * easier to maintain and reuse.
 */

import { ActionRenderProps } from "@copilotkit/react-core";

// ============================================================================
// A2A Action Types
// ============================================================================

/**
 * Type for the send_message_to_a2a_agent action parameters
 * Used when the orchestrator sends tasks to A2A agents
 */
export type MessageActionRenderProps = ActionRenderProps<
  [
    {
      readonly name: "agentName";
      readonly type: "string";
      readonly description: "The name of the A2A agent to send the message to";
    },
    {
      readonly name: "task";
      readonly type: "string";
      readonly description: "The message to send to the A2A agent";
    }
  ]
>;

/**
 * Type for the budget approval action parameters
 * Used in Human-in-the-Loop (HITL) budget approval workflow
 */
export type BudgetApprovalActionRenderProps = ActionRenderProps<
  [
    {
      readonly name: "budgetData";
      readonly type: "object";
      readonly description: "The budget data to approve";
    }
  ]
>;

/**
 * Type for trip requirements action parameters
 * Used to gather essential trip information at the start
 */
export type TripRequirementsActionRenderProps = ActionRenderProps<
  [
    {
      readonly name: "city";
      readonly type: "string";
      readonly description: "The destination city (may be pre-filled from user message)";
    },
    {
      readonly name: "numberOfDays";
      readonly type: "number";
      readonly description: "Number of days for the trip (1-7)";
    },
    {
      readonly name: "numberOfPeople";
      readonly type: "number";
      readonly description: "Number of people in the group (1-15)";
    },
    {
      readonly name: "budgetLevel";
      readonly type: "string";
      readonly description: "Budget level: Economy, Comfort, or Premium";
    }
  ]
>;

// ============================================================================
// Agent Data Structures
// ============================================================================

/**
 * Time slot structure for activities during a day
 * Used in the itinerary to organize morning/afternoon/evening activities
 */
export interface TimeSlot {
  activities: string[];
  location: string;
}

/**
 * Meals structure for a day
 * Contains breakfast, lunch, and dinner recommendations
 */
export interface Meals {
  breakfast: string;
  lunch: string;
  dinner: string;
}

/**
 * Single day itinerary structure
 * Contains all activities and meals for one day of travel
 */
export interface DayItinerary {
  day: number;
  title: string;
  morning: TimeSlot;
  afternoon: TimeSlot;
  evening: TimeSlot;
  meals: Meals;
}

/**
 * Complete itinerary data from Itinerary Agent
 * Structured JSON output from the LangGraph itinerary agent
 */
export interface ItineraryData {
  destination: string;
  days: number;
  itinerary: DayItinerary[];
}

/**
 * Restaurant recommendations data from Restaurant Agent
 * Day-by-day meal recommendations that populate the itinerary meals section
 */
export interface RestaurantData {
  destination: string;
  days: number;
  meals: Array<{
    day: number;
    breakfast: string;
    lunch: string;
    dinner: string;
  }>;
}

/**
 * Budget category breakdown
 * Individual category with amount and percentage of total
 */
export interface BudgetCategory {
  category: string;
  amount: number;
  percentage: number;
}

/**
 * Complete budget data from Budget Agent
 * Structured JSON output from the ADK budget agent
 */
export interface BudgetData {
  totalBudget: number;
  currency: string;
  breakdown: BudgetCategory[];
  notes: string;
}

/**
 * Daily weather forecast
 * Contains weather conditions, temperatures, and description
 */
export interface DailyWeather {
  day: number;
  date: string;
  condition: string;
  highTemp: number;
  lowTemp: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  description: string;
}

/**
 * Complete weather data from Weather Agent
 * Structured JSON output from the ADK weather agent
 */
export interface WeatherData {
  destination: string;
  forecast: DailyWeather[];
  travelAdvice: string;
  bestDays: number[];
}

// ============================================================================
// Component Props
// ============================================================================

/**
 * Props for the main TravelChat component
 * Callbacks to update parent component state with agent data
 */
export interface TravelChatProps {
  onItineraryUpdate?: (data: ItineraryData | null) => void;
  onBudgetUpdate?: (data: BudgetData | null) => void;
  onWeatherUpdate?: (data: WeatherData | null) => void;
  onRestaurantUpdate?: (data: RestaurantData | null) => void;
}

/**
 * Agent styling configuration
 * Used to style agent badges with consistent colors and icons
 */
export interface AgentStyle {
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: string;
  framework: string;
}
