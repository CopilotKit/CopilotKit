import { LinkToCopilotCloud } from "@/components";

export default {
  "copilot-cloud": {
    title: (
      <LinkToCopilotCloud asLink={false} className="disable-menu bg-indigo-500 py-1 px-4 text-white font-medium rounded-full" />
    ),
    type: "menu",
  },
  "___getting-started": {
    type: "separator",
    title: "Getting Started",
  },
  "what-is-copilotkit": {
    title: "What is CopilotKit?",
  },
  "quickstart-chatbot": {
    title: "Quickstart: Chatbot",
    theme: {
      toc: false
    },
  },
  "tutorial-ai-todo-list-copilot": {
    title: "Tutorial: Todo List Copilot",
  },
  "tutorial-textarea": {
    title: "Tutorial: Textarea Autocomplete",
  },
  concepts: {
    title: <span className="nested-title">Concepts</span>,
    type: "doc",
  },
  reference: {
    title: <span className="nested-title">Reference</span>,
    type: "doc",
  },
  ___contributing: {
    type: "separator",
    title: "Contributing",
  },
  "code-contributions": {
    title: "Code Contributions",
  },
  "documentation-contributions": {
    title: "Documentation Contributions",
  },
  ___extras: {
    type: "separator",
    title: "Extras",
  },
  "anonymous-telemetry": {
    title: "Anonymous Telemetry",
  },
};
