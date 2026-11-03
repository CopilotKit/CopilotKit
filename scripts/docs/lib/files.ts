import type { ReferenceDocConfiguration } from "./reference-doc";

export const REFERENCE_DOCS: ReferenceDocConfiguration[] = [
  /* SDKs */

  {
    sourcePath: "sdk-python/copilotkit/langgraph.py",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/python/LangGraph.mdx",
    title: "LangGraph SDK",
    description:
      "The CopilotKit LangGraph SDK for Python allows you to build and run LangGraph workflows with CopilotKit.",
    pythonSymbols: [
      "copilotkit_customize_config",
      "copilotkit_exit",
      "copilotkit_emit_state",
      "copilotkit_emit_message",
      "copilotkit_emit_tool_call",
    ],
  },
  {
    sourcePath: "sdk-python/copilotkit/crewai/crewai_sdk.py",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/python/CrewAI.mdx",
    title: "CrewAI SDK",
    description:
      "The CopilotKit CrewAI SDK for Python allows you to build and run CrewAI agents with CopilotKit.",
    pythonSymbols: [
      "copilotkit_emit_state",
      "copilotkit_predict_state",
      "copilotkit_exit",
      "copilotkit_emit_message",
      "copilotkit_emit_tool_call",
    ],
  },

  /* Agents */
  {
    sourcePath: "sdk-python/copilotkit/langgraph_agui_agent.py",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/python/LangGraphAGUIAgent.mdx",
    title: "LangGraphAGUIAgent",
    description:
      "LangGraphAGUIAgent lets you define your agent for use with CopilotKit.",
    pythonSymbols: ["LangGraphAGUIAgent", "CopilotKitConfig"],
  },
  {
    sourcePath: "sdk-python/copilotkit/crewai/crewai_agent.py",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/python/CrewAIAgent.mdx",
    title: "CrewAIAgent",
    description:
      "CrewAIAgent lets you define your agent for use with CopilotKit.",
    pythonSymbols: ["CrewAIAgent", "CopilotKitConfig"],
  },
  {
    sourcePath: "sdk-python/copilotkit/sdk.py",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/python/RemoteEndpoints.mdx",
    title: "Remote Endpoints",
    description:
      "CopilotKit Remote Endpoints allow you to connect actions and agents written in Python to your CopilotKit application.",
    pythonSymbols: ["CopilotKitRemoteEndpoint", "CopilotKitContext"],
  },
  {
    sourcePath: "packages/sdk-js/src/langgraph/index.ts",
    destinationPath:
      "showcase/shell-docs/src/content/reference/v1/sdk/js/LangGraph.mdx",
    title: "LangGraph SDK",
    description:
      "The CopilotKit LangGraph SDK for JavaScript allows you to build and run LangGraph workflows with CopilotKit.",
    typescriptSymbols: [
      "copilotkitCustomizeConfig",
      "copilotkitExit",
      "copilotkitEmitState",
      "copilotkitEmitMessage",
      "copilotkitEmitToolCall",
    ],
  },
];
