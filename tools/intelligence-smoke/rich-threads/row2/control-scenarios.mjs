/** Fixture routing varies by framework; browser actions and assertions stay shared. */
export function nativeControlScenarios(framework) {
  const profiles =
    framework === "mastra"
      ? [
          {
            mode: "native-suspend",
            prompt:
              "Call schedule_meeting to schedule a meeting about persistence with Alice. Let me pick a time.",
            toolName: "schedule_meeting",
            mechanism: "suspend",
            action: { name: "Tomorrow 2:00 PM", continuesRun: true },
          },
          {
            mode: "native-approval",
            prompt:
              "Call schedule_meeting to schedule a 30-minute meeting about native persistence. Wait for my approval.",
            toolName: "schedule_meeting",
            mechanism: "requireApproval",
            action: { name: "Approve native time", continuesRun: true },
          },
        ]
      : framework === "strands-typescript"
        ? [
            {
              mode: "native-suspend",
              prompt:
                "Call schedule_meeting to schedule a meeting about persistence with Alice. Let me pick a time.",
              toolName: "schedule_meeting",
              mechanism: "interrupt",
              action: { name: "Tomorrow 2:00 PM", continuesRun: true },
            },
          ]
        : [];
  return profiles.flatMap((profile) =>
    ["pending", "completed"].map((status) => ({
      id: `${profile.mode}-${status}`,
      mode: profile.mode,
      categories: [`native-${status}`],
      control: {
        kind: "native",
        status,
        toolName: profile.toolName,
        mechanism: profile.mechanism,
      },
      steps: [
        { kind: "send", prompt: profile.prompt },
        ...(status === "completed"
          ? [{ kind: "interact", action: profile.action }]
          : []),
      ],
    })),
  );
}

/** Apply backend routing to the one shared scenario inventory. */
export function showcaseScenarios(framework, shared) {
  const controls = nativeControlScenarios(framework);
  const ordinary = shared.filter(
    (scenario) =>
      !scenario.categories.some((category) => category.startsWith("native-")),
  );
  return [
    ...ordinary.map((scenario) => {
      const mode =
        scenario.mode ??
        (scenario.categories.includes("reasoning")
          ? "reasoning"
          : scenario.categories.some((category) =>
                category.startsWith("shared-state-"),
              )
            ? "state"
            : scenario.media?.length
              ? "media"
              : "rich");
      const registered = {
        rich: "beautifulChatAgent",
        reasoning: "reasoningAgent",
        state: "beautifulChatAgent",
        media: "multimodalAgent",
      }[mode];
      const native =
        framework === "mastra"
          ? {
              resourceId:
                registered === "beautifulChatAgent"
                  ? "mastra-beautiful-chat"
                  : `mastra-${registered}`,
            }
          : { namespace: mode === "reasoning" ? "reasoning" : "strands_agent" };
      const controlCategory = scenario.categories.find((category) =>
        category.startsWith("frontend-"),
      );
      return {
        ...scenario,
        mode,
        native: { ...native, ...scenario.native },
        toolCategories: {
          pieChart: ["chart-pie"],
          barChart: ["chart-bar"],
          query_data: ["ordinary-tool"],
          generateSandboxedUi: ["calculator-iframe"],
          search_flights: ["flight-card"],
          generate_a2ui: ["dashboard-a2ui"],
          ...scenario.toolCategories,
        },
        ...(controlCategory
          ? {
              control: {
                kind: "frontend",
                status: controlCategory.slice("frontend-".length),
                toolName: "scheduleTime",
              },
            }
          : {}),
      };
    }),
    ...controls.map((scenario) => ({
      ...scenario,
      native:
        framework === "mastra"
          ? {
              resourceId: `mastra-${scenario.mode === "native-suspend" ? "interruptAgent" : "weatherAgent"}`,
            }
          : { namespace: "interrupt" },
    })),
  ];
}
