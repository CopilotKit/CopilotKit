import { Resvg } from "@resvg/resvg-js";

export type DiscordChartType =
  | "verticalBar"
  | "horizontalBar"
  | "line"
  | "pie"
  | "donut";

export interface DiscordChartDataPoint {
  readonly label: string;
  readonly value: number;
}

export interface DiscordChartInput {
  readonly type?: DiscordChartType;
  readonly title?: string;
  readonly xAxisTitle?: string;
  readonly yAxisTitle?: string;
  readonly data: readonly DiscordChartDataPoint[];
}

export interface DiscordAttachmentDescriptor {
  readonly filename: string;
  readonly mimeType: "image/png";
  readonly bytes: Uint8Array;
  readonly altText: string;
}

const WIDTH = 1200;
const HEIGHT = 675;
const CHART_TYPES: readonly DiscordChartType[] = [
  "verticalBar",
  "horizontalBar",
  "line",
  "pie",
  "donut",
];
const PALETTE = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#000000",
] as const;

/** Validate and render one portable chart to a fixed-size PNG attachment. */
export function renderDiscordChart(
  input: DiscordChartInput,
  filename: string,
): DiscordAttachmentDescriptor {
  const type = input.type ?? "verticalBar";
  if (!CHART_TYPES.includes(type)) {
    throw new Error(`Discord received unsupported chart type "${type}".`);
  }
  if (!Array.isArray(input.data)) {
    throw new Error("Discord chart data must be an array.");
  }
  validateChart(type, input.data);
  const svg = renderDiscordChartSvg({ ...input, type });
  const bytes = new Resvg(svg).render().asPng();
  return {
    filename,
    mimeType: "image/png",
    bytes,
    altText: chartAltText(input),
  };
}

function validateChart(
  type: DiscordChartType,
  data: readonly DiscordChartDataPoint[],
): void {
  const limit = type === "pie" || type === "donut" ? 12 : 50;
  if (data.length < 1 || data.length > limit) {
    throw new Error(
      `Discord ${type} chart requires 1 to ${limit} data points.`,
    );
  }
  data.forEach((point, index) => {
    if (typeof point?.label !== "string") {
      throw new Error(`Discord chart data[${index}].label must be a string.`);
    }
    if (!Number.isFinite(point.value)) {
      throw new Error(`Discord chart data[${index}].value must be finite.`);
    }
    if ((type === "pie" || type === "donut") && point.value <= 0) {
      throw new Error(
        `Discord ${type} chart data[${index}].value must be positive.`,
      );
    }
  });
}

function chartAltText(input: DiscordChartInput): string {
  const title = input.title?.trim() || "Chart";
  const summary = input.data
    .slice(0, 12)
    .map((point) => `${point.label}: ${point.value}`)
    .join(", ");
  const text = `${title}. ${summary}`;
  return text.length <= 1024 ? text : `${text.slice(0, 1023)}…`;
}

