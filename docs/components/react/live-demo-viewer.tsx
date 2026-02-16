"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

interface LiveDemo {
  type: "saas" | "canvas";
  title: string;
  description: string;
  iframeUrl: string;
}

interface LiveDemoViewerProps {
  demos: LiveDemo[];
}

export function LiveDemoViewer({ demos }: LiveDemoViewerProps) {
  const [activeDemo, setActiveDemo] = useState<"saas" | "canvas">(
    demos[0]?.type || "saas",
  );

  return (
    <section className="mb-12">
      <div className="mb-8 text-center">
        <p className="text-muted-foreground mx-auto mb-8 max-w-3xl text-lg">
          Explore different types of agentic applications built with CopilotKit
          and AI agents
        </p>

        {/* Demo Toggle Buttons */}
        {demos.length > 1 && (
          <div className="mb-8 flex justify-center gap-4">
            {demos.map((demo) => (
              <Button
                key={demo.type}
                onClick={() => setActiveDemo(demo.type)}
                className={`cursor-pointer px-6 py-2 ${
                  activeDemo === demo.type
                    ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary border shadow"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary"
                }`}
              >
                {demo.title}
              </Button>
            ))}
          </div>
        )}

        <div className="from-primary to-primary mx-auto mt-6 h-1 w-24 rounded-full bg-gradient-to-r"></div>
      </div>

      <div className="mx-auto mt-8 mb-16 max-w-4xl">
        {demos.find((demo) => demo.type === activeDemo) && (
          <div className="text-center">
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              {demos.find((demo) => demo.type === activeDemo)?.title}
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              {demos.find((demo) => demo.type === activeDemo)?.description}
            </p>
          </div>
        )}
      </div>

      <div className="relative">
        {demos.find((demo) => demo.type === activeDemo) && (
          <iframe
            src={demos.find((demo) => demo.type === activeDemo)?.iframeUrl}
            className="h-[600px] w-full rounded-xl border shadow-lg"
            title={`${demos.find((demo) => demo.type === activeDemo)?.title} Demo`}
          />
        )}
        <div className="ring-secondary pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset"></div>
      </div>
    </section>
  );
}
