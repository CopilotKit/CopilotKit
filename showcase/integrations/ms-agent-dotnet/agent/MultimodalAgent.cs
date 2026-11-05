using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;

// ============================================================================
// Multimodal Agent
// ============================================================================
//
// Vision-capable .NET agent for the Multimodal Attachments demo cell.
//
// Design mirrors the LangGraph reference
// (showcase/integrations/langgraph-python/src/agents/multimodal_agent.py):
//  - Use a vision-capable chat model (gpt-6-luna) so images are
//    consumed natively by the model via OpenAI's image content parts.
//  - No tools are registered — the model handles image/PDF analysis directly.
//  - PDF handling: Microsoft.Extensions.AI passes document/data content parts
//    through as DataContent, and modern OpenAI chat models accept PDF input
//    directly. We therefore avoid bundling a PDF extractor (like pypdf on the
//    Python side) and defer to the model's native document handling. If a PDF
//    cannot be read, the model will tell the user — matching the "[Attached
//    document: PDF could not be read.]" graceful degradation in Python.
//
// Wire format: `MultimodalEndpoint` parses the modern
// `{ type: "image" | "document", source: {...} }` content parts CopilotChat
// emits and forwards them as DataContent parts the chat client can pass to
// the OpenAI image/file adapters unchanged. The dedicated endpoint exists
// because the current Microsoft AG-UI ASP.NET adapter rejects content arrays
// before an AIAgent can see them.
//
// Mount point: `/multimodal` (see Program.cs). The Next.js runtime's
// `src/app/api/copilotkit-multimodal/route.ts` proxies to this endpoint via
// AG-UI over HTTP.
// ============================================================================

internal static class MultimodalAgentFactory
{
    internal const string SystemPrompt =
        "You are a helpful assistant. The user may attach images or documents " +
        "(PDFs). When they do, analyze the attachment carefully and answer the " +
        "user's question. If no attachment is present, answer the text question " +
        "normally. Keep responses concise (1-3 sentences) unless asked to go deep.";

    public static AIAgent Create(OpenAIClient openAiClient)
    {
        ArgumentNullException.ThrowIfNull(openAiClient);

        // Use the shared Luna chat model for image input as well as text.
        var chatClient = openAiClient.GetChatClient("gpt-6-luna").AsLunaChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "MultimodalAgent",
            instructions: SystemPrompt,
            tools: []);
    }
}
