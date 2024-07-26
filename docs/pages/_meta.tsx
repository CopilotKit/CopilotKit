import { SideNavTitleWithIcon } from "../components/sidenav/sidenav-title-with-icon";
import { RiChat3Line, RiServerLine } from "react-icons/ri";
import { BsTextareaT } from "react-icons/bs";
import { PiFunction } from "react-icons/pi";
import { LuZap } from "react-icons/lu";

export default {
  "___getting-started": {
    type: "separator",
    title: "Getting Started",
  },
  "what-is-copilotkit": {
    title: "What is CopilotKit?",
  },
  "quickstart-chatbot": {
    title: "Quickstart: Chatbot",
  },
  "tutorial-ai-todo-list-copilot": {
    title: "Tutorial: AI Todo List Copilot",
  },
  "reference": {
    title: <span className="nested-title">Reference</span>,
    type: "doc",
  },
  "reference/hooks": {
    title: "Hooks",
    type: "page",
  },
  "___contributing": {
    type: "separator",
    title: "Contributing",
  },
  "code-contributions": {
    title: "Code Contributions",
  },
  "documentation-contributions": {
    title: "Documentation Contributions",
  },
  "___extras": {
    type: "separator",
    title: "Extras",
  },
  "anonymous-telemetry": {
    title: "Anonymous Telemetry",
  },
};
