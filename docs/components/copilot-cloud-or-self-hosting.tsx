import { useTailoredContent } from "@/lib/hooks/useTailoredContent";
import cn from "classnames";
import { useEffect, useState } from "react";
import { BsFillCloudHaze2Fill as CloudIcon } from "react-icons/bs";
import { FaServer as SelfHostIcon } from "react-icons/fa6";

function Toggle({ className }: { className?: string }) {
  const { mode, setMode } = useTailoredContent();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  const itemCn = "border p-4 rounded-md flex-1 cursor-pointer bg-white relative overflow-hidden group transition-all";
  const selectedCn = "ring-1 ring-indigo-400 selected bg-gradient-to-r from-indigo-100/80 to-purple-200 shadow-lg";
  const iconCn = "absolute right-[12px] top-0 opacity-10 group-[.selected]:text-indigo-500 group-[.selected]:opacity-20 transition-all";

  return (
    <div className={cn("cloud-or-self-hosting-wrapper mt-4", className)}>
      <div className="flex gap-3 my-2 w-full">
        <div
          className={cn(itemCn, mode === "cloud" && selectedCn)}
          onClick={() => setMode("cloud")}
          style={{ position: 'relative' }}
        >
          <CloudIcon className={cn(iconCn, "w-24 h-24", mode === "cloud")} />
          <p className="font-semibold text-lg">
            Copilot Cloud
          </p>
          <p className="text-sm">
            Copilot Cloud is the easiest way to get started with CopilotKit.
          </p>
        </div>
        <div
          className={cn(itemCn, mode === "self-host" && selectedCn)}
          onClick={() => setMode("self-host")}
          style={{ position: 'relative' }}
        >
          <SelfHostIcon className={cn(mode === "self-host", iconCn, "w-20 h-20 top-[10px]")} />
          <p className="font-medium text-lg">
            Self Hosting
          </p>
          <p className="text-sm">
            Set up an instance of Copilot Runtime on your own infrastructure. 
          </p>
        </div>
      </div>
    </div>
  );
}

function CloudContent({ children, className }: { children: React.ReactNode, className?: string }) {
  const { mode } = useTailoredContent();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }


  return <div className={cn("cloud-content mt-6", mode === "self-host" && "hidden", className)}>{children}</div>;
}

function SelfHostContent({ children, className }: { children: React.ReactNode, className?: string }) {
  const { mode } = useTailoredContent();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  return <div className={cn("self-hosting-content mt-6", mode === "cloud" && "hidden", className)}>{children}</div>;
}

export const TailoredExperience = {
  Toggle: Toggle,
  CloudContent: CloudContent,
  SelfHostContent: SelfHostContent,
}
