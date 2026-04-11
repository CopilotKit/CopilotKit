import { useAgent } from "@copilotkit/react-core/v2";
import { useCallback, useState } from "react";

export const HeadlessChat = () => {
  const { agent } = useAgent();
  const [message, setMessage] = useState("");

  const sendMessage = useCallback(
    (msg: string) => {
      agent.addMessage({
        role: "user",
        id: crypto.randomUUID(),
        content: msg,
      });
      agent.runAgent();
      setMessage("");
    },
    [agent],
  );

  return (
    <div>
      <h1>Chat</h1>
      {agent.messages.map((msg) => (
        <div key={msg.id}>
          <p>{JSON.stringify(msg.content)}</p>
        </div>
      ))}
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button onClick={() => sendMessage(message)}>Send</button>
    </div>
  );
};
