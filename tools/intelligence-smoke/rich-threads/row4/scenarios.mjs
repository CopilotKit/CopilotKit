import assert from "node:assert/strict";

/** Expectations derive exclusively from the untouched native source. Asking for
 * its first user message exercises history retrieval without supplying the answer.
 * Existing todos are changed by ID with an exact independently computed outcome.
 */
export function continuationPlan({
  source,
  native,
  imported,
  plan,
  absentBeforeImport,
  evidence,
}) {
  if (plan) return structuredClone(plan);
  const pending = native.pending ?? [];
  const common = {
    absentBeforeImport: absentBeforeImport ?? imported.absentBeforeImport,
    importEvidence: evidence?.[0] ?? imported.importEvidence,
    nativeValidationEvidence: evidence?.[0] ?? native.evidence,
  };
  if (pending.length) {
    assert.equal(
      pending.length,
      1,
      "Pending continuation scenario needs one original interaction",
    );
    const control = pending[0];
    assert.ok(
      control.action,
      "Native source scenario must identify actual Showcase control",
    );
    assert.ok(
      Object.hasOwn(control, "answer") && Object.hasOwn(control, "result"),
      "Source scenario must declare expected answer/result before browser action",
    );
    return {
      ...common,
      mode: `${control.kind}-pending`,
      pending: structuredClone(control),
    };
  }
  const first = native.items.find(
    (item) =>
      item.kind === "text" &&
      item.role === "user" &&
      typeof item.payload === "string" &&
      item.payload.length > 10,
  );
  assert.ok(
    first,
    `Source ${source.id} has no history-dependent question fixture`,
  );
  const prompt =
    "Quote the first user message in this conversation exactly, including its original wording. Use the saved history, then confirm what you did.";
  const result = {
    ...common,
    mode: "followup",
    prompt,
    historyTokens: [first.payload],
    stateChanges: [],
  };
  const todo = native.state?.todos?.find(
    (item) => item.id && item.status === "pending",
  );
  if (todo) {
    result.prompt += ` Mark the existing todo with ID ${JSON.stringify(todo.id)} completed. Keep all other todo fields, todo ordering, and saved state unchanged.`;
    result.stateChanges = [["todos"]];
    result.expectedState = structuredClone(native.state);
    result.expectedState.todos.find((item) => item.id === todo.id).status =
      "completed";
  }
  assert.ok(
    !result.prompt.includes(first.payload),
    "Continuation prompt reveals the required history answer",
  );
  return result;
}
