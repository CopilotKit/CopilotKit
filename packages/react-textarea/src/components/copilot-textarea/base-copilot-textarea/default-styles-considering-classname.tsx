// A slightly hacky way to get the default styles of a CopilotTextarea considering its className --
// to allow for outside (tailwindCSS) overrides of the default styles.
export function defaultStylesConsideringClassname(
  className: string | undefined
) {
  let defaultStyles: React.CSSProperties = {};
  const classNameChunks = (className ?? "").split(" ") ?? [];

  // white background color
  if (!classNameChunks.some((chunk) => chunk.startsWith("bg-"))) {
    defaultStyles = {
      ...defaultStyles,
      backgroundColor: "white",
    };
  }

  // overflow-y: auto
  // if there is a overflow- which is NOT overflow-x, then we don't add overflow-y: auto
  if (
    !classNameChunks.some(
      (chunk) =>
        chunk.startsWith("overflow-") && !chunk.startsWith("overflow-x")
    )
  ) {
    defaultStyles = {
      ...defaultStyles,
      overflowY: "auto",
    };
  }

  // resize-y
  // if there is a resize- which is NOT resize-x, then we don't add resize-y
  if (
    !classNameChunks.some(
      (chunk) => chunk.startsWith("resize-") && !chunk.startsWith("resize-x")
    )
  ) {
    defaultStyles = {
      ...defaultStyles,
      resize: "vertical",
    };
  }

  return defaultStyles;
}
