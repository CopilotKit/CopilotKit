import type { Sample } from "./types";
import type { ComponentName } from "../definitions";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const series = (name: string, values: number[], xs: (string | number)[] = months) => values.map((y, i) => ({ x: xs[i], y, series: name }));

/** Deterministic pseudo-random walk so samples render identically every load. */
function walk(seed: number, n: number, start: number, vol: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const out: { date: string; open: number; high: number; low: number; close: number }[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = +(open + rnd() * vol * 2 + vol * 0.08).toFixed(2);
    const high = +(Math.max(open, close) + Math.abs(rnd()) * vol).toFixed(2);
    const low = +(Math.min(open, close) - Math.abs(rnd()) * vol).toFixed(2);
    const d = new Date(Date.UTC(2026, 8, 1 + i));
    out.push({ date: `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`, open: +open.toFixed(2), high, low, close });
    price = close;
  }
  return out;
}

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = ["00", "03", "06", "09", "12", "15", "18", "21"];
const heat = days.flatMap((d, di) =>
  hours.map((h, hi) => {
    const work = di < 5 ? 1 : 0.35;
    const curve = Math.exp(-((hi - 4.2) ** 2) / 4.5);
    return { x: h, y: d, value: Math.round(40 + 860 * work * curve + ((di * 7 + hi * 13) % 9) * 12) };
  }),
);

