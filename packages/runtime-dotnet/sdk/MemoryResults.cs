using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>A stored memory with an optional recall score.</summary>
public record MemorySummary
{
    /// <summary>The platform-assigned memory ID.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    /// <summary>The memory kind.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }
    /// <summary>The user or project scope.</summary>
    [JsonPropertyName("scope")]
    public required string Scope { get; init; }
    /// <summary>The stored fact, preference, or procedure.</summary>
    [JsonPropertyName("content")]
    public required string Content { get; init; }
    /// <summary>The threads that contributed to this memory.</summary>
    [JsonPropertyName("sourceThreadIds")]
    public required IReadOnlyList<string> SourceThreadIds { get; init; }
    /// <summary>The retirement timestamp, or null for a live memory.</summary>
    [JsonPropertyName("invalidatedAt")]
    public required string? InvalidatedAt { get; init; }
    /// <summary>The recall relevance score, when present.</summary>
    [JsonPropertyName("score"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? Score { get; init; }
    /// <summary>Additional platform fields with their original JSON values.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>Memories visible to the application user under the supplied grant.</summary>
public sealed record ListMemoriesResponse
{
    /// <summary>The visible memories.</summary>
    [JsonPropertyName("memories")]
    public required IReadOnlyList<MemorySummary> Memories { get; init; }
    /// <summary>Additional response fields with their original JSON values.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>Memories that match a recall query.</summary>
public sealed record RecallMemoriesResponse
{
    /// <summary>The matching memories with their relevance scores.</summary>
    [JsonPropertyName("memories")]
    public required IReadOnlyList<MemorySummary> Memories { get; init; }
    /// <summary>Additional response fields with their original JSON values.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>The saved memory and optional merge or replacement markers.</summary>
public sealed record SaveMemoryResponse : MemorySummary
{
    /// <summary>Whether creation merged this content into a near-duplicate memory.</summary>
    [JsonPropertyName("absorbed"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Absorbed { get; init; }
    /// <summary>The ID of the memory that this update retired.</summary>
    [JsonPropertyName("retiredId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RetiredId { get; init; }
}
