"use client";
import "@copilotkit/react-ui/styles.css";
import "./style.css";

import MarkdownIt from "markdown-it";

import { diffWords } from "diff";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import {
  CopilotKit,
  useCoAgent,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

const extensions = [StarterKit];

export default function MultiAgentFlows() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      agent="multi_agent_writer"
    >
      <div
        className="min-h-screen w-full"
        style={
          {
            "--copilot-kit-primary-color": "#222",
            "--copilot-kit-separator-color": "#CCC",
          } as React.CSSProperties
        }
      >
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "AI Document Editor",
            initial: "Hi 👋 How can I help with your document?",
          }}
          clickOutsideToClose={false}
        >
          <DocumentEditor />
        </CopilotSidebar>
      </div>
    </CopilotKit>
  );
}

interface AgentState {
  document: string;
}

const DocumentEditor = () => {
  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "min-h-screen p-10" },
    },
  });
  const [placeholderVisible, setPlaceholderVisible] = useState(false);
  const [currentDocument, setCurrentDocument] = useState("");
  const { isLoading } = useCopilotChat();
  const [agentState, setAgentState] = useState<AgentState>({
    document: "",
  });

  const [currentAgent, setCurrentAgent] = useState<
    "multi_agent_writer" | "multi_agent_researcher" | "multi_agent_critic"
  >("multi_agent_writer");

  const { nodeName: writerNodeName, start: startWriter } =
    useCoAgent<AgentState>({
      name: "multi_agent_writer",
      initialState: {
        document: "",
      },
      state: agentState,
      setState: setAgentState,
    });

  const { nodeName: researcherNodeName, start: startResearcher } =
    useCoAgent<AgentState>({
      name: "multi_agent_researcher",
      initialState: {
        document: "",
      },
      state: agentState,
      setState: setAgentState,
    });

  const { nodeName: criticNodeName, start: startCritic } =
    useCoAgent<AgentState>({
      name: "multi_agent_critic",
      initialState: {
        document: "",
      },
      state: agentState,
      setState: setAgentState,
    });

  useEffect(() => {
    if (isLoading) {
      setCurrentDocument(editor?.getText() || "");
    }
    editor?.setEditable(!isLoading);
  }, [isLoading, editor]);

  let nodeName = writerNodeName;
  if (currentAgent === "multi_agent_researcher") {
    nodeName = researcherNodeName;
  } else if (currentAgent === "multi_agent_critic") {
    nodeName = criticNodeName;
  }

  useEffect(() => {
    if (nodeName == "end") {
      // set the text one final time when loading is done
      if (
        currentDocument.trim().length > 0 &&
        currentDocument !== agentState?.document
      ) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument, true);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      }
    }
  }, [nodeName, agentState?.document, currentDocument, editor?.commands]);

  useEffect(() => {
    if (isLoading) {
      if (currentDocument.trim().length > 0) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      } else {
        const markdown = fromMarkdown(agentState?.document || "");
        editor?.commands.setContent(markdown);
      }
    }
  }, [agentState?.document, currentDocument, editor?.commands, isLoading]);

  const text = editor?.getText() || "";

  useEffect(() => {
    setPlaceholderVisible(text.length === 0);

    if (!isLoading) {
      setCurrentDocument(text);
      setAgentState({
        document: text,
      });
    }
  }, [text, setAgentState, isLoading]);

  useCopilotAction({
    name: "confirm_changes",
    renderAndWaitForResponse: ({ args, respond, status }) => {
      return <ConfirmChanges 
        args={args} 
        respond={respond} 
        status={status} 
        onReject={() => {
          editor?.commands.setContent(fromMarkdown(currentDocument));
          setAgentState({
            document: currentDocument,
          });
        }} 
        onConfirm={() => {
          editor?.commands.setContent(fromMarkdown(agentState?.document || ""));
          setAgentState({
            document: agentState?.document || "",
          });
        }} />;
    },
  });

  return (
    <div className="relative min-h-screen w-full">
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 border border-gray-300 z-10 rounded-full overflow-hidden">
        <button
          className={`py-1 px-3 text-sm ${
            currentAgent === "multi_agent_writer"
              ? "bg-slate-700 text-white border-slate-700"
              : "bg-white text-black border-gray-300"
          } cursor-pointer rounded-l-full border`}
          onClick={() => {
            setCurrentAgent("multi_agent_writer");
            startWriter();
          }}
        >
          Writer
        </button>
        <button
          className={`py-1 px-3 text-sm ${
            currentAgent === "multi_agent_researcher"
              ? "bg-slate-700 text-white border-slate-700"
              : "bg-white text-black border-gray-300"
          } cursor-pointer border`}
          onClick={() => {
            setCurrentAgent("multi_agent_researcher");
            startResearcher();
          }}
        >
          Researcher
        </button>
        <button
          className={`py-1 px-3 text-sm ${
            currentAgent === "multi_agent_critic"
              ? "bg-slate-700 text-white border-slate-700"
              : "bg-white text-black border-gray-300"
          } cursor-pointer rounded-r-full border`}
          onClick={() => {
            setCurrentAgent("multi_agent_critic");
            startCritic();
          }}
        >
          Critic
        </button>
      </div>
      {placeholderVisible && (
        <div className="absolute top-6 left-6 m-4 pointer-events-none text-gray-400">
          Your content goes here...
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};



interface ConfirmChangesProps {
  args: any;
  respond: any;
  status: any;
  onReject: () => void;
  onConfirm: () => void;
}

function ConfirmChanges({ args, respond, status, onReject, onConfirm }: ConfirmChangesProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <div className="bg-white p-6 rounded shadow-lg border border-gray-200 mt-5 mb-5">
      <h2 className="text-lg font-bold mb-4">Confirm Changes</h2>
      <p className="mb-6">Do you want to accept the changes?</p>
      {accepted === null && (
        <div className="flex justify-end space-x-4">
          <button
            className={`bg-gray-200 text-black py-2 px-4 rounded disabled:opacity-50 ${
              status === "executing" ? "cursor-pointer" : "cursor-default"
            }`}
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(false);
                onReject();
                respond({ accepted: false });
              }
            }}
          >
            Reject
          </button>
          <button
            className={`bg-black text-white py-2 px-4 rounded disabled:opacity-50 ${
              status === "executing" ? "cursor-pointer" : "cursor-default"
            }`}
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(true);
                onConfirm();
                respond({ accepted: true });
              }
            }}
          >
            Confirm
          </button>
        </div>
      )}
      {accepted !== null && (
        <div className="flex justify-end">
          <div className="mt-4 bg-gray-200 text-black py-2 px-4 rounded inline-block">
            {accepted ? "✓ Accepted" : "✗ Rejected"}
          </div>
        </div>
      )}
    </div>
  );
}

function fromMarkdown(text: string) {
  const md = new MarkdownIt({
    typographer: true,
    html: true,
  });

  return md.render(text);
}

function diffPartialText(
  oldText: string,
  newText: string,
  isComplete: boolean = false
) {
  let oldTextToCompare = oldText;
  if (oldText.length > newText.length && !isComplete) {
    // make oldText shorter
    oldTextToCompare = oldText.slice(0, newText.length);
  }

  const changes = diffWords(oldTextToCompare, newText);

  let result = "";
  changes.forEach((part) => {
    if (part.added) {
      result += `<em>${part.value}</em>`;
    } else if (part.removed) {
      result += `<s>${part.value}</s>`;
    } else {
      result += part.value;
    }
  });

  if (oldText.length > newText.length && !isComplete) {
    result += oldText.slice(newText.length);
  }

  return result;
}

function isAlpha(text: string) {
  return /[a-zA-Z\u00C0-\u017F]/.test(text.trim());
}
