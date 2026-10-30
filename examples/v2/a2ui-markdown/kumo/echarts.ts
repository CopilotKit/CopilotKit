import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Kumo's Chart takes the ECharts core from the app, so the app registers
// only the chart types it draws.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export { echarts };
