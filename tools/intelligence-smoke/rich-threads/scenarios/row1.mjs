const send = (prompt) => ({ kind: "send", prompt });
const meeting =
  "Use scheduleTime to schedule a 30-minute meeting about CopilotKit. Let me choose a time.";

/** Prompts request behavior; witnesses are discovered from emitted payloads.
 * No model text, call count, surface ID or run ID is an expected fixture.
 */
export function scenarios({ framework, media = [] } = {}) {
  return [
    {
      id: "text-reasoning",
      mode: "reasoning",
      categories: ["user-text", "assistant-text", "reasoning"],
      steps: [
        send(
          "Explain your reasoning briefly while calculating 17 times 23. Then give the answer.",
        ),
      ],
    },
    {
      id: "pie-chart",
      categories: ["chart-pie", "ordinary-tool"],
      steps: [
        send(
          "Use query_data to fetch revenue by category, then display the data using pieChart.",
        ),
      ],
    },
    {
      id: "bar-chart",
      categories: ["chart-bar", "ordinary-tool"],
      steps: [
        send(
          "Use query_data to fetch expenses by category, then display the data using barChart.",
        ),
      ],
    },
    {
      id: "flight-card",
      categories: ["flight-card"],
      steps: [
        send(
          "Find flights from SFO to JFK for next Tuesday. Show the flight cards using A2UI.",
        ),
      ],
    },
    {
      id: "dashboard",
      categories: ["dashboard-a2ui"],
      steps: [
        send(
          "Use query_data to fetch sales data and render an A2UI sales dashboard with revenue, customers, conversion rate and monthly sales.",
        ),
      ],
    },
    {
      id: "calculator",
      categories: ["calculator-iframe"],
      steps: [
        send(
          "Use generateSandboxedUi to create a calculator with buttons named 7, +, 5, and =, and a visible result. Make the buttons compute their expression.",
        ),
        ...["7", "+", "5", "="].map((name) => ({
          kind: "interact",
          action: {
            frame: "iframe[srcdoc]",
            name,
            category: "calculator-iframe",
          },
        })),
      ],
      visible: { frame: "iframe[srcdoc]", text: "12" },
    },
    {
      id: "mcp",
      categories: ["mcp-tool", "mcp-app"],
      steps: [
        send(
          "Use Excalidraw to draw a router connected to two switches. Display the interactive MCP app.",
        ),
      ],
    },
    {
      id: "shared-state",
      mode: "state",
      categories: ["shared-state-write", "shared-state-read"],
      steps: [
        send("Enable app mode and add three todos about learning CopilotKit."),
        send("Read the current task state and list the todos I just added."),
      ],
    },
    {
      id: "frontend-pending",
      control: {
        kind: "frontend",
        status: "pending",
        toolName: "scheduleTime",
      },
      categories: ["frontend-pending"],
      steps: [send(meeting)],
    },
    {
      id: "frontend-completed",
      control: {
        kind: "frontend",
        status: "completed",
        toolName: "scheduleTime",
      },
      categories: ["frontend-completed"],
      steps: [
        send(meeting),
        {
          kind: "interact",
          action: {
            name: "Tomorrow 2:00 PM 30 min",
            continuesRun: true,
            category: "frontend-completed",
          },
        },
      ],
    },
    ...nativeControlScenarios(framework),
    {
      id: "parallel-surfaces",
      categories: ["parallel-surfaces"],
      steps: [
        send(
          "Display two independent A2UI surfaces: a flight search card and a sales dashboard. Keep both visible, using different surface IDs.",
        ),
      ],
    },
    ...media.map((file) => ({
      id: `media-${file.type}-${file.sourceType}`,
      mode: "media",
      categories: [`${file.type}:${file.sourceType}`],
      media: [file],
      steps: [
        { kind: "upload", files: [file.path] },
        send(
          "Describe this attachment if supported; otherwise explain the unsupported input.",
        ),
      ],
    })),
  ].map((scenario) => ({
    ...scenario,
    toolCategories: {
      pieChart: ["chart-pie"],
      barChart: ["chart-bar"],
      query_data: ["ordinary-tool"],
      generateSandboxedUi: ["calculator-iframe"],
    },
  }));
}
import { nativeControlScenarios } from "../row2/control-scenarios.mjs";
