/**
 * A2UI Component Schema — defines what components agents can generate.
 *
 * This is the "contract" between the app and the AI agent.
 * The schema flows to agents as context so they know what's available.
 */
export const a2uiSchema = [
  {
    name: "StarRating",
    description:
      "Displays a star rating with optional label. Use for ratings, reviews, scores.",
    props: {
      type: "object",
      properties: {
        value: {
          type: "number",
          description: "Rating value from 0 to maxStars",
        },
        maxStars: {
          type: "number",
          description: "Maximum number of stars (default 5)",
        },
        label: {
          type: "string",
          description: "Label text displayed above the rating",
        },
      },
      required: ["value"],
    },
  },
];
