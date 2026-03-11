export function IntegrationsSelectorDarkDesktop({
  className,
  rows = 3,
  rowHeight = 60,
}: {
  className?: string;
  rows?: number;
  rowHeight?: number;
}) {
  // Unique ID prefix to avoid conflicts
  const idPrefix = `dark-desktop-${rowHeight}`;

  // Grid layout calculations
  const GAP = 8; // gap-2 = 8px
  const ROW_SPACING = rowHeight + GAP;

  // Total grid height = rows * rowHeight + (rows - 1) * gap
  const totalGridHeight = rows * rowHeight + (rows - 1) * GAP;

  // SVG dimensions - height matches grid height exactly for items-center alignment
  const svgHeight = totalGridHeight;

  // Connector coordinates in viewBox space
  const CONNECTOR_START_X = 0;
  const CONNECTOR_END_X = 60;
  const svgWidth = CONNECTOR_END_X;

  // Kite center at SVG vertical center (which aligns with grid center due to items-center)
  const KITE_CENTER_Y = svgHeight / 2;

  // Row Y positions - center of each row from top of grid/SVG
  const getRowY = (rowIndex: number) => {
    return rowIndex * ROW_SPACING + rowHeight / 2;
  };

  // Generate connector path - smooth diagonal arc from center to target row
  const getConnectorPath = (rowIndex: number) => {
    const targetY = getRowY(rowIndex);
    const startX = CONNECTOR_START_X;
    const endX = CONNECTOR_END_X;
    const distanceFromCenter = Math.abs(targetY - KITE_CENTER_Y);

    if (distanceFromCenter < 5) {
      // Nearly horizontal - straight line
      return `M${startX} ${KITE_CENTER_Y}H${endX}`;
    } else {
      // Diagonal arc: control points shifted to create more diagonal trajectory
      // First control point: partway across X, partway toward target Y
      // Second control point: closer to end, at target Y
      const cp1X = startX + 15;
      const cp1Y = KITE_CENTER_Y + (targetY - KITE_CENTER_Y) * 0.7;
      const cp2X = startX + 35;
      const cp2Y = targetY;
      return `M${startX} ${KITE_CENTER_Y}C${cp1X} ${cp1Y} ${cp2X} ${cp2Y} ${endX} ${targetY}`;
    }
  };

  return (
    <svg
      className={className}
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Dynamic connectors for each row */}
      {Array.from({ length: rows }, (_, i) => (
        <path
          key={i}
          d={getConnectorPath(i)}
          stroke={`url(#${idPrefix}-connector${i})`}
          strokeWidth="2"
        />
      ))}

      <defs>
        {Array.from({ length: rows }, (_, i) => (
          <linearGradient
            key={i}
            id={`${idPrefix}-connector${i}`}
            x1={CONNECTOR_START_X}
            y1={KITE_CENTER_Y}
            x2={CONNECTOR_END_X}
            y2={getRowY(i)}
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#7076D5" stopOpacity="0" />
            <stop offset="0.4" stopColor="#7076D5" />
            <stop offset="1" stopColor="#7076D5" />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}
