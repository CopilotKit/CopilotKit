"use client";
 
import { useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import { Config } from "@/providers/Providers";

function McpServerManager({configs}:{configs:Config[]}) {
  const { setMcpServers } = useCopilotChat();
 
  useEffect(() => {
    setMcpServers(configs);
  }, [setMcpServers]);
 
  return null;
}
 
export default McpServerManager;