export function IntegrationsSelectorLightMobile({
  className,
  rows = 7,
  rowHeight = 60,
}: {
  className?: string;
  rows?: number;
  rowHeight?: number;
}) {
  // Row spacing: button height + 8px gap
  const ROW_SPACING = rowHeight + 8;
  const FIRST_ROW_Y = 90 + rowHeight / 2; // pt-[90px] offset + half button height

  // Unique ID prefix to avoid conflicts when multiple SVGs are in the DOM
  const idPrefix = `light-mobile-${rowHeight}`;

  // Calculate y position for each row
  const getRowY = (rowIndex: number) => FIRST_ROW_Y + rowIndex * ROW_SPACING;

  // Calculate SVG height based on row count
  const lastRowY = getRowY(rows - 1);
  const svgHeight = Math.max(342, lastRowY + 40);

  // Generate trunk path (goes to the last row)
  const trunkEndY = lastRowY;
  const trunkPath = `M58.6 89.68V${trunkEndY - 12}C58.6 ${trunkEndY} 68.9 ${trunkEndY + 12} 81.6 ${trunkEndY + 12}`;

  // Generate branch paths for rows 0 to n-2 (trunk handles last row)
  const branchPaths = Array.from({ length: Math.max(0, rows - 1) }, (_, i) => {
    const y = getRowY(i);
    return `M58.6 ${y - 25}V${y - 12}C58.6 ${y} 68.9 ${y + 12} 81.6 ${y + 12}`;
  });

  return (
    <svg
      className={className}
      width="116"
      height={svgHeight}
      viewBox={`0 0 116 ${svgHeight}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="25.5996"
        y="25.6826"
        width="64"
        height="64"
        rx="32"
        fill="white"
      />
      <path
        d="M47.8245 52.0662C50.5639 48.483 52.8375 44.9397 53.7124 42.0783C53.7359 42.0005 53.8271 41.9674 53.8948 42.0124C56.9369 44.0269 62.4779 45.3529 67.379 45.384C67.4633 45.3846 67.5214 45.4677 67.4909 45.5463C65.8614 49.6804 63.8711 57.088 63.7937 65.5471C63.7937 65.6728 63.6168 65.7178 63.5546 65.6087C60.7655 60.7276 51.8313 53.8689 47.8701 52.2501C47.7969 52.22 47.7761 52.1295 47.8245 52.0662Z"
        fill={`url(#${idPrefix}-paint0)`}
      />
      <path
        d="M57.067 49.8744C52.7851 51.2301 48.8723 51.9838 47.938 52.155C47.8786 52.1659 47.8661 52.2482 47.9228 52.2714C51.9144 53.9309 60.8043 60.7696 63.5672 65.6309C63.5727 65.6415 63.5866 65.6454 63.5976 65.6405C63.6087 65.6353 63.6142 65.6215 63.6101 65.6096L57.067 49.8744Z"
        fill={`url(#${idPrefix}-paint1)`}
      />
      <path
        d="M53.9076 42.0034C57.573 44.0028 61.8093 44.9008 67.4291 45.374C67.4636 45.377 67.4761 45.4243 67.4443 45.4408C66.7256 45.8101 62.6082 47.9053 59.5509 49.0275C58.7313 49.3281 57.9075 49.607 57.0962 49.8643C57.0782 49.8699 57.0589 49.8611 57.052 49.8439L53.8233 42.0791C53.8012 42.0269 53.8578 41.9763 53.9076 42.0034Z"
        fill={`url(#${idPrefix}-paint2)`}
      />
      <path
        d="M53.8423 42.1215L63.6776 65.5839"
        stroke="#513C9F"
        strokeWidth="0.147105"
        strokeLinecap="round"
      />
      <path
        d="M47.9409 52.1518C47.9409 52.1518 53.3727 51.1769 58.4783 49.4158C63.5826 47.6548 67.3835 45.4984 67.3835 45.4984"
        stroke="#513C9F"
        strokeWidth="0.147105"
        strokeLinecap="round"
      />
      <path
        d="M55.1913 45.0858L51.548 57.2094M51.548 57.2094H60.2071M51.548 57.2094L37.8662 73.3221"
        stroke="#ABABAB"
        strokeWidth="0.257437"
        strokeLinecap="round"
      />
      <path
        d="M47.3605 70.005L45.7476 70.2319C46.5838 72.4433 48.299 73.4093 50.3459 73.4093C55.3631 73.4093 53.8317 67.7357 56.7383 67.7357C58.8475 67.7357 57.9905 72.3342 62.5281 72.3342C65.2979 72.3342 65.5743 69.544 65.1016 68.3436C65.0989 68.3363 65.0961 68.3296 65.092 68.323L64.3498 67.1865C64.3014 67.1108 64.1839 67.1393 64.1756 67.2292L64.0374 68.6067C64.0277 68.7025 64.0305 68.798 64.0415 68.8937C64.1549 69.8454 64.2281 72.1551 62.5281 72.1551C60.7355 72.1551 60.3042 67.6162 56.7383 67.6162C52.556 67.6162 53.0936 73.2301 50.5256 73.2301C48.8311 73.2301 47.5388 71.319 47.3605 70.005Z"
        fill={`url(#${idPrefix}-paint3)`}
      />
      <path
        opacity="0.5"
        d="M13.2988 57.5999C13.2988 33.1337 33.1325 13.3002 57.5986 13.3C82.0648 13.3 101.898 33.1336 101.898 57.5998C101.898 82.066 82.0648 101.9 57.5986 101.9C33.1326 101.9 13.2989 82.0659 13.2988 57.5999Z"
        stroke={`url(#${idPrefix}-paint4)`}
      />
      <circle
        opacity="0.3"
        cx="57.6"
        cy="57.6"
        r="57.1"
        stroke={`url(#${idPrefix}-paint5)`}
      />

      {/* Main trunk line */}
      <path d={trunkPath} stroke="#BEC2FF" />

      {/* Branch connectors */}
      {branchPaths.map((d, i) => (
        <path key={i} d={d} stroke="#BEC2FF" />
      ))}

      <defs>
        <linearGradient
          id={`${idPrefix}-paint0`}
          x1="60.507"
          y1="43.8318"
          x2="55.7289"
          y2="56.9707"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6430AB" />
          <stop offset="1" stopColor="#AA89D8" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-paint1`}
          x1="56.8044"
          y1="51.2373"
          x2="50.6539"
          y2="63.122"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#005DBB" />
          <stop offset="1" stopColor="#3D92E8" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-paint2`}
          x1="59.5509"
          y1="43.8316"
          x2="57.6988"
          y2="49.6247"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1B70C4" />
          <stop offset="1" stopColor="#54A4F2" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-paint3`}
          x1="45.7476"
          y1="70.3933"
          x2="65.2882"
          y2="70.3933"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4497EA" />
          <stop offset="0.254755" stopColor="#1463B2" />
          <stop offset="0.498725" stopColor="#0A437D" />
          <stop offset="0.666667" stopColor="#2476C8" />
          <stop offset="0.972542" stopColor="#0C549A" />
        </linearGradient>
        <radialGradient
          id={`${idPrefix}-paint4`}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(29.4783 92.7997) rotate(-45.8275) scale(89.5789 74.6789)"
        >
          <stop stopColor="#BEC2FF" />
          <stop offset="1" stopColor="#BEC2FF" stopOpacity="0.3" />
        </radialGradient>
        <radialGradient
          id={`${idPrefix}-paint5`}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(12.3429 21.4451) rotate(31.8516) scale(113.557 94.6685)"
        >
          <stop stopColor="#BEC2FF" />
          <stop offset="1" stopColor="#BEC2FF" stopOpacity="0.3" />
        </radialGradient>
      </defs>
    </svg>
  );
}
