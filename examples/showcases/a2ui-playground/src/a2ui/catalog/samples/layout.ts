import type { ComponentName } from "../definitions";
import type { Sample } from "./types";

const stat = (id: string, label: string, value: string, delta?: string) => ({
  id,
  component: "Stat",
  label,
  value,
  ...(delta ? { delta } : {}),
});

export const layoutSamples: Partial<Record<ComponentName, Sample>> = {
  Section: {
    components: [
      {
        id: "root",
        component: "Section",
        eyebrow: "Overview",
        title: "This week",
        description: "Activity across your workspace.",
        children: ["g"],
      },
      { id: "g", component: "Row", wrap: "wrap", children: ["a", "b"] },
      stat("a", "Commits", "342"),
      stat("b", "PRs merged", "57"),
    ],
  },
  Accordion: {
    components: [
      {
        id: "root",
        component: "Accordion",
        items: [
          {
            title: "What is A2UI?",
            text: "A declarative protocol for agents to describe UI as JSON that a client renders with its own components.",
          },
          {
            title: "Fixed vs dynamic schema",
            text: "Fixed: the tree is pre-authored and the agent streams data. Dynamic: a sub-agent composes the tree per request.",
          },
          {
            title: "Does it stream?",
            text: "Yes. Components paint as they arrive over AG-UI.",
          },
        ],
      },
    ],
  },
};
