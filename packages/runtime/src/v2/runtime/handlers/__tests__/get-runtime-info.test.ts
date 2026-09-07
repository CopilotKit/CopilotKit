import { handleGetRuntimeInfo } from "../get-runtime-info";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { AbstractAgent } from "@ag-ui/client";

// Create a dummy agent that overrides the name property
class TestAgent extends AbstractAgent {
    public name = "Human Friendly Name";
    public agentId = "internal-id-123";
    public description = "Test Description";
    public async getCapabilities() {
        return {};
    }
}

class TestAgentNoName extends AbstractAgent {
    public description = "Test Description 2";
    public async getCapabilities() {
        return {};
    }
}

describe("handleGetRuntimeInfo", () => {
    it("should use agent.name if available, otherwise fallback to the dictionary key", async () => {
        const runtime: Partial<CopilotRuntimeLike> = {
            agents: {
                "internal-id-123": new TestAgent(),
                "another-agent-id": new TestAgentNoName(),
            },
            mode: "sse",
            identifyUser: undefined,
        };

        const request = new Request("http://localhost/info");
        const response = await handleGetRuntimeInfo({
            runtime: runtime as CopilotRuntimeLike,
            request,
        });

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.agents).toBeDefined();

        // The key should remain the internal ID
        expect(body.agents["internal-id-123"]).toBeDefined();
        expect(body.agents["internal-id-123"].name).toBe("Human Friendly Name");

        // Fallback to key
        expect(body.agents["another-agent-id"]).toBeDefined();
        expect(body.agents["another-agent-id"].name).toBe("another-agent-id");
    });
});
