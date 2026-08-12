import type { Suggestion } from "@/shell/skin-contract";

/** Airline concierge suggestion pills (registered by the shell, available:"always"). */
export const airlineSuggestions: Suggestion[] = [
  {
    title: "Check me in",
    message: "Check me in for my flight and show my current seat.",
  },
  {
    title: "Pick a seat",
    message: "Show the seat map so I can choose a window seat near the front.",
  },
  {
    title: "Loyalty status",
    message: "What's my Aeronova Club tier and how far am I from the next one?",
  },
  {
    title: "Handle my delay",
    message: "My flight looks delayed — what are my rebooking options?",
  },
  {
    title: "Track my bags",
    message: "Where are my checked bags right now?",
  },
];