/** Build the SVG source used for Discord chart PNGs. */
export function renderDiscordChartSvg(
  input: Required<Pick<DiscordChartInput, "type">> & DiscordChartInput,
): string {
  const title = escapeXml(input.title?.trim() || "Chart");
  let plot: string;
  if (input.type === "pie" || input.type === "donut") {
    plot = radialPlot(input.data, input.type === "donut");
  } else {
    plot = cartesianPlot({ ...input, type: input.type });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="#FFFFFF"/>
  <text x="60" y="64" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111827">${title}</text>
  ${plot}
</svg>`;
}

function cartesianPlot(
  input: DiscordChartInput & {
    readonly type: "verticalBar" | "horizontalBar" | "line";
  },
): string {
  const { data, type } = input;
  const left = 110;
  const top = 105;
  const width = 1020;
  const height = 430;
  const values = data.map((point) => point.value);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const scaleY = (value: number) => top + ((maximum - value) / span) * height;
  const axisY = scaleY(0);
  const axisTitles = `${input.xAxisTitle ? `<text x="${left + width / 2}" y="625" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#374151">${escapeXml(input.xAxisTitle)}</text>` : ""}${input.yAxisTitle ? `<text x="30" y="${top + height / 2}" transform="rotate(-90 30 ${top + height / 2})" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#374151">${escapeXml(input.yAxisTitle)}</text>` : ""}`;
  const axes = `<path d="M ${left} ${top} V ${top + height} H ${left + width}" fill="none" stroke="#374151" stroke-width="2"/>${axisTitles}`;
  if (type === "horizontalBar") {
    const row = height / data.length;
    const zeroX = left + ((0 - minimum) / span) * width;
    return `${axes}${data
      .map((point, index) => {
        const valueX = left + ((point.value - minimum) / span) * width;
        const x = Math.min(zeroX, valueX);
        const barWidth = Math.max(2, Math.abs(valueX - zeroX));
        const y = top + index * row + row * 0.18;
        return `<rect x="${x}" y="${y}" width="${barWidth}" height="${row * 0.58}" rx="5" fill="${PALETTE[index % PALETTE.length]}"/><text x="${left - 12}" y="${y + row * 0.38}" text-anchor="end" font-family="Arial, sans-serif" font-size="18" fill="#1F2937">${escapeXml(point.label)}</text><text x="${valueX + (point.value >= 0 ? 8 : -8)}" y="${y + row * 0.38}" text-anchor="${point.value >= 0 ? "start" : "end"}" font-family="Arial, sans-serif" font-size="17" fill="#111827">${point.value}</text>`;
      })
      .join("")}`;
  }
  const step = width / data.length;
  if (type === "line") {
    const points: Array<readonly [number, number]> = data.map(
      (point, index) => [left + step * (index + 0.5), scaleY(point.value)],
    );
    return `${axes}<path d="${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ")}" fill="none" stroke="${PALETTE[0]}" stroke-width="6" stroke-linejoin="round"/>${points
      .map(
        ([x, y], index) =>
          `<circle cx="${x}" cy="${y}" r="8" fill="${PALETTE[index % PALETTE.length]}"/><text x="${x}" y="${y - 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="600" fill="#111827">${data[index]!.value}</text><text x="${x}" y="${top + height + 30}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#1F2937">${escapeXml(data[index]!.label)}</text>`,
      )
      .join("")}`;
  }
  return `${axes}${data
    .map((point, index) => {
      const x = left + index * step + step * 0.18;
      const y = Math.min(axisY, scaleY(point.value));
      const barHeight = Math.max(2, Math.abs(scaleY(point.value) - axisY));
      const valueY =
        point.value >= 0 ? scaleY(point.value) - 10 : scaleY(point.value) + 24;
      return `<rect x="${x}" y="${y}" width="${step * 0.64}" height="${barHeight}" rx="5" fill="${PALETTE[index % PALETTE.length]}"/><text x="${x + step * 0.32}" y="${valueY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="600" fill="#111827">${point.value}</text><text x="${x + step * 0.32}" y="${top + height + 30}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#1F2937">${escapeXml(point.label)}</text>`;
    })
    .join("")}`;
}

function radialPlot(
  data: readonly DiscordChartDataPoint[],
  donut: boolean,
): string {
  const centerX = 390;
  const centerY = 355;
  const radius = 220;
  const total = data.reduce((sum, point) => sum + point.value, 0);
  let angle = -Math.PI / 2;
  const slices =
    data.length === 1
      ? `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${PALETTE[0]}" stroke="#FFFFFF" stroke-width="3"/>`
      : data
          .map((point, index) => {
            const next = angle + (point.value / total) * Math.PI * 2;
            const path = slicePath(centerX, centerY, radius, angle, next);
            angle = next;
            return `<path d="${path}" fill="${PALETTE[index % PALETTE.length]}" stroke="#FFFFFF" stroke-width="3"/>`;
          })
          .join("");
  const hole = donut
    ? `<circle cx="${centerX}" cy="${centerY}" r="105" fill="#FFFFFF"/>`
    : "";
  const legend = data
    .map(
      (point, index) =>
        `<rect x="700" y="${145 + index * 38}" width="22" height="22" rx="4" fill="${PALETTE[index % PALETTE.length]}"/><text x="738" y="${163 + index * 38}" font-family="Arial, sans-serif" font-size="20" fill="#1F2937">${escapeXml(point.label)}: ${point.value}</text>`,
    )
    .join("");
  return `${slices}${hole}${legend}`;
}

function slicePath(
  centerX: number,
  centerY: number,
  radius: number,
  start: number,
  end: number,
): string {
  const startX = centerX + Math.cos(start) * radius;
  const startY = centerY + Math.sin(start) * radius;
  const endX = centerX + Math.cos(end) * radius;
  const endY = centerY + Math.sin(end) * radius;
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
