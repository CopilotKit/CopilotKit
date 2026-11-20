/** The target id the agent renders into. The page mounts one surface with it. */
export const CANVAS_ID = "canvas";

/** Tells the model where the canvas is and what belongs in it. */
export const CANVAS_DESCRIPTION =
  "The canvas: the large workspace to the right of the chat. Draw the dashboard, form or report the user asks for here, and keep editing it in place.";

/** The three prompts on the chat's welcome screen. */
export const STARTER_PROMPTS = [
  {
    title: "Q4 team goals",
    message: "Build a dashboard for our Q4 team goals.",
  },
  {
    title: "Meetup sign-up form",
    message: "Make a sign-up form for our December customer meetup.",
  },
  {
    title: "Weekly sales report",
    message: "Create a weekly sales report for our three regions.",
  },
] as const;

/** One-click prompts in the corner of the canvas. */
export const QUICK_PROMPTS = {
  compact: "Make the canvas more compact.",
  chart: "Add a chart to the canvas.",
  translate: "Translate the canvas into Spanish.",
} as const;
