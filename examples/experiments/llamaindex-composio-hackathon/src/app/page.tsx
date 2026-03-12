"use client";

import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotChat, CopilotPopup, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { useRef, useState } from "react";
import type React from "react";
import AppChatHeader, { PopupHeader } from "@/components/canvas/AppChatHeader";
import { Menu } from "lucide-react"
import { cn } from "@/lib/utils";
import { diffWords } from "diff";
import type { AgentState } from "@/lib/canvas/types";
import { initialState } from "@/lib/canvas/state";
import useMediaQuery from "@/hooks/use-media-query";
import MarkdownEditor from "@/components/MarkdownEditor";
import { AngleSelector } from "@/components/canvas/AngleSelector";
import { ConfirmChanges } from "@/components/canvas/ConfirmChanges";
import LeftSidebar from "@/components/canvas/LeftSidebar";

export default function CopilotKitPage() {
  const { state, setState } = useCoAgent<AgentState>({
    name: "story_agent",
    initialState,
  });

  // Global cache for the last non-empty agent state
  const cachedStateRef = useRef<AgentState>(state ?? initialState);

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [bufferDocument, setBufferDocument] = useState("");



  useCopilotAction({
    name: "selectAngle",
    description: "Select an angle for the story",
    parameters: [{
      name: "angles",
      type: "string[]",
      description: "A list of angles from which user can select"
    }],
    renderAndWaitForResponse: ({ args, respond }) => <AngleSelector args={args} respond={respond} />
  })

  useCopilotAction({
    name: "generateStoryAndConfirm",
    description: "Generate a story and confirm it",
    parameters: [
      {
        name: "story",
        type: "string",
        description: "The story that is generated. Strictly markdown format."
      },
      {
        name: "title",
        type: "string",
        description: "The title of the story"
      },
      {
        name: "description",
        type: "string",
        description: "The description of the story"
      }
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => <ConfirmChanges
      args={args}
      setCurrentDocument={setState}
      respond={respond}
      status={status}
      currentDocument={state.story}
      onReject={function (): void {
        console.log(bufferDocument, "bufferDocumentbufferDocumentbufferDocumentbufferDocument");
        debugger
        setState({ ...state, story: bufferDocument });
      }}
      onConfirm={function (): void {
        debugger
        setState({ story: args?.story ?? "", title: args?.title ?? "", description: args?.description ?? "" })
        // setCurrentDocument(bufferDocument);
        // setBufferDocument(args?.story ?? "");
        // throw new Error("Function not implemented.");
      }}

    />
  })

  useCopilotChatSuggestions({
    instructions: "Generate suggestions for the user like 'Generate a story from the latest posts from r/openai or r/oneplus or r/google', etc. If the story is generated, provide suggestions like to update the story."
  })












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


  return (
    <div
      style={{ "--copilot-kit-primary-color": "#2563eb" } as CopilotKitCSSProperties}
      className="h-screen flex flex-col"
    >
      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden gap-3 md:gap-4 lg:gap-10">
        {/* Fixed Left Sidebar */}
        <LeftSidebar />
        {/* Main Content */}
        <main className="relative flex flex-1 h-full min-h-0">
          <div ref={scrollAreaRef} className="relative overflow-auto size-full min-h-0 px-4 sm:px-8 md:px-10 py-4">
            <div className={cn(
              "relative mx-auto max-w-7xl h-full min-h-8 flex flex-col",
            )}>
              <div className="flex-1">
                <MarkdownEditor mdContent={state.story} initialContent={""} className="mx-auto max-w-5xl h-full" setMdContent={setState} setBufferDocument={setBufferDocument} />
              </div>
            </div>
          </div>
        </main>
        {/* Chat Sidebar (Right) */}
        <aside className="max-md:hidden flex flex-col min-w-80 w-[30vw] max-w-120 p-4 pl-0">
          <div className="h-full flex flex-col align-start w-full shadow-lg rounded-2xl border border-sidebar-border overflow-hidden">
            <AppChatHeader />
            {isDesktop && (
              <CopilotChat
                className="flex-1 overflow-auto w-full"
                labels={{
                  title: "Agent",
                  initial: "👋 Hi!! I am Frankie, a story generator agent. I can help you to generate stories based on your needs. \n\nAdded to that, I can pull posts from subreddits and generate stories based on them.",
                }}
              />
            )}
          </div>
        </aside>
      </div>
      {/* Mobile: Conversations Drawer and Hamburger */}
      <div className="md:hidden">
        <button
          type="button"
          aria-label="Open conversations"
          className="fixed z-40 left-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-card text-foreground shadow-sm"
          onClick={() => setMobileDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Drawer Overlay */}
        <div
          className={cn(
            "fixed inset-0 z-50 transition-opacity",
            mobileDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => setMobileDrawerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
        </div>


        {/* Mobile Chat Popup - conditionally rendered to avoid duplicate rendering */}
        {!isDesktop && (
          <CopilotPopup
            Header={PopupHeader}
            labels={{
              title: "Agent",
              initial: "👋 Hi!! I am Frankie, a story generator agent. I can help you to generate stories based on your needs. \n\nAdded to that, I can pull posts from subreddits and generate stories based on them.",
            }}
          />
        )}
      </div>
    </div>
  );
}



