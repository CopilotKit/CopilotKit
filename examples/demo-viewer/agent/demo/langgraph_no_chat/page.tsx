"use client";
import React, { useState, useEffect, useRef, ReactEventHandler } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCoAgent, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions } from "@/lib/prompts";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion"
import { samplePrompts } from "./samplePrompts";
import Loader from "./Loader";
import { AGENT_TYPE } from "@/config";
const AgenticChat: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl={"/api/copilotkit?langgraph=true"}
      showDevConsole={true}
      agent="no_chat"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  const { appendMessage, isLoading } = useCopilotChat();
  const [aiResponse, setAiResponse] = useState("");
  const [prompt, setPrompt] = useState("");
  const { theme } = useTheme()
  const [step, setStep] = React.useState(0);
  const [showVerticalWizard, setShowVerticalWizard] = React.useState(false);
  const [started, setStarted] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  const { nodeName, state } = useCoAgent({
    name: "no_chat",
  })

  useEffect(() => {
    console.log(state, "state", nodeName);

    if (nodeName && nodeName != "start_flow") {
      setShowVerticalWizard(true);
      // Update completed steps based on nodeName
      if (nodeName === "buffer_node") {
        setCompletedSteps([0]);
      } else if (nodeName === "confirming_response_node") {
        setCompletedSteps([0, 1]);
      } else if (nodeName === "reporting_node") {
        setCompletedSteps([0, 1, 2]);
      } else if (nodeName === "__end__") {
        setCompletedSteps([0, 1, 2, 3]);
      }
    }
  }, [nodeName]);

  // Main wizard steps
  const wizardSteps = [
    {
      title: "Step 1",
      content: `Asking the agent to start the process. <b><i>${prompt}</i></b>`
    },
    {
      title: "Step 2",
      content: "Running the <b><i>buffer_node</i></b> to extract the answer from the model."
    },
    {
      title: "Step 3",
      content: "Running the <b><i>confirming_response_node</i></b> to confirm the response from the model."
    },
    {
      title: "Step 4",
      content: "Running the <b><i>reporting_node</i></b> to generate a response and send it to the user."
    }
  ];

  useEffect(() => {
    // console.log(state.messages,"messages");

    if (!isLoading && state?.messages?.length) {
      setAiResponse(state.messages[state.messages.length - 1].content);
    }
  }, [isLoading])


  function handleExecuteProcess(): void {
    try {
      let index = Math.floor(Math.random() * samplePrompts.length)
      setPrompt(samplePrompts[index]);
      appendMessage(new TextMessage({
        role: Role.User,
        content: samplePrompts[index]
      }));
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background: theme === "dark" ? "#020817" : "#fefefe" }}
    >
      <div className="w-8/10 h-8/10 rounded-lg agent-execution-view-container" style={{ background: "#fefefe" }}>
        <div className="agent-execution-header" >
          <h2 style={{ color: "#000" }}>No Chat Example</h2>
        </div>
        <div className={`agent-execution-body`} style={{ position: "relative", overflow: "hidden" }}>
          <AnimatePresence mode="wait">
            {!started ? (
              <motion.div
                key="intro"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.5 }}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#f9fafb",
                  borderRadius: 16,
                  boxShadow: "0 4px 24px 0 rgba(30,41,59,0.08)",
                  padding: 48,
                  flexDirection: "column",
                  minHeight: 400,
                }}
              >
                <div style={{ textAlign: "center", maxWidth: 480 }}>
                  <div style={{ fontSize: 48, marginBottom: 16, color: "#10b981" }}>🤖</div>
                  <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
                    Welcome to the Agent Process Wizard
                  </h2>
                  <p style={{ fontSize: 18, color: "#334155", marginBottom: 32 }}>
                    This wizard will guide you through the process of interacting with the AI agent. Click the button below to get started!
                  </p>
                  <button
                    className="agent-execute-button"
                    style={{
                      fontSize: 18,
                      padding: "14px 36px",
                      borderRadius: 8,
                      background: "#10b981",
                      color: "#fff",
                      fontWeight: 600,
                      border: "none",
                      boxShadow: "0 2px 8px 0 rgba(16,185,129,0.08)",
                      cursor: "pointer",
                      transition: "background 0.2s"
                    }}
                    onClick={() => {
                      setStarted(true);
                      setShowVerticalWizard(true);
                      setTimeout(() => handleExecuteProcess(), 400); // delay to allow animation
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? "Processing..." : "Start Agent Process"}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="wizard"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.5 }}
                style={{ width: "100%", height: "100%" }}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key="vertical-wizard"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -40 }}
                    transition={{ duration: 0.5 }}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <div
                      style={{
                        background: "#fefefe",
                        borderRadius: 12,
                        boxShadow: "0 4px 24px 0 rgba(30,41,59,0.08)",
                        padding: 32,
                        minHeight: 800,
                        width: "100%",
                        display: "flex",
                        flexDirection: "row",
                        gap: 48,
                        alignItems: "flex-start",
                        justifyContent: "flex-start",
                      }}
                    >
                      <div style={{ flex: 2 }}>
                        {wizardSteps.map((stepObj, idx) => {
                          // Determine step status
                          const isCompleted = completedSteps.includes(idx);
                          const isCurrent = !isCompleted && (completedSteps.length === idx);
                          return (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                position: "relative",
                                minHeight: 56,
                                marginBottom: idx < wizardSteps.length - 1 ? 0 : 0,
                                paddingBottom: idx < wizardSteps.length - 1 ? 48 : 0,
                              }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 48, position: "relative" }}>
                                <div
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: "50%",
                                    background: isCompleted ? "#10b981" : isCurrent ? "#cbd5e1" : "#cbd5e1",
                                    color: isCompleted ? "#fff" : "#64748b",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 700,
                                    fontSize: 18,
                                    zIndex: 2,
                                    boxShadow: "0 2px 8px 0 rgba(16,185,129,0.08)",
                                    transition: "background 0.3s ease, color 0.3s ease",
                                  }}
                                >
                                  {isCompleted ? (
                                    idx + 1
                                  ) : isCurrent ? (
                                    <div style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      <Loader />
                                    </div>
                                  ) : (
                                    idx + 1
                                  )}
                                </div>
                                {idx < wizardSteps.length - 1 && (
                                  <div
                                    style={{
                                      width: 4,
                                      flex: 1,
                                      background: isCompleted ? "#10b981" : "#cbd5e1",
                                      minHeight: 48,
                                      marginTop: 0,
                                      transition: "background 0.3s ease",
                                    }}
                                  />
                                )}
                              </div>
                              <div style={{ marginLeft: 32, flex: 1 }}>
                                <h2 style={{ fontSize: 20, marginBottom: 4, fontWeight: 700 }}>
                                  {stepObj.title}
                                </h2>
                                <p style={{ fontSize: 16, marginBottom: 0 }} dangerouslySetInnerHTML={{ __html: stepObj.content }}>
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 350,
                          maxWidth: 420,
                          background: "#fff",
                          borderRadius: 16,
                          boxShadow: "0 2px 16px 0 rgba(30,41,59,0.10)",
                          padding: 32,
                          marginLeft: 24,
                          minHeight: 400,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          justifyContent: "flex-start",
                        }}
                      >
                        <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>AI Response</h3>
                        <div style={{ color: "#334155", fontSize: 16 }}>
                          {aiResponse}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
                {showVerticalWizard && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 40,
                      display: "flex",
                      justifyContent: "center",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  >
                    <button
                      disabled={isLoading}
                      style={{
                        background: "#0ea5e9",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "7px 24px",
                        fontSize: 18,
                        cursor: "pointer",
                        fontWeight: 600,
                        pointerEvents: "auto",
                      }}
                      onClick={() => {
                        setCompletedSteps([])
                        setStarted(false);
                        setAiResponse("");
                        setShowVerticalWizard(false);
                        setStep(0);
                      }}
                    >
                      Back to Start
                    </button>
                  </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </div>
    </div >
  );
};

export default AgenticChat;
