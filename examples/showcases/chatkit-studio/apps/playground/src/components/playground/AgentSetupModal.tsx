"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface AgentSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const agentPyCode = `"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from typing import Any, List
from typing_extensions import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, BaseMessage
from langchain_core.runnables import RunnableConfig
from langchain.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode

class AgentState(MessagesState):
    """
    Here we define the state of the agent
    """
    tools: List[Any]

@tool
def get_weather(location: str):
    """
    Get the weather for a given location.
    """
    return f"The weather for {location} is 70 degrees."

backend_tools = [get_weather]

# Extract tool names from backend_tools for comparison
backend_tool_names = [tool.name for tool in backend_tools]

async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
    """
    Standard chat node based on the ReAct design pattern.
    """
    # 1. Define the model
    model = ChatOpenAI(model="gpt-4o")

    # 2. Bind the tools to the model
    model_with_tools = model.bind_tools(
        [
            *state.get("tools", []),
            *backend_tools,
        ],
        parallel_tool_calls=False,
    )

    # 3. Define the system message
    system_message = SystemMessage(
        content="You are a helpful assistant."
    )

    # 4. Run the model to generate a response
    response = await model_with_tools.ainvoke([
        system_message,
        *state["messages"],
    ], config)

    # Route to tool node if needed
    if route_to_tool_node(response):
        return Command(
            goto="tool_node",
            update={"messages": [response]}
        )

    # End the graph
    return Command(
        goto=END,
        update={"messages": [response]}
    )

def route_to_tool_node(response: BaseMessage):
    """
    Route to tool node if any tool call matches a backend tool name.
    """
    tool_calls = getattr(response, "tool_calls", None)
    if not tool_calls:
        return False

    for tool_call in tool_calls:
        if tool_call.get("name") in backend_tool_names:
            return True
    return False

# Define the workflow graph
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=backend_tools))
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("chat_node")

