export const mapJustify = (justify?: string): string => {
  switch (justify) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "spaceAround":
      return "space-around";
    case "spaceBetween":
      return "space-between";
    case "spaceEvenly":
      return "space-evenly";
    case "stretch":
      return "stretch";
    case "start":
    default:
      return "flex-start";
  }
};

export const mapAlign = (align?: string): string => {
  switch (align) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
    default:
      return "stretch";
  }
};
