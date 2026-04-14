// Types
export type { SalesTodo } from "./types";
export { SALES_STAGES, INITIAL_SALES_TODOS } from "./types";

// Hooks
export { useShowcaseHooks } from "./hooks/use-showcase-hooks";
export { useShowcaseSuggestions } from "./hooks/use-showcase-suggestions";

// Components
export {
  WeatherCard,
  getWeatherGradient,
  getWeatherIcon,
} from "./components/weather-card";
export type { WeatherCardProps } from "./components/weather-card";
export { MeetingTimePicker } from "./components/meeting-time-picker";
export type {
  MeetingTimePickerProps,
  TimeSlot,
} from "./components/meeting-time-picker";
export { PieChart, PieChartProps } from "./components/pie-chart";
export { BarChart, BarChartProps } from "./components/bar-chart";
export { CHART_COLORS, CHART_CONFIG } from "./components/chart-config";
export { ToolReasoning } from "./components/tool-reasoning";
export { DemoWrapper, DemoErrorBoundary } from "./components/demo-wrapper";

// Sales Dashboard
export { SalesDashboard } from "./components/sales-dashboard";

// A2UI Catalog
export {
  demonstrationCatalogDefinitions,
  type DemonstrationCatalogDefinitions,
} from "./a2ui/definitions";
export { demonstrationCatalog } from "./a2ui/renderers";
