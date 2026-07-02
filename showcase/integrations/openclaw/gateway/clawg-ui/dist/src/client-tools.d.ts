/**
 * Plugin tool factory registered via `api.registerTool`.
 * Receives the full `OpenClawPluginToolContext` including `sessionKey`,
 * so it's fully reentrant across concurrent requests.
 *
 * Returns AG-UI client-provided tools converted to agent tools,
 * or null if no client tools were stashed for this session.
 */
export declare function clawgUiToolFactory(ctx: {
    sessionKey?: string;
}): {
    name: string;
    label: string;
    description: string;
    parameters: any;
    execute(_toolCallId: string, args: unknown): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            clientTool: boolean;
            name: string;
            args: unknown;
        };
    }>;
}[] | null;
