using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

public sealed partial class IntelligenceClient
{
    private static readonly JsonSerializerOptions ResourceJson = new()
    {
        RespectNullableAnnotations = true,
        AllowOutOfOrderMetadataProperties = true
    };

    private static T Resource<T>(JsonNode? node) where T : class
    {
        try
        {
            var result = Object(node).Deserialize<T>(ResourceJson)
                ?? throw new IntelligenceException(502, "Invalid Intelligence resource response");
            var invalid = result switch
            {
                ListThreadsResponse listed => listed.Threads.Any(thread => thread is null || string.IsNullOrWhiteSpace(thread.Id)),
                ThreadSummary thread => string.IsNullOrWhiteSpace(thread.Id),
                ListMemoriesResponse listed => listed.Memories.Any(InvalidMemory),
                RecallMemoriesResponse recalled => recalled.Memories.Any(InvalidMemory),
                MemorySummary memory => InvalidMemory(memory),
                ThreadMessagesResponse history => history.Messages.Any(message => message is null
                    || message.ToolCalls?.Any(call => call is null) == true),
                ThreadEventsResponse history => history.Events.Any(item => item is null)
                    || history.DecodeErrorRowIds.Any(id => id is null),
                _ => false
            };
            if (invalid) throw new IntelligenceException(502, "Invalid Intelligence resource response");
            return result;
        }
        catch (Exception error) when (error is JsonException or NotSupportedException)
        {
            throw new IntelligenceException(502, "Invalid Intelligence resource response");
        }
    }

    private static bool InvalidMemory(MemorySummary? memory)
        => memory is null || memory.SourceThreadIds.Any(id => id is null);
}
