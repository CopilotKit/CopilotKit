using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>A persisted tool call with JSON-encoded arguments.</summary>
public sealed record ThreadToolCall
{
    /// <summary>The tool call ID.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    /// <summary>The tool name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }
    /// <summary>The JSON-encoded arguments.</summary>
    [JsonPropertyName("args")]
    public required string Args { get; init; }
    /// <summary>Additional tool call fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>A persisted AG-UI message with optional structured content.</summary>
public sealed record ThreadMessage
{
    /// <summary>The message ID.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    /// <summary>The message role.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }
    /// <summary>The content; Undefined means absent, and Null means an explicit JSON null.</summary>
    [JsonPropertyName("content"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public JsonElement Content { get; init; }
    /// <summary>The AG-UI activity type, when present.</summary>
    [JsonPropertyName("activityType"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ActivityType { get; init; }
    /// <summary>The tool calls initiated by this message.</summary>
    [JsonPropertyName("toolCalls"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<ThreadToolCall>? ToolCalls { get; init; }
    /// <summary>The tool call that this result answers.</summary>
    [JsonPropertyName("toolCallId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ToolCallId { get; init; }
    /// <summary>Additional message fields, including protocol extensions.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>Persisted messages in chronological order.</summary>
public sealed record ThreadMessagesResponse
{
    /// <summary>The persisted messages.</summary>
    [JsonPropertyName("messages")]
    public required IReadOnlyList<ThreadMessage> Messages { get; init; }
    /// <summary>Additional response fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>A persisted AG-UI event with its protocol fields.</summary>
public sealed record ThreadInspectEvent
{
    /// <summary>The AG-UI event type.</summary>
    [JsonPropertyName("type")]
    public required string Type { get; init; }
    /// <summary>Event-specific fields and extension values.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>Persisted events with decode failures and the event-cap marker.</summary>
public sealed record ThreadEventsResponse
{
    /// <summary>The events in replay order.</summary>
    [JsonPropertyName("events")]
    public required IReadOnlyList<ThreadInspectEvent> Events { get; init; }
    /// <summary>The row IDs that the platform could not decode.</summary>
    [JsonPropertyName("decodeErrorRowIds")]
    public required IReadOnlyList<string> DecodeErrorRowIds { get; init; }
    /// <summary>Whether the platform reached its event cap.</summary>
    [JsonPropertyName("truncated")]
    public required bool Truncated { get; init; }
    /// <summary>Additional response fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>A snapshot, an absent snapshot, or a snapshot decode failure.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(ThreadNoSnapshot), "no-snapshot")]
[JsonDerivedType(typeof(ThreadSnapshotDecodeError), "snapshot-decode-error")]
[JsonDerivedType(typeof(ThreadSnapshot), "snapshot")]
public abstract record ThreadStateResponse
{
    /// <summary>Additional response fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}

/// <summary>The thread has no state snapshot.</summary>
public sealed record ThreadNoSnapshot : ThreadStateResponse;

/// <summary>The platform could not decode the stored snapshot.</summary>
public sealed record ThreadSnapshotDecodeError : ThreadStateResponse;

/// <summary>Folded thread state with the number of skipped deltas.</summary>
public sealed record ThreadSnapshot : ThreadStateResponse
{
    /// <summary>The folded state, including explicit JSON null.</summary>
    [JsonPropertyName("state")]
    public required JsonElement State { get; init; }
    /// <summary>The number of deltas the platform skipped.</summary>
    [JsonPropertyName("skippedDeltas")]
    public required int SkippedDeltas { get; init; }
}

/// <summary>The annotation ID and whether the platform recognized a repeated write.</summary>
public sealed record AnnotateResponse
{
    /// <summary>The database row ID, represented as a string.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }
    /// <summary>Whether this call repeated an existing annotation.</summary>
    [JsonPropertyName("duplicate")]
    public required bool Duplicate { get; init; }
    /// <summary>Additional response fields.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> ExtensionData { get; init; } = [];
}
