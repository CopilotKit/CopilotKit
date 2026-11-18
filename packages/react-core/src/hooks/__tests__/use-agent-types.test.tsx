import { describe, it, expectTypeOf } from "vitest";
import type { UseAgentProps } from "../use-agent";

/**
 * `threadId` and `runtimeAgentId` are a matched pair, and each is meaningless
 * alone. A `threadId` is written onto a single agent instance, and an agent
 * resolved by `agentId` alone is a shared singleton, so scoping a thread to one
 * would clobber other callers — hence `threadId` needs `runtimeAgentId`.
 * Conversely a private proxied agent with no thread to scope behaves like the
 * shared agent while costing a registration and a local id to keep unique —
 * hence `runtimeAgentId` needs `threadId`.
 *
 * `useAgent` throws at runtime on either lone prop; these tests pin the
 * compile-time half of that contract so `useAgent({ agentId, threadId })` can't
 * ship (the original bug was exactly a silently-ignored threadId prop, which
 * types would have caught).
 *
 * Assignability is asserted against `UseAgentProps` directly rather than by
 * calling `useAgent`, so no provider/render harness is needed.
 */
describe("UseAgentProps: threadId and runtimeAgentId are all-or-nothing", () => {
  it("accepts no props at all", () => {
    expectTypeOf<{}>().toExtend<UseAgentProps>();
  });

  it("accepts agentId alone", () => {
    expectTypeOf<{ agentId: string }>().toExtend<UseAgentProps>();
  });

  it("rejects runtimeAgentId without threadId", () => {
    // A private proxied agent with no thread to scope buys nothing over binding
    // to the shared agent by agentId, so the pair is all-or-nothing.
    expectTypeOf<{
      agentId: string;
      runtimeAgentId: string;
    }>().not.toExtend<UseAgentProps>();
  });

  it("accepts threadId together with runtimeAgentId", () => {
    expectTypeOf<{
      agentId: string;
      runtimeAgentId: string;
      threadId: string;
    }>().toExtend<UseAgentProps>();
  });

  it("rejects the thread-scoped pair without an explicit agentId", () => {
    // The proxy is registered under `agentId`; letting it fall back to the chat
    // configuration or DEFAULT_AGENT_ID would register over an id that already
    // belongs to a real agent.
    expectTypeOf<{
      runtimeAgentId: string;
      threadId: string;
    }>().not.toExtend<UseAgentProps>();
  });

  it("rejects a possibly-undefined agentId alongside the thread-scoped pair", () => {
    // Would hit the same fallback whenever agentId resolved to undefined.
    expectTypeOf<{
      agentId: string | undefined;
      runtimeAgentId: string;
      threadId: string;
    }>().not.toExtend<UseAgentProps>();
  });

  it("rejects a possibly-undefined threadId alongside runtimeAgentId", () => {
    // Whenever threadId resolved to undefined this would be the rejected
    // runtimeAgentId-only shape, so the type must not admit it. Callers holding
    // `string | undefined` thread state narrow before calling.
    expectTypeOf<{
      agentId: string;
      runtimeAgentId: string;
      threadId: string | undefined;
    }>().not.toExtend<UseAgentProps>();
  });

  it("accepts an explicitly-undefined threadId with no runtimeAgentId", () => {
    // `threadId: undefined` is the same as not passing one; must not error.
    expectTypeOf<{
      agentId: string;
      threadId: undefined;
    }>().toExtend<UseAgentProps>();
  });

  it("accepts both explicitly undefined", () => {
    expectTypeOf<{
      agentId: string;
      threadId: undefined;
      runtimeAgentId: undefined;
    }>().toExtend<UseAgentProps>();
  });

  it("rejects threadId without runtimeAgentId", () => {
    expectTypeOf<{
      agentId: string;
      threadId: string;
    }>().not.toExtend<UseAgentProps>();
  });

  it("rejects threadId when runtimeAgentId might be undefined", () => {
    // Would throw at runtime whenever runtimeAgentId resolves to undefined, so
    // the type must not admit it either.
    expectTypeOf<{
      agentId: string;
      runtimeAgentId: string | undefined;
      threadId: string;
    }>().not.toExtend<UseAgentProps>();
  });

  it("rejects a possibly-undefined threadId without runtimeAgentId", () => {
    expectTypeOf<{
      agentId: string;
      threadId: string | undefined;
    }>().not.toExtend<UseAgentProps>();
  });

  it("exposes threadId and runtimeAgentId as optional strings when read off the union", () => {
    // Destructuring in the implementation reads across both branches.
    expectTypeOf<UseAgentProps["threadId"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<UseAgentProps["runtimeAgentId"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});
