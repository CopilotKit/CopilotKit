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
