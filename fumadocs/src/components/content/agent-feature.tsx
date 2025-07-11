"use client";

import { useState } from "react";

interface AgentIntegration {
  id: string;
  name: string;
  icon: React.ReactNode;
  component: React.ReactNode;
}

interface AgentFeatureProps {
  integrations: AgentIntegration[];
  defaultActive?: string;
}

export function AgentFeature({ integrations, defaultActive }: AgentFeatureProps) {
  const [activeIntegration, setActiveIntegration] = useState(
    defaultActive || integrations[0]?.id
  );

  const currentIntegration = integrations.find(
    (integration) => integration.id === activeIntegration
  );

  return (
    <div className="w-full">
      {/* Integration Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
        {integrations.map((integration) => (
          <button
            key={integration.id}
            onClick={() => setActiveIntegration(integration.id)}
            className={`px-4 py-2 flex gap-2 items-center rounded-xl text-sm font-medium transition-colors cursor-pointer justify-center ${
              activeIntegration === integration.id
                ? "bg-primary/10 dark:bg-primary/20 text-primary"
                : "bg-secondary hover:bg-primary/10 hover:text-primary"
            }`}
          >
            <div className="w-4 h-4">{integration.icon}</div>
            {integration.name}
          </button>
        ))}
      </div>

      {/* Active Integration Content */}
      <div className="w-full">
        {currentIntegration?.component}
      </div>
    </div>
  );
}