export const chartsSamples: Partial<Record<ComponentName, Sample>> = {
  LineChart: {
    wide: true,
    components: [
      {
        id: "root",
        component: "LineChart",
        title: "Weekly active users",
        subtitle: "Web vs mobile, last 12 months",
        format: "compact",
        data: [
          ...series("Web", [18200, 19400, 21100, 20800, 23900, 26400, 25800, 28900, 31200, 33800, 35100, 38400]),
          ...series("Mobile", [9800, 10900, 12600, 14100, 15900, 17200, 19800, 21400, 24100, 26900, 29300, 32600]),
        ],
      },
    ],
  },
  AreaChart: {
    wide: true,
    components: [
      {
        id: "root",
        component: "AreaChart",
        title: "Inference spend by workload",
        subtitle: "Stacked monthly cost, USD",
        format: "currency",
        stacked: true,
        data: [
          ...series("Chat", [4200, 4800, 5600, 6100, 7300, 8100, 8900, 9400, 10800, 11600, 12900, 14100]),
          ...series("Agents", [2100, 2600, 3300, 3900, 4400, 5200, 6100, 6900, 7400, 8300, 9100, 9800]),
          ...series("Embeddings", [900, 950, 1100, 1180, 1260, 1400, 1520, 1610, 1700, 1820, 1950, 2080]),
        ],
      },
    ],
  },
  BarChart: {
    components: [
      {
        id: "root",
        component: "BarChart",
        title: "Revenue by region",
        subtitle: "Quarterly, USD",
        format: "currency",
        data: [
          ...series("2025", [412000, 298000, 186000, 94000], ["NA", "EMEA", "APAC", "LATAM"]),
          ...series("2026", [538000, 371000, 262000, 131000], ["NA", "EMEA", "APAC", "LATAM"]),
        ],
      },
    ],
  },
  PieChart: {
    components: [
      {
        id: "root",
        component: "PieChart",
        title: "Traffic sources",
        subtitle: "Sessions, last 30 days",
        donut: true,
        centerLabel: "sessions",
        format: "compact",
        data: [
          { label: "Organic search", value: 48200 },
          { label: "Direct", value: 27100 },
          { label: "Referral", value: 14600 },
          { label: "Social", value: 9800 },
          { label: "Email", value: 5300 },
        ],
      },
    ],
  },
  ScatterChart: {
    components: [
      {
        id: "root",
        component: "ScatterChart",
        title: "Latency vs throughput",
        subtitle: "Per deployment, bubble size is replica count",
        xLabel: "Requests / s",
        yLabel: "p95 latency",
        unit: "ms",
        data: [
          { x: 120, y: 84, size: 2, series: "us-east", label: "api-gateway" },
          { x: 340, y: 112, size: 4, series: "us-east", label: "search" },
          { x: 610, y: 168, size: 8, series: "us-east", label: "checkout" },
          { x: 880, y: 241, size: 12, series: "us-east", label: "catalog" },
          { x: 210, y: 64, size: 3, series: "eu-west", label: "auth" },
          { x: 450, y: 98, size: 5, series: "eu-west", label: "search" },
          { x: 720, y: 132, size: 9, series: "eu-west", label: "checkout" },
          { x: 960, y: 188, size: 14, series: "eu-west", label: "catalog" },
          { x: 300, y: 142, size: 2, series: "ap-south", label: "search" },
          { x: 520, y: 205, size: 6, series: "ap-south", label: "checkout" },
          { x: 690, y: 262, size: 7, series: "ap-south", label: "catalog" },
        ],
      },
    ],
  },
  Heatmap: {
    wide: true,
    components: [
      {
        id: "root",
        component: "Heatmap",
        title: "API requests by hour",
        subtitle: "Average per 3h window, last 4 weeks (UTC)",
        format: "compact",
        data: heat,
      },
    ],
  },
  Sparkline: {
    components: [
      {
        id: "root",
        component: "Sparkline",
        label: "Monthly recurring revenue",
        value: "$184.2K",
        delta: "+12.4%",
        tone: "positive",
        values: [128, 131, 129, 138, 142, 140, 149, 155, 153, 162, 171, 168, 176, 184],
      },
    ],
  },
  RadarChart: {
    components: [
      {
        id: "root",
        component: "RadarChart",
        title: "Model eval profile",
        subtitle: "Score out of 100 per benchmark",
        max: 100,
        data: [
          ...["Reasoning", "Coding", "Math", "Tool use", "Long context", "Latency"].map((axis, i) => ({ axis, value: [92, 88, 85, 90, 78, 64][i], series: "Model A" })),
          ...["Reasoning", "Coding", "Math", "Tool use", "Long context", "Latency"].map((axis, i) => ({ axis, value: [81, 79, 72, 84, 91, 88][i], series: "Model B" })),
        ],
      },
    ],
  },
  CandlestickChart: {
    wide: true,
    components: [
      {
        id: "root",
        component: "CandlestickChart",
        title: "Halvorsen Robotics (HLVR)",
        subtitle: "Daily OHLC, September 2026",
        format: "currency",
        data: walk(42, 30, 182.4, 3.2),
      },
    ],
  },
  Treemap: {
    wide: true,
    components: [
      {
        id: "root",
        component: "Treemap",
        title: "Cloud spend by service",
        subtitle: "Last 30 days, USD",
        format: "currency",
        // Short enough that the whole map fits its overview tile.
        height: 200,
        data: [
          { name: "VMs", value: 48200, group: "Compute" },
          { name: "Functions", value: 12800, group: "Compute" },
          { name: "Containers", value: 9600, group: "Compute" },
          { name: "Objects", value: 21400, group: "Storage" },
          { name: "Disks", value: 11200, group: "Storage" },
          { name: "Archive", value: 2600, group: "Storage" },
          { name: "SQL", value: 26800, group: "Database" },
          { name: "Key-value", value: 9900, group: "Database" },
          { name: "Cache", value: 5400, group: "Database" },
          { name: "CDN", value: 8700, group: "Network" },
          { name: "Egress", value: 6100, group: "Network" },
          { name: "Inference", value: 17300, group: "AI" },
          { name: "Training", value: 7900, group: "AI" },
        ],
      },
    ],
  },
  SankeyChart: {
    wide: true,
    components: [
      {
        id: "root",
        component: "SankeyChart",
        title: "Signup funnel",
        subtitle: "Visitors to paid accounts, last quarter",
        format: "compact",
        links: [
          { source: "Organic", target: "Visited pricing", value: 21000 },
          { source: "Paid ads", target: "Visited pricing", value: 12500 },
          { source: "Referral", target: "Visited pricing", value: 6500 },
          { source: "Visited pricing", target: "Started trial", value: 14200 },
          { source: "Visited pricing", target: "Bounced", value: 25800 },
          { source: "Started trial", target: "Paid", value: 5100 },
          { source: "Started trial", target: "Churned in trial", value: 9100 },
        ],
      },
    ],
  },
  Gauge: {
    components: [
      {
        id: "root",
        component: "Gauge",
        title: "GPU cluster utilization",
        value: 72,
        min: 0,
        max: 100,
        format: "percent",
        label: "of 512 GPUs busy",
      },
    ],
  },
};
