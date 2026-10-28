import { FRONTENDS, FRAMEWORKS, type FrontendId } from "@/proto/data";
import { liveFramework, ROOT_FRAMEWORK, scopedHref } from "./live-scope";

export type HomeDocsStack = { frontend: FrontendId; framework: string };
export type SetupLink = { title: string; description: string; url: string };
export type CapabilityId =
  | "chat"
  | "generative-ui"
  | "frontend-tools"
  | "shared-state"
  | "human-in-the-loop"
  | "threads";
export type CapabilityLink = SetupLink & { id: CapabilityId };

function scopeFor(stack: HomeDocsStack): HomeDocsStack {
  return {
    ...stack,
    framework: liveFramework(stack.framework)
      ? stack.framework
      : ROOT_FRAMEWORK,
  };
}

/** Vue and native setup pages do not substitute the selected agent backend. */
export function getSetupLinks(stack: HomeDocsStack): SetupLink[] {
  const scope = scopeFor(stack);
  const frontend = FRONTENDS.find((item) => item.id === scope.frontend)!.name;
  const framework =
    FRAMEWORKS.find((item) => item.id === scope.framework)?.name ??
    scope.framework;

  if (scope.frontend === "vue" || scope.frontend === "react-native") {
    return [
      {
        title: `Set up ${frontend}`,
        description: `Use the ${frontend} SDK instructions for your application frontend.`,
        url: `/${scope.frontend}`,
      },
      {
        title: `Set up ${framework}`,
        description:
          "Use the agent and runtime setup from this React quickstart with your frontend guide.",
        url: scopedHref("/quickstart", { ...scope, frontend: "react" })!,
      },
    ];
  }

  const channel = scope.frontend === "slack" || scope.frontend === "teams";
  return [
    {
      title: channel ? `Connect ${frontend}` : "Open quickstart",
      description: channel
        ? `Connect your ${framework} agent to ${frontend} with CopilotKit Intelligence.`
        : `Set up ${frontend} with your ${framework} agent.`,
      url: scopedHref(channel ? "/connect" : "/quickstart", scope)!,
    },
  ];
}

const CAPABILITIES: Record<
  CapabilityId,
  { title: string; description: string; path: string }
> = {
  chat: {
    title: "Chat UI",
    description: "Add a chat interface for conversations with your agent.",
    path: "/agentic-chat-ui",
  },
  "generative-ui": {
    title: "Generative UI",
    description: "Render agent tool calls as application components.",
    path: "/generative-ui",
  },
  "frontend-tools": {
    title: "Frontend tools",
    description: "Let your agent call actions in your application.",
    path: "/frontend-tools",
  },
  "shared-state": {
    title: "Shared state",
    description: "Share state between your application and agent.",
    path: "/shared-state",
  },
  "human-in-the-loop": {
    title: "Human in the loop",
    description: "Ask users for input or approval during an agent run.",
    path: "/human-in-the-loop",
  },
  threads: {
    title: "Threads",
    description: "Create, switch, and resume conversations.",
    path: "/threads-lifecycle",
  },
};

const ANGULAR_PATHS: Record<CapabilityId, string> = {
  chat: "/guides/chat-ui",
  "generative-ui": "/guides/frontend-tools-generative-ui",
  "frontend-tools":
    "/guides/frontend-tools-generative-ui#register-a-browser-tool",
  "shared-state": "/guides/shared-state",
  "human-in-the-loop": "/guides/human-in-the-loop",
  threads:
    "/guides/threads-memory-attachments-headless#resume-a-specific-thread",
};

const NATIVE_PATHS: Record<CapabilityId, string> = {
  chat: "/reference/react-native/components/CopilotChat",
  "generative-ui": "/react-native#frontend-tools-and-generative-ui",
  "frontend-tools": "/react-native#frontend-tools-and-generative-ui",
  "shared-state": "/reference/react-native/hooks/useAgent",
  "human-in-the-loop": "/reference/react-native/hooks/useHumanInTheLoop",
  threads:
    "/reference/react-native/components/CopilotChat#headless-copilotchat",
};

const CHANNEL_CAPABILITIES: typeof CAPABILITIES = {
  chat: {
    title: "Connect your agent",
    description: "Set up your agent to receive and reply to messages.",
    path: "/connect",
  },
  "generative-ui": {
    title: "Rich messages",
    description: "Render agent responses with structured message content.",
    path: "/rich-messages",
  },
  "frontend-tools": {
    title: "Tools and context",
    description: "Give your agent tools and context from the conversation.",
    path: "/tools",
  },
  "shared-state": {
    title: "Threads and state",
    description: "Map channel conversations to agent threads and state.",
    path: "/threads-and-state",
  },
  "human-in-the-loop": {
    title: "Interactive messages",
    description: "Collect user decisions and approvals in messages.",
    path: "/interactive",
  },
  threads: {
    title: "History and transcripts",
    description: "Work with conversation history and agent transcripts.",
    path: "/history-and-transcripts",
  },
};

/** Link to authored frontend guides instead of the resolver's React fallback. */
export function getCapabilityLink(
  id: CapabilityId,
  stack: HomeDocsStack,
): CapabilityLink {
  const scope = scopeFor(stack);
  const channel = scope.frontend === "slack" || scope.frontend === "teams";
  let { title, description, path } = (
    channel ? CHANNEL_CAPABILITIES : CAPABILITIES
  )[id];

  if (scope.frontend === "angular") path = ANGULAR_PATHS[id];
  if (scope.frontend === "vue") {
    if (id === "chat") path = "/prebuilt-components/chat";
    if (id === "generative-ui") path = "/generative-ui/tool-rendering";
  }
  if (scope.frontend === "react-native") {
    path = NATIVE_PATHS[id];
    // Native supports a threadId on CopilotChat; its useThreads API is not usable yet.
    if (id === "threads") {
      title = "Conversation sessions";
      description = "Choose a conversation with a thread ID.";
    }
  }

  return { id, title, description, url: scopedHref(path, scope)! };
}

export function getCapabilityLinks(stack: HomeDocsStack): CapabilityLink[] {
  return (Object.keys(CAPABILITIES) as CapabilityId[]).map((id) =>
    getCapabilityLink(id, stack),
  );
}
