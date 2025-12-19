import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { ReactFrontendTool } from "../../types/frontend-tool";
import { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import { z } from "zod";

describe("CopilotKitProvider - Wildcard Tool", () => {
  describe("Wildcard Frontend Tool", () => {
    it("should register wildcard frontend tool", () => {
      const wildcardHandler = vi.fn();
      const wildcardTool: ReactFrontendTool = {
        name: "*",
        description: "Fallback for undefined tools",
        handler: wildcardHandler,
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={[wildcardTool]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const retrievedTool = result.current.copilotkit.getTool({ toolName: "*" });
      expect(retrievedTool).toBeDefined();
      expect(retrievedTool?.name).toBe("*");
      expect(retrievedTool?.handler).toBe(wildcardHandler);
    });

    it("should register wildcard alongside specific tools", () => {
      const specificHandler = vi.fn();
      const wildcardHandler = vi.fn();
      
      const specificTool: ReactFrontendTool = {
        name: "specific",
        handler: specificHandler,
      };
      
      const wildcardTool: ReactFrontendTool = {
        name: "*",
        handler: wildcardHandler,
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={[specificTool, wildcardTool]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.copilotkit.getTool({ toolName: "specific" })).toBeDefined();
      expect(result.current.copilotkit.getTool({ toolName: "*" })).toBeDefined();
    });

    it("should register wildcard with render component", () => {
      const WildcardRender: React.FC<any> = ({ args }) => (
        <div>Unknown tool: {args.toolName}</div>
      );
      
      const wildcardTool: ReactFrontendTool = {
        name: "*",
        description: "Fallback with render",
        parameters: z.object({
          toolName: z.string(),
          args: z.unknown(),
        }),
        render: WildcardRender,
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={[wildcardTool]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const wildcardRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "*");
      expect(wildcardRender).toBeDefined();
      expect(wildcardRender?.render).toBe(WildcardRender);
    });

    it("should support wildcard with agentId", () => {
      const wildcardHandler = vi.fn();
      const wildcardTool: ReactFrontendTool = {
        name: "*",
        handler: wildcardHandler,
        agentId: "specificAgent",
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={[wildcardTool]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const retrievedTool = result.current.copilotkit.getTool({ toolName: "*", agentId: "specificAgent" });
      expect(retrievedTool?.agentId).toBe("specificAgent");
    });
  });

  describe("Wildcard Human-in-the-Loop", () => {
    it("should register wildcard human-in-the-loop tool", () => {
      const WildcardComponent: React.FC<any> = ({ args }) => (
        <div>Unknown interaction: {args.toolName}</div>
      );
      
      const wildcardHitl: ReactHumanInTheLoop = {
        name: "*",
        description: "Fallback interaction",
        parameters: z.object({
          toolName: z.string(),
          args: z.unknown(),
        }),
        render: WildcardComponent,
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider humanInTheLoop={[wildcardHitl]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.copilotkit.getTool({ toolName: "*" })).toBeDefined();
      const wildcardRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "*");
      expect(wildcardRender).toBeDefined();
      expect(wildcardRender?.render).toBe(WildcardComponent);
    });

    it("should support wildcard human-in-the-loop with agentId", () => {
      const WildcardComponent: React.FC<any> = () => <div>Wildcard</div>;
      
      const wildcardHitl: ReactHumanInTheLoop = {
        name: "*",
        parameters: z.object({
          toolName: z.string(),
          args: z.unknown(),
        }),
        render: WildcardComponent,
        agentId: "agent1",
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider humanInTheLoop={[wildcardHitl]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const retrievedTool = result.current.copilotkit.getTool({ toolName: "*", agentId: "agent1" });
      expect(retrievedTool?.agentId).toBe("agent1");
    });
  });

  describe("Wildcard Render Tool Calls", () => {
    it("should register wildcard in renderToolCalls", () => {
      const WildcardRender: React.FC<any> = ({ args }) => (
        <div>Fallback render</div>
      );
      
      const renderToolCalls = [
        {
          name: "*",
          args: z.object({
            toolName: z.string(),
            args: z.unknown(),
          }),
          render: WildcardRender,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider renderToolCalls={renderToolCalls}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const wildcardRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "*");
      expect(wildcardRender).toBeDefined();
      expect(wildcardRender?.render).toBe(WildcardRender);
    });

    it("should support wildcard render with agentId", () => {
      const WildcardRender: React.FC<any> = () => <div>Agent wildcard</div>;
      
      const renderToolCalls = [
        {
          name: "*",
          args: z.object({
            toolName: z.string(),
            args: z.unknown(),
          }),
          render: WildcardRender,
          agentId: "agent1",
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider renderToolCalls={renderToolCalls}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const wildcardRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "*");
      expect(wildcardRender?.agentId).toBe("agent1");
    });
  });

  describe("Combined wildcard and specific tools", () => {
    it("should handle both wildcard and specific tools together", () => {
      const SpecificRender: React.FC<any> = () => <div>Specific</div>;
      const WildcardRender: React.FC<any> = () => <div>Wildcard</div>;
      
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "specificTool",
          handler: vi.fn(),
          parameters: z.object({ value: z.string() }),
          render: SpecificRender,
        },
        {
          name: "*",
          handler: vi.fn(),
          parameters: z.object({
            toolName: z.string(),
            args: z.unknown(),
          }),
          render: WildcardRender,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      // Both tools should be registered
      expect(result.current.copilotkit.getTool({ toolName: "specificTool" })).toBeDefined();
      expect(result.current.copilotkit.getTool({ toolName: "*" })).toBeDefined();
      
      // Both renders should be registered
      const specificToolRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "specificTool");
      const wildcardRender = result.current.copilotkit.renderToolCalls.find(rc => rc.name === "*");
      expect(specificToolRender).toBeDefined();
      expect(wildcardRender).toBeDefined();
    });
  });
});