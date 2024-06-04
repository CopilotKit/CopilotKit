import { MessageRole } from "./graphql/@generated/graphql";
import { CopilotRuntimeClient } from "./client/CopilotRuntimeClient";

async function main() {
  console.log("EXAMPLE USAGE");

  const client = new CopilotRuntimeClient({
    url: "http://localhost:4001/graphql",
  });

  const result = client.generateResponse({
    messages: [
      {
        role: MessageRole.User,
        content: "Hey how are you?",
      },
    ],
  });

  result.subscribe(({ data }) => {
    const { messages } = data?.generateResponse!;
    console.log("messages", messages);
  });
}

main();
