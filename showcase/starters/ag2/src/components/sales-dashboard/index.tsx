import { useAgent } from "@copilotkit/react-core/v2";
import { TodoList } from "./todo-list";
import type { SalesTodo } from "../../types";
import { SALES_STAGES } from "../../types";

interface SalesDashboardProps {
  agentId?: string;
}

export function SalesDashboard({ agentId }: SalesDashboardProps) {
  const { agent } = useAgent(agentId ? { agentId } : undefined);

  const todos: SalesTodo[] = agent.state?.todos || [];

  const onUpdate = (updatedTodos: SalesTodo[]) => {
    agent.setState({ todos: updatedTodos });
  };

  // Pipeline summary
  const totalValue = todos.reduce((sum, t) => sum + t.value, 0);
  const byStage = SALES_STAGES.reduce(
    (acc, stage) => {
      const stageTodos = todos.filter((t) => t.stage === stage);
      acc[stage] = {
        count: stageTodos.length,
        value: stageTodos.reduce((sum, t) => sum + t.value, 0),
      };
      return acc;
    },
    {} as Record<string, { count: number; value: number }>,
  );

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="max-w-5xl mx-auto px-8 py-10 h-full">
        {/* Pipeline Summary */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)] mb-4">
            Sales Pipeline
          </h1>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider font-medium">
                Total Pipeline
              </p>
              <p className="text-2xl font-bold text-[var(--foreground)] mt-1">
                ${totalValue.toLocaleString()}
              </p>
            </div>
            {SALES_STAGES.filter((s) => !s.startsWith("closed")).map(
              (stage) => (
                <div
                  key={stage}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
                >
                  <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider font-medium">
                    {stage.charAt(0).toUpperCase() + stage.slice(1)}
                  </p>
                  <p className="text-lg font-semibold text-[var(--foreground)] mt-1">
                    {byStage[stage]?.count || 0} deals
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    ${(byStage[stage]?.value || 0).toLocaleString()}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>

        {/* Todo List */}
        <TodoList
          todos={todos}
          onUpdate={onUpdate}
          isAgentRunning={agent.isRunning}
        />
      </div>
    </div>
  );
}