graph = workflow.compile()`;

const requirementsTxtCode = `langchain==0.3.27
langgraph==0.6.6
langsmith==0.4.23
openai>=1.68.2,<2.0.0
fastapi>=0.115.5,<1.0.0
uvicorn>=0.29.0,<1.0.0
python-dotenv>=1.0.0,<2.0.0
langgraph-cli[inmem]==0.3.3
langchain-openai>=0.0.1`;

const langgraphJsonCode = `{
  "python_version": "3.12",
  "dockerfile_lines": [],
  "dependencies": ["."],
  "graphs": {
    "sample_agent": "./agent.py:graph"
  },
  "env": ".env"
}`;

const envCode = `OPENAI_API_KEY=your_openai_api_key_here`;

export function AgentSetupModal({ isOpen, onClose }: AgentSetupModalProps) {
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("agent");

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedItems((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setCopiedItems((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
        <DialogOverlay className="bg-black/20" />
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 bg-white/50 backdrop-blur-sm border-2 border-white">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-palette-border-container">
            <DialogTitle className="text-xl text-palette-text-primary">
              Agent Endpoint Setup
            </DialogTitle>
            <DialogDescription className="text-xs text-palette-text-secondary">
              Learn how to set up your agent endpoint URL
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto">
            {/* Main Paths */}
            <Accordion type="multiple" defaultValue={["new-agent"]} className="mx-6 mt-4">
          {/* Path 1: Already have an agent */}
          <AccordionItem
            value="existing-agent"
            className="border border-palette-border-container rounded-lg px-4 bg-palette-lilac-40010"
          >
            <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3 text-palette-text-primary">
              ✅ I already have an agent
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="space-y-3">
                <p className="text-xs text-palette-text-secondary leading-relaxed">
                  If you already have a LangGraph agent running, simply use its URL:
                </p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-palette-text-primary mt-0.5">
                      •
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-secondary">
                        <span className="font-semibold">Local development:</span> Use{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          http://localhost:PORT
                        </code>{" "}
                        (e.g., http://localhost:8123)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-palette-text-primary mt-0.5">
                      •
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-secondary">
                        <span className="font-semibold">Deployed agent:</span> Use your
                        deployment URL (e.g., https://your-agent.example.com)
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-900 font-medium">
                    💡 Make sure your agent is running before testing the chat interface!
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Path 2: Need to set up an agent */}
          <AccordionItem
            value="new-agent"
            className="border border-palette-border-container rounded-lg px-4 mt-2 bg-palette-lilac-40010"
          >
            <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3 text-palette-text-primary">
              🚀 I need to set up an agent (2 min setup)
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="space-y-3">
                <p className="text-xs text-palette-text-secondary leading-relaxed mb-3">
                  Follow these steps to create a simple LangGraph agent:
                </p>

                {/* Step-by-step instructions */}
                <div className="space-y-2.5">
                  {/* Step 1 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      1
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Create project structure
                      </p>
                      <p className="text-xs text-palette-text-secondary mb-2">
                        Create an{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          agent/
                        </code>{" "}
                        folder in your project root
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      2
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Add configuration files
                      </p>
                      <p className="text-xs text-palette-text-secondary mb-2">
                        Copy the files from the tabs below into your{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          agent/
                        </code>{" "}
                        folder
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      3
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Install dependencies
                      </p>
                      <div className="relative mt-2">
                        <pre className="bg-white/50 border border-palette-border-container px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto pr-16">
                          <code>cd agent && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt</code>
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCopy(
                              "cd agent && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt",
                              "install-deps"
                            )
                          }
                          className="absolute top-2 right-2 h-6 text-xs px-2"
                        >
                          {copiedItems.has("install-deps") ? "✓" : "Copy"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      4
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Set up environment variables
                      </p>
                      <p className="text-xs text-palette-text-secondary mb-2">
                        Create a{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          .env
                        </code>{" "}
                        file in the{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          agent/
                        </code>{" "}
                        folder with your OpenAI API key
                      </p>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      5
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Run your agent
                      </p>
                      <div className="relative mt-2">
                        <pre className="bg-white/50 border border-palette-border-container px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto pr-16">
                          <code>npx @langchain/langgraph-cli dev --port 8123</code>
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCopy(
                              "npx @langchain/langgraph-cli dev --port 8123",
                              "run-agent"
                            )
                          }
                          className="absolute top-2 right-2 h-6 text-xs px-2"
                        >
                          {copiedItems.has("run-agent") ? "✓" : "Copy"}
                        </Button>
                      </div>
                      <p className="text-xs text-palette-text-secondary mt-2">
                        Or add to your{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          package.json
                        </code>
                        :
                      </p>
                      <div className="relative mt-2">
                        <pre className="bg-white/50 border border-palette-border-container px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto pr-16">
                          <code>{`"dev:agent": "cd agent && npx @langchain/langgraph-cli dev --port 8123 --no-browser"`}</code>
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCopy(
                              `"dev:agent": "cd agent && npx @langchain/langgraph-cli dev --port 8123 --no-browser"`,
                              "npm-script"
                            )
                          }
                          className="absolute top-2 right-2 h-6 text-xs px-2"
                        >
                          {copiedItems.has("npm-script") ? "✓" : "Copy"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Step 6 */}
                  <div className="flex items-start gap-2">
                    <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      6
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-palette-text-primary font-semibold mb-1">
                        Use the agent URL
                      </p>
                      <p className="text-xs text-palette-text-secondary">
                        Enter{" "}
                        <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                          http://localhost:8123
                        </code>{" "}
                        in the Agent Endpoint field above
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-xs text-green-900 font-medium">
                    ✨ That&apos;s it! Your agent should now be running and ready to use.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* File Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col px-6 pb-6 pt-4 overflow-hidden"
        >
          <div className="mb-2">
            <p className="text-xs text-palette-text-secondary">
              📁 Files to create in your{" "}
              <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs font-mono">
                agent/
              </code>{" "}
              folder:
            </p>
          </div>
          <TabsList className="w-full justify-start h-9">
            <TabsTrigger value="agent" className="text-xs">
              agent.py
            </TabsTrigger>
            <TabsTrigger value="requirements" className="text-xs">
              requirements.txt
            </TabsTrigger>
            <TabsTrigger value="langgraph" className="text-xs">
              langgraph.json
            </TabsTrigger>
            <TabsTrigger value="env" className="text-xs">
              .env
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agent" className="flex-1 mt-3 overflow-auto">
            <div className="relative">
              <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{agentPyCode}</code>
              </pre>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleCopy(agentPyCode, "agent")}
                className="absolute top-3 right-3 h-7 text-xs"
              >
                {copiedItems.has("agent") ? "✓ Copied!" : "Copy"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="requirements" className="flex-1 mt-3 overflow-auto">
            <div className="relative">
              <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{requirementsTxtCode}</code>
              </pre>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleCopy(requirementsTxtCode, "requirements")}
                className="absolute top-3 right-3 h-7 text-xs"
              >
                {copiedItems.has("requirements") ? "✓ Copied!" : "Copy"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="langgraph" className="flex-1 mt-3 overflow-auto">
            <div className="relative">
              <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{langgraphJsonCode}</code>
              </pre>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleCopy(langgraphJsonCode, "langgraph")}
                className="absolute top-3 right-3 h-7 text-xs"
              >
                {copiedItems.has("langgraph") ? "✓ Copied!" : "Copy"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="env" className="flex-1 mt-3 overflow-auto">
            <div className="relative">
              <pre className="bg-white/50 border border-palette-border-container text-palette-text-primary p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{envCode}</code>
              </pre>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleCopy(envCode, "env")}
                className="absolute top-3 right-3 h-7 text-xs"
              >
                {copiedItems.has("env") ? "✓ Copied!" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-palette-text-secondary mt-2">
              Get your OpenAI API key from{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://platform.openai.com/api-keys
              </a>
            </p>
          </TabsContent>
        </Tabs>
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
