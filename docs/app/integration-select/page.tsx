import { IntegrationsGrid } from "@/components/react/integrations";

export default function QuickstartSelectPage() {
  return (
    <div className="quickstart-select-bg flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-2xl text-center">
        <h1 className="mb-4 text-3xl font-bold md:text-4xl">
          CopilotKit integrates your application with any agentic backend
        </h1>
        <p className="text-muted-foreground text-lg">
          Choose your integration to get started
        </p>
      </div>
      <IntegrationsGrid />
    </div>
  );
}
