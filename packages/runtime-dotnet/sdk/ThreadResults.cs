using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>Thread metadata without message history.</summary>
public sealed record ThreadSummary
{
    /// <summary>The canonical thread ID.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    /// <summary>The display name, or null for an unnamed thread.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }
    /// <summary>The timestamp of the most recent run, when present.</summary>
    [JsonPropertyName("lastRunAt"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastRunAt { get; init; }
    /// <summary>The timestamp of the most recent metadata update, when present.</summary>
    [JsonPropertyName("lastUpdatedAt"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastUpdatedAt { get; init; }
    /// <summary>The creation timestamp, when present.</summary>
    [JsonPropertyName("createdAt"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CreatedAt { get; init; }
    /// <summary>The update timestamp, when present.</summary>
    [JsonPropertyName("updatedAt"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? UpdatedAt { get; init; }
    /// <summary>Whether the thread is archived, when present.</summary>
    [JsonPropertyName("archived"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Archived { get; init; }
    /// <summary>The agent that owns the thread, when present.</summary>
    [JsonPropertyName("agentId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AgentId { get; init; }
    /// <summary>The user that created the thread, when present.</summary>
    [JsonPropertyName("createdById"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CreatedById { get; init; }
    /// <summary>The organization that owns the thread, when present.</summary>
    [JsonPropertyName("organizationId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? OrganizationId { get; init; }
    /// <summary>Additional platform fields with their original JSON values.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>A page of threads with its cursor and realtime join credentials.</summary>
public sealed record ListThreadsResponse
{
    /// <summary>The threads on this page.</summary>
    [JsonPropertyName("threads")]
    public required IReadOnlyList<ThreadSummary> Threads { get; init; }
    /// <summary>The realtime join code.</summary>
    [JsonPropertyName("joinCode")]
    public required string JoinCode { get; init; }
    /// <summary>The short-lived realtime join token, when present.</summary>
    [JsonPropertyName("joinToken"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? JoinToken { get; init; }
    /// <summary>The next-page cursor, or null when no further page exists.</summary>
    [JsonPropertyName("nextCursor"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NextCursor { get; init; }
    /// <summary>Additional response fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}
