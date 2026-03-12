import * as readline from "readline";
import { weatherAgent } from "@/mastra/agents";
import { MastraAgent } from "@ag-ui/mastra"
import { randomUUID } from "node:crypto";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function chatLoop() {
  console.log("🤖 AG-UI chat started! Type your messages and press Enter. Press Ctrl+D to quit.\n");

  const agent = new MastraAgent({
    agent: weatherAgent,
  });

  return new Promise<void>((resolve) => {
    const promptUser = () => {
      rl.question("> ", async (input) => {
        if (input.trim() === "") {
          promptUser();
          return;
        }
        console.log("");

        rl.pause();

        agent.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.trim(),
        });

        try {
          await agent.runAgent(
            {},
            {
              onTextMessageStartEvent() {
                process.stdout.write("🤖 AG-UI assistant: ");
              },
              onTextMessageContentEvent({ event }) {
                process.stdout.write(event.delta);
              },
              onTextMessageEndEvent() {
                console.log("\n");
              },
              onToolCallStartEvent({ event }) {
                console.log("🔧 Tool call:", event.toolCallName);
              },
              onToolCallArgsEvent({ event }) {
                process.stdout.write(event.delta);
              },
              onToolCallEndEvent() {
                console.log("");
              },
              onToolCallResultEvent({ event }) {
                if (event.content) {
                  console.log("\n🔍 Tool call result:", event.content);
                }
              },
            },
          );
        } catch (error) {
          console.error("❌ Error running agent:", error);
        }

        rl.resume();
        promptUser();
      });
    };

    rl.on("close", () => {
      console.log("\n👋 Goodbye!");
      resolve();
    });

    promptUser();
  });
}

async function main() {
  await chatLoop();
}

main().catch(console.error);
