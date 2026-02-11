import { IntegrationsGrid } from "@/components/react/integrations";

export default function QuickstartSelectPage() {
  return (
    <div className="quickstart-select-bg min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center max-w-2xl">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          CopilotKit integrates your application with any agentic backend
        </h1>
        <p className="text-lg text-muted-foreground">
          Choose your integration to get started
        </p>
      </div>
      <IntegrationsGrid />
    </div>
  );
}
