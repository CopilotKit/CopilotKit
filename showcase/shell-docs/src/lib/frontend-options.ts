export type FrontendId = "react" | "vue" | "react-native" | "slack" | "teams";

export type FrontendIcon = FrontendId;

export interface FrontendOption {
  id: FrontendId;
  name: string;
  icon: FrontendIcon;
  summary: string;
}

export const FRONTEND_OPTIONS: readonly FrontendOption[] = [
  {
    id: "react",
    name: "React",
    icon: "react",
    summary: "The complete CopilotKit docs experience.",
  },
  {
    id: "vue",
    name: "Vue",
    icon: "vue",
    summary: "Vue 3 provider, composables, and chat primitives.",
  },
  {
    id: "react-native",
    name: "React Native",
    icon: "react-native",
    summary: "Mobile bindings for React Native and Expo apps.",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "slack",
    summary: "Slack bot quickstart with streaming agent replies.",
  },
  {
    id: "teams",
    name: "Teams",
    icon: "teams",
    summary: "Microsoft Teams bot quickstart and local DevTools setup.",
  },
] as const;

const FRONTEND_IDS = new Set<string>(
  FRONTEND_OPTIONS.map((option) => option.id),
);

export function isFrontendId(value: string | undefined): value is FrontendId {
  return value !== undefined && FRONTEND_IDS.has(value);
}

export function getFrontendOption(id: FrontendId): FrontendOption {
  return FRONTEND_OPTIONS.find((option) => option.id === id)!;
}

export function frontendPathFor(id: FrontendId): string {
  return id === "react" ? "/" : `/frontends/${id}`;
}

export function frontendFromPathname(pathname: string): FrontendId | null {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (first !== "frontends") return null;
  if (!isFrontendId(second) || second === "react") return null;
  return second;
}
