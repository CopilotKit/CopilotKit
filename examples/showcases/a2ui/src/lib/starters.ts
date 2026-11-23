/**
 * The welcome's starting questions. Each asks something open, the way a
 * reader would, and the agent decides what to show; `view` only tells the
 * reader what to expect, and `icon` names one of the thread icons.
 */
export const STARTERS = [
  {
    title: "Climate over time",
    message: "How has climate change affected us over time?",
    icon: "thermometer",
    view: "Chart and table",
  },
  {
    title: "Living longer",
    message:
      "How has life expectancy changed across continents over the last century?",
    icon: "heart-pulse",
    view: "Line chart",
  },
  {
    title: "My commute",
    message:
      "Help me estimate my commute's yearly CO2. I drive about 15 miles each way, and I'd like to see how other options would compare.",
    icon: "leaf",
    view: "Live calculator",
  },
  {
    title: "Choosing a program",
    message:
      "I'm choosing a master's program in public health. Help me narrow it down.",
    icon: "graduation-cap",
    view: "A form, then a table",
  },
  {
    title: "The Aral Sea",
    message: "What happened to the Aral Sea? Show me how it changed.",
    icon: "globe",
    view: "Pictures and a chart",
  },
  {
    title: "Brief me on fusion",
    message: "Write me a short report on where fusion energy stands today.",
    icon: "atom",
    view: "A report beside the chat",
  },
  {
    title: "Rent or buy",
    message:
      "Should I rent or buy a home? Help me work it out with my own numbers.",
    icon: "building",
    view: "Your numbers, recomputed",
  },
  {
    title: "Great migrations",
    message: "Show me the great animal migrations of the world.",
    icon: "compass",
    view: "A picture grid",
  },
];

export const DISCLAIMER =
  "Answers come from Gemini and the sources it finds. Check figures that matter.";
