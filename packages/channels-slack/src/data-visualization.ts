/** Validate Slack's documented `data_visualization` block contract. */
export function validateSlackDataVisualization(
  value: Record<string, unknown>,
  path: string,
): void {
  const blockPath = `${path}.DataVisualization`;
  assertString(value.title, `${blockPath}.title`, 50);

  const chart = assertRecord(value.chart, `${blockPath}.chart`);
  switch (chart.type) {
    case "pie":
      validatePieChart(chart, `${blockPath}.chart`);
      return;
    case "bar":
    case "area":
    case "line":
      validateSeriesChart(chart, `${blockPath}.chart`);
      return;
    default:
      throw new Error(
        `${blockPath}.chart.type must be pie, bar, area, or line.`,
      );
  }
}

function validatePieChart(chart: Record<string, unknown>, path: string): void {
  const segments = assertArray(chart.segments, `${path}.segments`, 1, 12);
  for (const [index, value] of segments.entries()) {
    const segmentPath = `${path}.segments[${index}]`;
    const segment = assertRecord(value, segmentPath);
    assertString(segment.label, `${segmentPath}.label`, 20);
    const number = assertFiniteNumber(segment.value, `${segmentPath}.value`);
    if (number <= 0) {
      throw new Error(`${segmentPath}.value must be greater than 0.`);
    }
  }
}

function validateSeriesChart(
  chart: Record<string, unknown>,
  path: string,
): void {
  const series = assertArray(chart.series, `${path}.series`, 1, 12);
  const names: string[] = [];
  const dataBySeries: readonly {
    readonly path: string;
    readonly points: readonly Record<string, unknown>[];
  }[] = series.map((value, index) => {
    const seriesPath = `${path}.series[${index}]`;
    const current = assertRecord(value, seriesPath);
    names.push(assertString(current.name, `${seriesPath}.name`, 20));
    const data = assertArray(current.data, `${seriesPath}.data`, 1, 20);
    return {
      path: seriesPath,
      points: data.map((point, pointIndex) => {
        const pointPath = `${seriesPath}.data[${pointIndex}]`;
        const currentPoint = assertRecord(point, pointPath);
        assertString(currentPoint.label, `${pointPath}.label`, 20);
        assertFiniteNumber(currentPoint.value, `${pointPath}.value`);
        return currentPoint;
      }),
    };
  });

  if (new Set(names).size !== names.length) {
    throw new Error(`${path}.series names must be unique.`);
  }

  const axis = assertRecord(chart.axis_config, `${path}.axis_config`);
  const categoryValues = assertArray(
    axis.categories,
    `${path}.axis_config.categories`,
    1,
    20,
  );
  const categories = categoryValues.map((category, index) =>
    assertString(category, `${path}.axis_config.categories[${index}]`, 20),
  );
  if (new Set(categories).size !== categories.length) {
    throw new Error(`${path}.axis_config.categories must be unique.`);
  }
  if (axis.x_label !== undefined) {
    assertString(axis.x_label, `${path}.axis_config.x_label`, 50);
  }
  if (axis.y_label !== undefined) {
    assertString(axis.y_label, `${path}.axis_config.y_label`, 50);
  }

  for (const current of dataBySeries) {
    const labels = current.points.map((point) => String(point.label));
    if (
      labels.length !== categories.length ||
      new Set(labels).size !== labels.length ||
      labels.some((label) => !categories.includes(label))
    ) {
      throw new Error(
        `${current.path}.data labels must match axis_config.categories exactly.`,
      );
    }
  }
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${path} must contain ${minimum} to ${maximum} items.`);
  }
  return value;
}

function assertString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  if (value.length > maximum) {
    throw new Error(`${path} must be at most ${maximum} characters.`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}
