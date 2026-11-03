export type LockedFeatureOutlineItem = Readonly<{
  icon: string;
  title: string;
  description: string;
}>;

export const THREADS_LOCKED_VIDEO_URL =
  "https://www.loom.com/embed/79817778d29e490c97225127d2f17b3a?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true&hide_speed=true";

export const LEARNING_LOCKED_VIDEO_URL =
  "https://www.loom.com/embed/2978fbfe42324e509057ac5fd46b7a70?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true&hide_speed=true";

export const THREADS_LOCKED_COPY = {
  heading:
    "Production-grade chat threads without the complexity. Self hostable.",
  description:
    "Chat threads that go beyond text with generative UI and multimodal inputs, built to replay missed events and stay in sync across tabs, sessions, and devices.",
} as const;

export const LEARNING_LOCKED_COPY = {
  heading: "Turn every interaction into reusable context.",
  description:
    "Learning captures durable information from agent interactions and brings it back when it matters, so your product gets more useful over time.",
} as const;

export const THREADS_LOCKED_FEATURE_OUTLINE = [
  {
    icon: "MessagesSquare",
    title: "The whole conversation comes back",
    description:
      "Rich Threads restores the complete interaction, not just a transcript. Messages, tool calls, shared state, generated interfaces, and supported files return together when a user reopens the thread.",
  },
  {
    icon: "LayoutGrid",
    title: "Generated UI stays in the thread",
    description:
      "Cards, charts, A2UI surfaces, MCP Apps, and tool renderers remain part of the conversation. The demo above shows a generated spending chart returning after a reload.",
  },
  {
    icon: "RefreshCw",
    title: "Return without starting over",
    description:
      "Users can move across sessions and devices while thread lists stay synchronized across open tabs. Rich Threads replays missed events and reconnects to work already in progress.",
  },
  {
    icon: "Server",
    title: "Infrastructure you do not have to rebuild",
    description:
      "CopilotKit handles durable event storage, replay, synchronization, lifecycle APIs, and thread locks on one portable AG-UI history model. Use CopilotKit Cloud or deploy Intelligence in your own Kubernetes environment.",
  },
] as const satisfies ReadonlyArray<LockedFeatureOutlineItem>;

export const LEARNING_LOCKED_FEATURE_OUTLINE = [
  {
    icon: "History",
    title: "Memory across sessions",
    description:
      "Keep useful facts, preferences, and decisions after the thread closes. Learning gives future conversations the context they need without asking users to repeat themselves.",
  },
  {
    icon: "Search",
    title: "Recall by meaning",
    description:
      "Surface relevant memories by what they mean, not by an exact phrase. Your agent can bring the right context into a new interaction even when the user asks in a completely different way.",
  },
  {
    icon: "Layers",
    title: "Built-in structure",
    description:
      "Turn raw interactions into organized topical, episodic, and operational knowledge. Learning separates enduring facts from individual experiences and useful instructions automatically.",
  },
  {
    icon: "Eye",
    title: "Full visibility",
    description:
      "Inspect exactly what your agent learned and trace each memory back to the threads that shaped it. Review the stored context instead of treating memory like a black box.",
  },
] as const satisfies ReadonlyArray<LockedFeatureOutlineItem>;
