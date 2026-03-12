"use client";

import { BookView } from "./components/BookView";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { StoryProvider } from "./lib/StoryProvider";

export default function Home() {
  return (
    <main className="flex flex-col gap-y-10 items-center h-screen bg-stone-100">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        showDevConsole={false}
        agent="childrensBookAgent"
      >
        <StoryProvider>
          <div className="flex w-full h-full">
            <div className="flex-1 p-4">
              <BookView />
            </div>
            <div className="w-[500px] p-4">
              <div className="border h-full rounded-lg overflow-hidden shadow-xl border-1">
                <CopilotChat
                  instructions="You are an in-app copilot assisting the user in crafting a children's story. The story consists of an outline, characters, and chapters. You have access to the application state."
                  className="h-full"
                  labels={{
                    initial:
                      "Hi, welcome to Storytale AI! Let's create a story together! ✨",
                  }}
                />
              </div>
            </div>
          </div>
        </StoryProvider>
      </CopilotKit>
    </main>
  );
}
