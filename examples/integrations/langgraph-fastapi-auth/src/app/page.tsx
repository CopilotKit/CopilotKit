"use client";

import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useConfigureSuggestions,
  useCopilotChatConfiguration,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { useState, useContext, useMemo, useCallback, useEffect, useRef } from "react";
import { Sun, X } from 'lucide-react';
import { z } from "zod";
import { AuthContext } from "./components/fake-auth-provider";
import { CopilotInput, FileUploadContext, type FileUpload } from "./components/copilot-input";

const AGENT_ID = "agent_with_auth";

export default function CopilotKitPage() {
  // The chat configuration provider owns the conversation thread, so the chat,
  // the shared agent state and the file uploads all use the same thread_id.
  return (
    <CopilotChatConfigurationProvider agentId={AGENT_ID}>
      <CopilotKitPageContent />
    </CopilotChatConfigurationProvider>
  );
}

function CopilotKitPageContent() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [uploadedFiles, setUploadedFiles] = useState<FileUpload[]>([]);
  const authContext = useContext(AuthContext);
  const isAuthenticated = !!authContext?.user;
  const token = authContext?.token ?? null;
  const threadId = useCopilotChatConfiguration()?.threadId;
  // Bumped for every file-list request (and on cleanup) so a slow response for a
  // previous user or thread can't overwrite the current list.
  const fileRequestGeneration = useRef(0);

  // The agent's file routes only accept signed-in users.
  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }, [token]);

  const fetchUploadedFiles = useCallback(async () => {
    const generation = ++fileRequestGeneration.current;
    if (!threadId || !token) {
      setUploadedFiles([]);
      return;
    }
    try {
      const response = await fetch(`http://localhost:8000/files/${threadId}`, { headers: authHeaders });
      if (response.ok) {
        const files = await response.json();
        if (generation === fileRequestGeneration.current) {
          setUploadedFiles(files);
        }
      }
    } catch (error) {
      console.error('Error fetching uploaded files:', error);
    }
  }, [threadId, token, authHeaders]);

  useEffect(() => {
    const fetchFiles = async () => {
      await fetchUploadedFiles();
    };
    fetchFiles();
    // Runs when the token or thread changes (and on unmount): the list belongs to
    // the previous owner, so drop it and ignore any of its in-flight responses.
    return () => {
      fileRequestGeneration.current += 1;
      setUploadedFiles([]);
    };
  }, [fetchUploadedFiles]);

  // 🪁 Frontend Tools: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
  useFrontendTool({
    name: "setThemeColor",
    description: "Set the theme color of the page.",
    parameters: z.object({
      themeColor: z.string().describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ themeColor }) => {
      setThemeColor(themeColor);
    },
  });

  useConfigureSuggestions({
    suggestions: [
      { title: "Who am I?", message: "Who am I?" },
      { title: "Set the theme to orange", message: "Set the theme to orange" },
      { title: "Write a proverb about AI", message: "Write a proverb about AI" },
      ...(isAuthenticated
        ? [{ title: "Get the weather in SF", message: "Get the weather in SF" }]
        : []),
    ],
    // Show the starter suggestions on the welcome screen only. In the chat view
    // CopilotKit renders them right under the last message, high up in the panel.
    available: "before-first-message",
  }, [isAuthenticated]);

  const fileUploadContext = useMemo(
    () => ({ uploadedFiles, fetchUploadedFiles, threadId, canUpload: isAuthenticated, authHeaders }),
    [uploadedFiles, fetchUploadedFiles, threadId, isAuthenticated, authHeaders],
  );

  return (
    <main>
      <YourMainContent themeColor={themeColor} />
      <FileUploadContext.Provider value={fileUploadContext}>
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Popup Assistant",
            welcomeMessageText: "👋 Hi there! How can I help?",
          }}
          input={CopilotInput}
        />
      </FileUploadContext.Provider>
    </main>
  );
}

// State of the agent, make sure this aligns with your agent's state.
type AgentState = {
  proverbs: string[];
}

const INITIAL_PROVERBS = [
  "CopilotKit may be new, but its the best thing since sliced bread.",
];

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/reference/v2/hooks/useAgent
  const { agent, isReady } = useAgent({ agentId: AGENT_ID });
  const state = (agent.state ?? {}) as Partial<AgentState>;
  const proverbs = state.proverbs ?? [];

  // Seed the initial shared state once the agent is connected (v1 `initialState`).
  useEffect(() => {
    if (isReady && agent.state?.proverbs === undefined) {
      agent.setState({ ...agent.state, proverbs: INITIAL_PROVERBS });
    }
  }, [agent, isReady]);

  const setProverbs = useCallback((next: string[]) => {
    agent.setState({ ...agent.state, proverbs: next });
  }, [agent]);

  // Tool handlers read the latest agent through a ref (hook deps must be serializable).
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  // 🪁 Frontend Tools: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
  useFrontendTool({
    name: "addProverb",
    description: "Add a proverb to the list of proverbs.",
    parameters: z.object({
      proverb: z.string().describe("The proverb to add. Make it witty, short and concise."),
    }),
    handler: async ({ proverb }) => {
      const current = agentRef.current;
      const proverbs = (current.state as Partial<AgentState>)?.proverbs ?? [];
      current.setState({ ...current.state, proverbs: [...proverbs, proverb] });
    },
  });

  // 🪁 Generative UI: https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool
  //    Renders the backend `get_weather` tool call in the chat.
  useRenderTool({
    name: "get_weather",
    parameters: z.object({ location: z.string() }),
    render: ({ parameters }) => (
      <WeatherCard location={parameters?.location} themeColor={themeColor} />
    ),
  }, [themeColor]);

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="min-h-screen w-full px-6 py-24 flex justify-center items-center flex-col transition-colors duration-300"
    >
      <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-white mb-2 text-center">Proverbs</h1>
        <p className="text-gray-200 text-center italic mb-6">This is a demonstrative page, but it could be anything you want! 🪁</p>
        <hr className="border-white/20 my-6" />
        <div className="flex flex-col gap-3">
          {proverbs.map((proverb, index) => (
            <div
              key={index}
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
              <button
                onClick={() => setProverbs(proverbs.filter((_, i) => i !== index))}
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity 
                  bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        {proverbs.length === 0 && <p className="text-center text-white/80 italic my-8">
          No proverbs yet. Ask the assistant to add some!
        </p>}
      </div>
    </div>
  );
}

// Weather card component where the location and themeColor are based on what the agent
// sets via tool calls.
function WeatherCard({ location, themeColor }: { location?: string, themeColor: string }) {
  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="rounded-xl shadow-xl mt-6 mb-4 max-w-md w-full"
    >
      <div className="bg-white/20 p-4 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white capitalize">{location}</h3>
            <p className="text-white">Current Weather</p>
          </div>
          <Sun className="w-14 h-14 text-yellow-200" />
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div className="text-3xl font-bold text-white">70°</div>
          <div className="text-sm text-white">Clear skies</div>
        </div>

        <div className="mt-4 pt-4 border-t border-white">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-white text-xs">Humidity</p>
              <p className="text-white font-medium">45%</p>
            </div>
            <div>
              <p className="text-white text-xs">Wind</p>
              <p className="text-white font-medium">5 mph</p>
            </div>
            <div>
              <p className="text-white text-xs">Feels Like</p>
              <p className="text-white font-medium">72°</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
