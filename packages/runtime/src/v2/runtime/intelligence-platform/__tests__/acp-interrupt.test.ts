import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import {
  AcpInterruptResolutionError,
  resolveAcpElicitationResume,
  resolveAcpPermissionResume,
} from "../acp-interrupt";

const request: RequestPermissionRequest = {
  sessionId: "session-1",
  toolCall: { toolCallId: "call-1", title: "Write package.json" },
  options: [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ],
};

test("an AG-UI resolved permission resume selects the exact ACP option id", () => {
  const response = resolveAcpPermissionResume(
    {
      interruptId: "acp:permission:permission-7",
      status: "resolved",
      payload: { optionId: "allow-once" },
    },
    request,
    "acp:permission:permission-7",
  );

  expect(response).toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
});

test("a cancelled AG-UI resume cancels the exact ACP permission request", () => {
  expect(
    resolveAcpPermissionResume(
      {
        interruptId: "acp:permission:permission-7",
        status: "cancelled",
        payload: null,
      },
      request,
      "acp:permission:permission-7",
    ),
  ).toEqual({ outcome: { outcome: "cancelled" } });
});

test.each([
  {
    name: "unrelated interrupt",
    resume: {
      interruptId: "acp:permission:other",
      status: "resolved",
      payload: { optionId: "allow-once" },
    } as const,
    code: "unknown_interrupt",
  },
  {
    name: "missing option id",
    resume: {
      interruptId: "acp:permission:permission-7",
      status: "resolved",
      payload: {},
    } as const,
    code: "invalid_payload",
  },
  {
    name: "unknown option id",
    resume: {
      interruptId: "acp:permission:permission-7",
      status: "resolved",
      payload: { optionId: "allow-always" },
    } as const,
    code: "unknown_permission_option",
  },
] as const)("rejects $name", ({ resume, code }) => {
  const resolve = (): void => {
    resolveAcpPermissionResume(resume, request, "acp:permission:permission-7");
  };

  expect(resolve).toThrowError(AcpInterruptResolutionError);
  expect(resolve).toThrowError(expect.objectContaining({ code }));
});

test("a resolved form elicitation returns the exact ACP accept envelope", () => {
  const response = resolveAcpElicitationResume(
    {
      interruptId: "acp:elicitation:request-9",
      status: "resolved",
      payload: {
        action: "accept",
        content: { branch: "main", includeTests: true },
      },
    },
    "acp:elicitation:request-9",
  );

  expect(response).toEqual({
    action: "accept",
    content: { branch: "main", includeTests: true },
  });
});

test("a declined elicitation and a cancelled AG-UI resume stay distinct", () => {
  expect(
    resolveAcpElicitationResume(
      {
        interruptId: "acp:elicitation:request-9",
        status: "resolved",
        payload: { action: "decline" },
      },
      "acp:elicitation:request-9",
    ),
  ).toEqual({ action: "decline" });
  expect(
    resolveAcpElicitationResume(
      {
        interruptId: "acp:elicitation:request-9",
        status: "cancelled",
        payload: null,
      },
      "acp:elicitation:request-9",
    ),
  ).toEqual({ action: "cancel" });
});
