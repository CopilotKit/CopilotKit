/** Backend-specific projections belong to the fixture, not the shared row assertion. */
export function frontendToolObservations({
  framework,
  envelopes,
  category,
  callId,
  name,
  args,
  result,
  eventsFile,
}) {
  const observations = [];
  const callPointers = [];
  for (const envelope of envelopes) {
    const parts =
      framework === "mastra"
        ? envelope.value.content?.parts
        : envelope.value.content;
    for (const [index, part] of (parts ?? []).entries()) {
      const call = framework === "mastra" ? part.toolInvocation : part.toolUse;
      const idKey = framework === "mastra" ? "toolCallId" : "toolUseId";
      const base =
        framework === "mastra"
          ? `/content/parts/${index}/toolInvocation`
          : `/content/${index}/toolUse`;
      if (call?.[idKey] === callId) {
        callPointers.push(`${envelope.pointer}${base}/${idKey}`);
        for (const [key, expected] of Object.entries(
          framework === "mastra"
            ? { toolCallId: callId, toolName: name, args }
            : { toolUseId: callId, name, input: args },
        )) {
          observations.push({
            name: `${category}-${observations.length}-${key}`,
            category,
            record: envelope.record,
            pointer: `${envelope.pointer}${base}/${key}`,
            expected,
            source: { artifact: eventsFile, pointer: "/events" },
          });
        }
      }
      const toolResult =
        framework === "mastra" ? call?.result : part.toolResult;
      if (
        result !== undefined &&
        (framework === "mastra"
          ? call?.[idKey] === callId && toolResult !== undefined
          : toolResult?.toolUseId === callId)
      ) {
        observations.push({
          name: `${category}-result-${observations.length}`,
          category,
          record: envelope.record,
          pointer:
            framework === "mastra"
              ? `${envelope.pointer}${base}/result`
              : `${envelope.pointer}/content/${index}/toolResult/content/0/text`,
          expected: result,
          source: { artifact: eventsFile, pointer: "/submittedResult" },
        });
      }
    }
  }
  // A missing native call/result is a failed assertion, never an empty successful sample.
  if (!observations.length)
    observations.push({
      name: `${category}-missing-call`,
      category,
      record: envelopes[0]?.record ?? "missing",
      pointer: "/missing-call",
      expected: callId,
      source: { artifact: eventsFile, pointer: "/events" },
    });
  if (
    result !== undefined &&
    !observations.some((observation) =>
      observation.name.startsWith(`${category}-result-`),
    )
  )
    observations.push({
      name: `${category}-result`,
      category,
      record: envelopes[0]?.record ?? "missing",
      pointer: "/missing-result",
      expected: result,
      source: { artifact: eventsFile, pointer: "/submittedResult" },
    });
  observations.push({
    name: `${category}-call-occurrences`,
    category,
    record: envelopes[0]?.record ?? "missing",
    pointers: callPointers,
    expected: [callId],
    source: { artifact: eventsFile, pointer: "/events" },
  });
  return observations;
}

export function strandsEnvelopes(snapshot) {
  return Object.entries(snapshot.records).flatMap(([record, session]) => {
    const messages = (session.data?.messages ?? []).map((value, index) => ({
      value,
      record,
      pointer: `/data/messages/${index}`,
    }));
    const pending =
      session.data?.interrupts?.pendingToolExecution?.assistantMessageData;
    if (pending)
      messages.push({
        value: pending,
        record,
        pointer: "/data/interrupts/pendingToolExecution/assistantMessageData",
      });
    return messages;
  });
}

export function nativeInterruptObservations({
  framework,
  snapshot,
  events,
  category,
}) {
  const event = events.find(
    (item) =>
      item.type === "RUN_FINISHED" && item.outcome?.type === "interrupt",
  );
  if (!event) throw new Error("Genuine native interrupt event required");
  const interrupt = event.outcome.interrupts[0];
  const pending = category === "native-pending";
  const observation = (name, record, pointer, expected) => ({
    name: `${category}-${name}`,
    category,
    record,
    pointer,
    expected,
    source: { artifact: `${category}-events.json`, pointer: "/events" },
  });
  if (framework === "mastra") {
    if (!pending)
      return [observation("cleared-checkpoint", "checkpoints", "", [])];
    const index = snapshot.records.checkpoints.findIndex(
      (checkpoint) => checkpoint.run_id === event.runId,
    );
    const base = `/${index}/snapshot`;
    const payload = interrupt.metadata.mastra;
    const approval = payload.type === "mastra_tool_approval";
    const checkpoint = snapshot.records.checkpoints[index]?.snapshot;
    const step =
      Object.entries(checkpoint?.context ?? {}).find(([, value]) =>
        approval
          ? value.suspendPayload?.requireToolApproval?.toolCallId ===
            interrupt.toolCallId
          : value.suspendPayload?.toolCallId === interrupt.toolCallId,
      )?.[0] ?? "executionWorkflow";
    const suspend = `${base}/context/${step.replaceAll("~", "~0").replaceAll("/", "~1")}/suspendPayload`;
    return [
      observation(
        "run-identity",
        "checkpoints",
        `/${index}/run_id`,
        event.runId,
      ),
      observation("suspended", "checkpoints", `${base}/status`, "suspended"),
      ...(approval
        ? [
            observation(
              "approval-payload",
              "checkpoints",
              `${suspend}/requireToolApproval`,
              {
                toolCallId: interrupt.toolCallId,
                toolName: interrupt.metadata.mastra.toolName,
                args: interrupt.metadata.mastra.args,
              },
            ),
          ]
        : [
            observation(
              "suspend-call-id",
              "checkpoints",
              `${suspend}/toolCallId`,
              interrupt.toolCallId,
            ),
            observation(
              "suspend-tool-name",
              "checkpoints",
              `${suspend}/toolName`,
              payload.toolName,
            ),
            observation(
              "suspend-payload",
              "checkpoints",
              `${suspend}/toolCallSuspended`,
              payload.suspendPayload,
            ),
          ]),
    ];
  }
  const record = Object.keys(snapshot.records)[0];
  if (!pending)
    return [
      observation("cleared-interrupt", record, "/data/interrupts", {
        interrupts: {},
        activated: false,
      }),
    ];
  const key = interrupt.id.replaceAll("~", "~0").replaceAll("/", "~1");
  return [
    observation("active-interrupt", record, "/data/interrupts/activated", true),
    observation(
      "interrupt-identity",
      record,
      `/data/interrupts/interrupts/${key}`,
      {
        id: interrupt.id,
        name: interrupt.reason,
        reason: interrupt.metadata.reason,
        source: "tool",
      },
    ),
  ];
}
