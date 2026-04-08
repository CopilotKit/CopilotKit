import { createReactComponent } from "@a2ui/react/v0_9";
import { StarRatingApi } from "./StarRatingApi";

export const ReactStarRating = createReactComponent(
  StarRatingApi,
  ({ props }) => {
    const value = typeof props.value === "number" ? props.value : 0;
    const maxStars = props.maxStars ?? 5;

    const stars = [];
    for (let i = 1; i <= maxStars; i++) {
      if (value >= i) {
        stars.push("filled");
      } else if (value >= i - 0.5) {
        stars.push("half");
      } else {
        stars.push("empty");
      }
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {props.label && (
          <span style={{ fontSize: "12px", color: "#666", fontWeight: 500 }}>
            {props.label}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          {stars.map((type, i) => (
            <span
              key={i}
              style={{
                fontSize: "20px",
                color: type === "empty" ? "#d1d5db" : "#f59e0b",
                lineHeight: 1,
              }}
            >
              {type === "empty" ? "☆" : "★"}
            </span>
          ))}
          <span
            style={{
              fontSize: "14px",
              color: "#374151",
              fontWeight: 600,
              marginLeft: "8px",
            }}
          >
            {value.toFixed(1)}
          </span>
        </div>
      </div>
    );
  },
);
