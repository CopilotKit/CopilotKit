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
import { CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt } from "@/lib/prompts";
const extensions = [StarterKit];

export default function PredictiveStateUpdates() {

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole={false}
    // agent="predictive_state_updates"
    >
      <div
        className="min-h-screen w-full"
        style={
          {
            // "--copilot-kit-primary-color": "#222",
            // "--copilot-kit-separator-color": "#CCC",
          } as React.CSSProperties
        }
      >
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "AI Document Editor",
            initial: initialPrompt.predictiveStateUpdates,
          }}
          // instructions="You are an AI Document Editor. You can write and edit documents. You can also confirm or reject changes. 
          //               When you create or edit documents. Make sure to always call the confirm_changes action to confirm the changes. 
          //               When accepted or rejected, the document should be updated accordingly."
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

  // const {
  //   state: agentState,
  //   setState: setAgentState,
  //   nodeName,
  // } = useCoAgent<AgentState>({
  //   name: "predictive_state_updates",
  //   initialState: {
  //     document: "",
  //   },
  // });

  // useEffect(() => {
  //   if (isLoading) {
  //     setCurrentDocument(editor?.getText() || "");
  //   }
  //   editor?.setEditable(!isLoading);
  // }, [isLoading]);

  // useEffect(() => {
  //   if (nodeName == "end") {
  //     // set the text one final time when loading is done
  //     if (
  //       currentDocument.trim().length > 0 &&
  //       currentDocument !== agentState?.document
  //     ) {
  //       const newDocument = agentState?.document || "";
  //       const diff = diffPartialText(currentDocument, newDocument, true);
  //       const markdown = fromMarkdown(diff);
  //       editor?.commands.setContent(markdown);
  //     }
  //   }
  // }, [nodeName]);

  // useEffect(() => {
  //   if (isLoading) {
  //     if (currentDocument.trim().length > 0) {
  //       const newDocument = agentState?.document || "";
  //       const diff = diffPartialText(currentDocument, newDocument);
  //       const markdown = fromMarkdown(diff);
  //       editor?.commands.setContent(markdown);
  //     } else {
  //       const markdown = fromMarkdown(agentState?.document || "");
  //       editor?.commands.setContent(markdown);
  //     }
  //   }
  // }, [agentState?.document]);

  const text = editor?.getText() || "";

  // useEffect(() => {
  //   setPlaceholderVisible(text.length === 0);

  //   if (!isLoading) {
  //     setCurrentDocument(text);
  //     setAgentState({
  //       document: text,
  //     });
  //   }
  // }, [text]);

  const chat = useCopilotChat();

  // useEffect(() => {
  //   debugger
  //   let actionMessage = chat.visibleMessages.reverse().find(m => m.isActionExecutionMessage());
  //   if (actionMessage) {
  //     console.log(actionMessage);
  //     editor?.commands.setContent(fromMarkdown(actionMessage?.args?.document || ""));
  //   }
  // }, [chat]);

  useCopilotAction({
    name: "write_document",
    description: `
      Write a document. Use markdown formatting to format the document.
      It's good to format the document extensively so it's easy to read.
      You can use all kinds of markdown.
      However, do not use italic or strike-through formatting, it's reserved for another purpose.
      You MUST write the full document, even when changing only a few words.
      When making edits to the document, try to make them minimal - do not change every word.
      Keep stories SHORT!
      `,
    parameters: [
      {
        type: "string",
        name: "document",
      }
    ],
    handler: async ({ document }) => {
      setCurrentDocument(document);
      if(currentDocument == ""){
        editor?.commands.setContent(fromMarkdown(document));
        return
      }
      let diff = diffPartialText(currentDocument,document)
      editor?.commands.setContent(fromMarkdown(diff));
    }
  })


  useCopilotAction({
    name: "confirm_changes",
    description: "Confirm or reject the changes to the document.",
    available : "frontend",
    parameters: [],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      return (<ConfirmChanges
        args={args}
        respond={respond}
        status={status}
        onReject={() => {
          editor?.commands.setContent(fromMarkdown(currentDocument));
          // setAgentState({ document: currentDocument });
        }}
        onConfirm={() => {
          editor?.commands.setContent(fromMarkdown(args.document || ""));
          // setCurrentDocument(agentState?.document || "");
          // setAgentState({ document: agentState?.document || "", });
        }}
      />)
    },
    

  })
  useCopilotChatSuggestions({
    instructions: chatSuggestions.predictiveStateUpdates,
  })
  return (
    <div className="relative min-h-screen w-full">
      {placeholderVisible && (
        <div className="absolute top-6 left-6 m-4 pointer-events-none text-gray-400">
          Write whatever you want here in Markdown format...
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
  console.log(status, "statusstatusstatusstatus");

  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <div className="bg-white p-6 rounded shadow-lg border border-gray-200 mt-5 mb-5">
      <h2 className="text-lg font-bold mb-4">Confirm Changes</h2>
      <p className="mb-6">Do you want to accept the changes?</p>
      {accepted === null && (
        <div className="flex justify-end space-x-4">
          <button
            className={`bg-gray-200 text-black py-2 px-4 rounded disabled:opacity-50 ${status === "executing" ? "cursor-pointer" : "cursor-default"
              }`}
            disabled={status !== "executing"}
            onClick={() => {
              debugger
              if (respond) {
                setAccepted(false);
                onReject();
                respond("Changes rejected");
              }
            }}
          >
            Reject
          </button>
          <button
            className={`bg-black text-white py-2 px-4 rounded disabled:opacity-50 ${status === "executing" ? "cursor-pointer" : "cursor-default"
              }`}
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(true);
                onConfirm();
                respond("Changes accepted");
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
