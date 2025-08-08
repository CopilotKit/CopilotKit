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
  useHumanInTheLoop,
  useCopilotChat,
} from "@copilotkit/react-core";
import { z } from "zod";
import { CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt, instructions } from "@/lib/prompts";
const extensions = [StarterKit];

export default function PredictiveStateUpdates() {

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole = {false}
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
          instructions={instructions.predictiveStateUpdates}
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

  useHumanInTheLoop({
    name: "write_document",
    description: `Write a document. Use markdown formatting to format the document.
            It's good to format the document extensively so it's easy to read.
            You can use all kinds of markdown.
            However, do not use italic or strike-through formatting, it's reserved for another purpose.
            You MUST write the full document, even when changing only a few words.
            When making edits to the document, try to make them minimal - do not change every word.
            When you are done writing the document, provide a summary of the changes you made.
            Keep stories SHORT! If user rejects the changes, Send messages like "Would you like to re-generate the document?"`,
    parameters: z.object({
      document: z.string().describe("The document to write"),
    }),
    render: ({ args, respond, status }) => {
      console.log(args, respond, status);
      return <ConfirmChanges
        editor={editor}
        currentDocument={currentDocument}
        setCurrentDocument={setCurrentDocument}
        args={args}
        respond={respond}
        status={status}
        onReject={() => {
          if (currentDocument != "") {
            editor?.commands.setContent(fromMarkdown(currentDocument));
          }
          else {
            editor?.commands.setContent("");
          }
        }}
        onConfirm={() => {
          editor?.commands.setContent(fromMarkdown(args.document || ""));
        }}
      />;
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
  editor: any;
  currentDocument: string;
  setCurrentDocument: (document: string) => void;
}

function ConfirmChanges({ args, respond, status, onReject, onConfirm, editor, currentDocument, setCurrentDocument }: ConfirmChangesProps) {
  useEffect(() => {
    console.log(args?.document, "statusstatusstatusstatus");
    if (currentDocument == "") {
      editor?.commands.setContent(fromMarkdown(args?.document || ""));
    }
    else {
      let diff = diffPartialText(currentDocument, args?.document || "");
      editor?.commands.setContent(fromMarkdown(diff));
    }
  }, [args?.document])

  const [accepted, setAccepted] = useState<boolean | null>(null);
  if (status != 'inProgress') {
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
                  setCurrentDocument(currentDocument);
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
                debugger
                if (respond) {
                  setCurrentDocument(args?.document || "");
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
  else {
    return null;
  }
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
