"use client"

import { useTailoredContent } from "@/lib/hooks/use-tailored-content";
import cn from "classnames";
import { useEffect, useState } from "react";
import { AiOutlineRobot as GenerativeUiIcon } from "react-icons/ai";
import { TbActivityHeartbeat as StreamAgentStateIcon } from "react-icons/tb";
import { IoShareSocialOutline as ShareAgentStateIcon } from "react-icons/io5";
import { FaQuestionCircle as AgentQAndAIcon } from "react-icons/fa";

type FeatureMode = "generative-ui" | "stream-agent-state" | "share-agent-state" | "agent-q-and-a";

export const CoAgentsFeatureToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { mode, setMode } = useTailoredContent<FeatureMode>(
    ["generative-ui", "stream-agent-state", "share-agent-state", "agent-q-and-a"],
    "generative-ui"
  );
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  const itemCn =
    "border dark:text-white dark:bg-neutral-800 p-4 rounded-md flex-1 flex flex-col items-center justify-center cursor-pointer bg-white relative overflow-hidden group transition-all";
  const selectedCn =
    "ring-1 dark:text-black ring-indigo-400 selected bg-gradient-to-r from-indigo-100/80 to-purple-200 dark:from-indigo-500 dark:to-purple-500 shadow-lg";
  const iconCn =
    "w-7 h-7 mb-2 opacity-20 group-[.selected]:text-indigo-500 group-[.selected]:opacity-60  dark:group-[.selected]:text-indigo-100 transition-all";

  const features: { id: FeatureMode; title: string; description: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    {
      id: "generative-ui",
      title: "Generative UI",
      description: "Create dynamic user interfaces with AI-generated components.",
      Icon: GenerativeUiIcon,
    },
    {
      id: "stream-agent-state",
      title: "Stream Agent State",
      description: "Real-time updates on agent activities and decision-making processes.",
      Icon: StreamAgentStateIcon,
    },
    {
      id: "share-agent-state",
      title: "Share Agent State",
      description: "Collaborate and share agent states across different sessions or users.",
      Icon: ShareAgentStateIcon,
    },
    {
      id: "agent-q-and-a",
      title: "Agent Q&A",
      description: "Interactive question and answer sessions with AI agents.",
      Icon: AgentQAndAIcon,
    },
  ];

  return (
    <div className={cn("coagents-features-wrapper mt-4", className)}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-2 w-full">
        {features.map((feature) => (
          <div
            key={feature.id}
            className={cn(itemCn, mode === feature.id && selectedCn)}
            onClick={() => setMode(feature.id)}
          >
            <feature.Icon className={cn(iconCn, mode === feature.id && "text-indigo-500")} />
            <p className="font-semibold text-sm md:text-base text-center">{feature.title}</p>
            <p className="text-xs text-center hidden md:block">{feature.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const FeatureContent: React.FC<{
  children: React.ReactNode;
  className?: string;
  mode: FeatureMode;
}> = ({ children, className, mode }) => {
  const { mode: currentMode } = useTailoredContent<FeatureMode>(
    ["generative-ui", "stream-agent-state", "share-agent-state", "agent-q-and-a"],
    "generative-ui"
  );
  
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  return (
    <div
      className={cn(
        "feature-content mt-6",
        currentMode !== mode && "hidden",
        className
      )}
    >
      {children}
    </div>
  );
};

export const CoAgentsFeatureRender: React.FC<{ children: React.ReactNode; className?: string, feature: "generative-ui" | "stream-agent-state" | "share-agent-state" | "agent-q-and-a" }> = (props) => (
  <FeatureContent {...props} mode={props.feature} />
);
