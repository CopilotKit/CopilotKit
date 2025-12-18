import React, { useEffect, useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { ReactHumanInTheLoop } from "@/types";
import { ToolCallStatus } from "@copilotkitnext/core";
import { CopilotChat } from "@/components/chat/CopilotChat";
import CopilotChatToolCallsView from "@/components/chat/CopilotChatToolCallsView";
import { AssistantMessage, Message } from "@ag-ui/core";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "@/__tests__/utils/test-helpers";

describe("useHumanInTheLoop E2E - HITL Tool Rendering", () => {
  describe("HITL Renderer with Status Transitions", () => {
    it("should show InProgress → Complete transitions for HITL tool", async () => {
      const agent = new MockStepwiseAgent();
      const statusHistory: ToolCallStatus[] = [];

      const HITLComponent: React.FC = () => {
        const hitlTool: ReactHumanInTheLoop<{ action: string; reason: string }> = {
          name: "approvalTool",
          description: "Requires human approval",
          parameters: z.object({
            action: z.string(),
            reason: z.string(),
          }),
          render: ({ status, args, result, respond, name, description }) => {
            useEffect(() => {
              if (statusHistory[statusHistory.length - 1] !== status) {
                statusHistory.push(status);
              }
            }, [status]);

            return (
              <div data-testid="hitl-tool">
                <div data-testid="hitl-name">{name}</div>
                <div data-testid="hitl-description">{description}</div>
                <div data-testid="hitl-status">{status}</div>
                <div data-testid="hitl-action">{args.action ?? ""}</div>
                <div data-testid="hitl-reason">{args.reason ?? ""}</div>
                {respond && (
                  <button
                    data-testid="hitl-approve"
                    onClick={() => respond(JSON.stringify({ approved: true }))}
                  >
                    Approve
                  </button>
                )}
                {result && <div data-testid="hitl-result">{result}</div>}
              </div>
            );
          },
        };

        useHumanInTheLoop(hitlTool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <HITLComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Request approval" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Request approval")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "approvalTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "delete", reason: "cleanup" }),
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId("hitl-status").textContent).toBe(ToolCallStatus.InProgress);
        expect(screen.getByTestId("hitl-action").textContent).toBe("delete");
        expect(screen.getByTestId("hitl-reason").textContent).toBe("cleanup");
      });

      agent.emit(runFinishedEvent());
      agent.complete();

      const approveButton = await screen.findByTestId("hitl-approve");
      expect(screen.getByTestId("hitl-status").textContent).toBe(ToolCallStatus.Executing);

      fireEvent.click(approveButton);

      await waitFor(() => {
        expect(screen.getByTestId("hitl-status").textContent).toBe(ToolCallStatus.Complete);
        expect(screen.getByTestId("hitl-result").textContent).toContain("approved");
        // Also wait for the useEffect to update statusHistory
        expect(statusHistory).toEqual([
          ToolCallStatus.InProgress,
          ToolCallStatus.Executing,
          ToolCallStatus.Complete,
        ]);
      });
    });
  });

  describe("HITL with Interactive Respond", () => {
    it("should handle interactive respond callback during Executing state", async () => {
      const agent = new MockStepwiseAgent();
      const respondSelections: string[] = [];

      const InteractiveHITLComponent: React.FC = () => {
        const hitlTool: ReactHumanInTheLoop<{ question: string; options: string[] }> = {
          name: "interactiveTool",
          description: "Interactive human-in-the-loop tool",
          parameters: z.object({
            question: z.string(),
            options: z.array(z.string()),
          }),
          render: ({ status, args, result, respond, name }) => (
            <div data-testid="interactive-hitl">
              <div data-testid="interactive-name">{name}</div>
              <div data-testid="interactive-status">{status}</div>
              <div data-testid="interactive-question">{args.question ?? ""}</div>
              <div data-testid="interactive-options">{args.options?.join(", ") ?? ""}</div>

              {status === ToolCallStatus.Executing && respond && (
                <div data-testid="respond-section">
                  <button
                    data-testid="respond-yes"
                    onClick={() => {
                      respondSelections.push("yes");
                      void respond(JSON.stringify({ answer: "yes" }));
                    }}
                  >
                    Respond Yes
                  </button>
                  <button
                    data-testid="respond-no"
                    onClick={() => {
                      respondSelections.push("no");
                      void respond(JSON.stringify({ answer: "no" }));
                    }}
                  >
                    Respond No
                  </button>
                </div>
              )}

              {result && <div data-testid="interactive-result">{result}</div>}
            </div>
          ),
        };

        useHumanInTheLoop(hitlTool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <InteractiveHITLComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Interactive question" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Interactive question")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "interactiveTool",
          parentMessageId: messageId,
          delta: JSON.stringify({
            question: "Proceed with operation?",
            options: ["yes", "no"],
          }),
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId("interactive-question").textContent).toContain(
          "Proceed with operation?"
        );
        expect(screen.getByTestId("interactive-options").textContent).toContain("yes");
        expect(screen.getByTestId("interactive-options").textContent).toContain("no");
      });

      agent.emit(runFinishedEvent());
      agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("interactive-status").textContent).toBe(
          ToolCallStatus.Executing
        );
        expect(screen.getByTestId("respond-section")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("respond-yes"));

      await waitFor(() => {
        expect(screen.getByTestId("interactive-status").textContent).toBe(
          ToolCallStatus.Complete
        );
        expect(screen.getByTestId("interactive-result").textContent).toContain("yes");
      });

      expect(respondSelections).toEqual(["yes"]);
    });
  });

  describe("Multiple HITL Tools", () => {
    it("should handle multiple HITL tools registered simultaneously", async () => {
      const agent = new MockStepwiseAgent();

      const MultipleHITLComponent: React.FC = () => {
        const reviewTool: ReactHumanInTheLoop<{ changes: string[] }> = {
          name: "reviewTool",
          description: "Review changes",
          parameters: z.object({ changes: z.array(z.string()) }),
          render: ({ name, description, args, status }) => (
            <div data-testid="review-tool">
              {name} - {description} | Status: {status} | Changes: {args.changes?.length ?? 0}
            </div>
          ),
        };

        const confirmTool: ReactHumanInTheLoop<{ action: string }> = {
          name: "confirmTool",
          description: "Confirm action",
          parameters: z.object({ action: z.string() }),
          render: ({ name, description, args, status }) => (
            <div data-testid="confirm-tool">
              {name} - {description} | Status: {status} | Action: {args.action ?? ""}
            </div>
          ),
        };

        useHumanInTheLoop(reviewTool);
        useHumanInTheLoop(confirmTool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <MultipleHITLComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Multiple HITL" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Multiple HITL")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId1 = testId("tc1");
      const toolCallId2 = testId("tc2");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId1,
          toolCallName: "reviewTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ changes: ["file1.ts", "file2.ts"] }),
        })
      );
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "confirmTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "deploy" }),
        })
      );

      await waitFor(() => {
        const reviewTool = screen.getByTestId("review-tool");
        const confirmTool = screen.getByTestId("confirm-tool");
        expect(reviewTool.textContent).toContain("Changes: 2");
        expect(confirmTool.textContent).toContain("Action: deploy");
        expect(reviewTool.textContent).toContain(ToolCallStatus.InProgress);
        expect(confirmTool.textContent).toContain(ToolCallStatus.InProgress);
      });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("Multiple Hook Instances", () => {
    it("should isolate state across two useHumanInTheLoop registrations", async () => {
      const agent = new MockStepwiseAgent();

      const DualHookComponent: React.FC = () => {
        const primaryTool: ReactHumanInTheLoop<{ action: string }> = {
          name: "primaryTool",
          description: "Primary approval tool",
          parameters: z.object({ action: z.string() }),
          render: ({ status, args, respond, result }) => (
            <div data-testid="primary-tool">
              <div data-testid="primary-status">{status}</div>
              <div data-testid="primary-action">{args.action ?? ""}</div>
              {respond && (
                <button
                  data-testid="primary-respond"
                  onClick={() => respond(JSON.stringify({ approved: true }))}
                >
                  Respond Primary
                </button>
              )}
              {result && <div data-testid="primary-result">{result}</div>}
            </div>
          ),
        };

        const secondaryTool: ReactHumanInTheLoop<{ detail: string }> = {
          name: "secondaryTool",
          description: "Secondary approval tool",
          parameters: z.object({ detail: z.string() }),
          render: ({ status, args, respond, result }) => (
            <div data-testid="secondary-tool">
              <div data-testid="secondary-status">{status}</div>
              <div data-testid="secondary-detail">{args.detail ?? ""}</div>
              {respond && (
                <button
                  data-testid="secondary-respond"
                  onClick={() => respond(JSON.stringify({ confirmed: true }))}
                >
                  Respond Secondary
                </button>
              )}
              {result && <div data-testid="secondary-result">{result}</div>}
            </div>
          ),
        };

        useHumanInTheLoop(primaryTool);
        useHumanInTheLoop(secondaryTool);
        return null;
      };

      renderWithCopilotKit({
        agent,
        children: (
          <>
            <DualHookComponent />
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        ),
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Dual hook instance" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Dual hook instance")).toBeDefined();
      });

      const messageId = testId("msg");
      const primaryToolCallId = testId("tc-primary");
      const secondaryToolCallId = testId("tc-secondary");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: primaryToolCallId,
          toolCallName: "primaryTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ action: "archive" }),
        })
      );
      agent.emit(
        toolCallChunkEvent({
          toolCallId: secondaryToolCallId,
          toolCallName: "secondaryTool",
          parentMessageId: messageId,
          delta: JSON.stringify({ detail: "requires confirmation" }),
        })
      );

      await waitFor(() => {
        expect(screen.getByTestId("primary-status").textContent).toBe(ToolCallStatus.InProgress);
        expect(screen.getByTestId("primary-action").textContent).toBe("archive");
        expect(screen.getByTestId("secondary-status").textContent).toBe(ToolCallStatus.InProgress);
        expect(screen.getByTestId("secondary-detail").textContent).toBe("requires confirmation");
      });

      agent.emit(runFinishedEvent());
      agent.complete();

      const primaryRespondButton = await screen.findByTestId("primary-respond");

      expect(screen.getByTestId("primary-status").textContent).toBe(ToolCallStatus.Executing);
      expect(screen.getByTestId("secondary-status").textContent).toBe(ToolCallStatus.InProgress);
      expect(screen.queryByTestId("secondary-respond")).toBeNull();

      fireEvent.click(primaryRespondButton);

      await waitFor(() => {
        expect(screen.getByTestId("primary-status").textContent).toBe(ToolCallStatus.Complete);
        expect(screen.getByTestId("primary-result").textContent).toContain("approved");
        expect(screen.getByTestId("secondary-status").textContent).toBe(ToolCallStatus.Executing);
        expect(screen.queryByTestId("secondary-result")).toBeNull();
      });

      const secondaryRespondButton = await screen.findByTestId("secondary-respond");

      fireEvent.click(secondaryRespondButton);

      await waitFor(() => {
        expect(screen.getByTestId("secondary-status").textContent).toBe(ToolCallStatus.Complete);
        expect(screen.getByTestId("secondary-result").textContent).toContain("confirmed");
      });
    });
  });

  describe("HITL Tool with Dynamic Registration", () => {
    it("should support dynamic registration and unregistration of HITL tools", async () => {
      const agent = new MockStepwiseAgent();

      const DynamicHITLComponent: React.FC = () => {
        const dynamicHitl: ReactHumanInTheLoop<{ data: string }> = {
          name: "dynamicHitl",
          description: "Dynamically registered HITL",
          parameters: z.object({ data: z.string() }),
          render: ({ args, name, description }) => (
            <div data-testid="dynamic-hitl">
              {name}: {description} | Data: {args.data ?? ""}
            </div>
          ),
        };

        useHumanInTheLoop(dynamicHitl);
        return <div data-testid="hitl-enabled">HITL Enabled</div>;
      };

      const TestWrapper: React.FC = () => {
        const [enabled, setEnabled] = useState(false);

        return (
          <>
            <button data-testid="toggle-hitl" onClick={() => setEnabled((prev) => !prev)}>
              Toggle HITL
            </button>
            {enabled && <DynamicHITLComponent />}
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </>
        );
      };

      renderWithCopilotKit({
        agent,
        children: <TestWrapper />,
      });

      expect(screen.queryByTestId("hitl-enabled")).toBeNull();

      const toggleButton = screen.getByTestId("toggle-hitl");
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByTestId("hitl-enabled")).toBeDefined();
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test dynamic HITL" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test dynamic HITL")).toBeDefined();
      });

      const messageId = testId("msg");
      const toolCallId = testId("tc");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId,
          toolCallName: "dynamicHitl",
          parentMessageId: messageId,
          delta: JSON.stringify({ data: "test data" }),
        })
      );

      await waitFor(() => {
        const dynamicHitl = screen.getByTestId("dynamic-hitl");
        expect(dynamicHitl.textContent).toContain("dynamicHitl");
        expect(dynamicHitl.textContent).toContain("test data");
      });

      agent.emit(runFinishedEvent());

      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.queryByTestId("hitl-enabled")).toBeNull();
      });

      fireEvent.change(input, { target: { value: "Test after disable" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test after disable")).toBeDefined();
      });

      const messageId2 = testId("msg2");
      const toolCallId2 = testId("tc2");

      agent.emit(runStartedEvent());
      agent.emit(
        toolCallChunkEvent({
          toolCallId: toolCallId2,
          toolCallName: "dynamicHitl",
          parentMessageId: messageId2,
          delta: JSON.stringify({ data: "should not render" }),
        })
      );

      // Wait and verify that dynamic HITL does not render
      await waitFor(() => {
        const dynamicRenders = screen.queryAllByTestId("dynamic-hitl");
        expect(dynamicRenders.length).toBe(0);
        expect(screen.queryByText(/should not render/)).toBeNull();
      }, { timeout: 200 });

      agent.emit(runFinishedEvent());
      agent.complete();
    });
  });

  describe("useHumanInTheLoop dependencies", () => {
    it("updates HITL renderer when optional deps change", async () => {
      const DependencyDrivenHITLComponent: React.FC = () => {
        const [version, setVersion] = useState(0);

        const hitlTool: ReactHumanInTheLoop<{ message: string }> = {
          name: "dependencyHitlTool",
          description: "Dependency-driven HITL tool",
          parameters: z.object({ message: z.string() }),
          render: ({ args }) => (
            <div data-testid="dependency-hitl-render">
              {args.message} (v{version})
            </div>
          ),
        };

        useHumanInTheLoop(hitlTool, [version]);

        const toolCallId = testId("hitl_dep_tc");
        const assistantMessage: AssistantMessage = {
          id: testId("hitl_dep_a"),
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "dependencyHitlTool",
                arguments: JSON.stringify({ message: "hello" }),
              },
            } as any,
          ],
        } as any;
        const messages: Message[] = [];

        return (
          <>
            <button
              data-testid="hitl-bump-version"
              type="button"
              onClick={() => setVersion((v) => v + 1)}
            >
              Bump
            </button>
            <CopilotChatToolCallsView
              message={assistantMessage}
              messages={messages}
            />
          </>
        );
      };

      renderWithCopilotKit({
        children: <DependencyDrivenHITLComponent />,
      });

      await waitFor(() => {
        const el = screen.getByTestId("dependency-hitl-render");
        expect(el).toBeDefined();
        expect(el.textContent).toContain("hello");
        expect(el.textContent).toContain("(v0)");
      });

      fireEvent.click(screen.getByTestId("hitl-bump-version"));

      await waitFor(() => {
        const el = screen.getByTestId("dependency-hitl-render");
        expect(el.textContent).toContain("(v1)");
      });
    });
  });
});
