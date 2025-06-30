"use client";
import React, { useEffect, useState } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt } from "@/lib/prompts";

const AgenticChat: React.FC = () => {


  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_KEY}
      // runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole={false}
    >

      <MCPChat />
      <div
        className="flex justify-center items-center h-full w-full"
        style={{ background: "var(--copilot-kit-background-color)" }}
      >
        <div className="w-8/10 h-8/10 rounded-lg ">
          <CopilotChat
            className="h-full w-full rounded-2xl py-6"
            // labels={{ initial: initialPrompt.agenticChat }}
          />
        </div>
      </div>
    </CopilotKit>
  );
};

const MCPChat = () => {

  const { setMcpServers } = useCopilotChat();

  const [showModal, setShowModal] = useState(false);
  const [servers, setServers] = useState<{ name: string; url: string }[]>([]);
  const [form, setForm] = useState({ name: "", url: "" });
  useEffect(() => {
    setMcpServers([
      {
        endpoint: "https://mcp.composio.dev/partner/composio/reddit/mcp?customerId=a1cb648e-f32c-40b1-bb6e-288d2d670fa1"
      }
    ]);
  }, [setMcpServers]);


  const handleOpen = () => setShowModal(true);
  const handleClose = () => {
    setShowModal(false);
    setForm({ name: "", url: "" });
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServers([...servers, form]);
    handleClose();
  };
  // useCopilotChatSuggestions({
  //   instructions: chatSuggestions.agenticChat,
  //   // className : "bg-gray-100"
  // })


  return (
    <>
      {/* Top-right button */}
      <div style={{ position: "absolute", top: 24, right: 32, zIndex: 20 }}>
        <button
          onClick={handleOpen}
          style={{ background: "oklch(0.205 0 0)" }}
          className="px-4 py-2 bg-indigo-700 text-white border border-indigo-900 rounded-2xl shadow-lg hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          + Add MCP Server
        </button>
      </div>
      {/* Modal Popup */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-white bg-opacity-20 backdrop-blur-md z-50">
          <div className="bg-white p-6 rounded-lg shadow-2xl min-w-[320px] relative flex flex-col items-center">
            <button
              onClick={handleClose}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-2xl font-bold"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-lg font-semibold mb-4">Add MCP Server</h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full">
              <input
                name="name"
                placeholder="Server Name"
                value={form.name}
                onChange={handleChange}
                className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                required
              />
              <input
                name="url"
                placeholder="Server URL"
                value={form.url}
                onChange={handleChange}
                className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                required
              />
              <button
                type="submit"
                style={{ background: "oklch(0.205 0 0)" }}
                onClick={() => setMcpServers([{ endpoint: form.url }])}
                className="mt-2 px-4 py-2 bg-indigo-700 text-white border border-indigo-900 rounded hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                Add Server
              </button>
            </form>
          </div>
        </div>
      )}

    </>

  );
};

export default AgenticChat;
