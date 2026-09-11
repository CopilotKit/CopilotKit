using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace CopilotKit.Intelligence;

/// <summary>A trusted application user; resolve from your server authentication, never a browser-supplied ID.</summary>
public sealed record RuntimeUser(string Id, string? Name = null);

/// <summary>Runs an AG-UI agent natively or over HTTP. Cancellation must stop production and external calls.</summary>
public interface IRuntimeAgent
{
    string Description { get; }
    IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, CancellationToken cancellationToken);
}

/// <summary>Explicit configuration for the Intelligence platform. No local or open-source fallback exists.</summary>
public sealed class RuntimeOptions
{
    private static readonly Uri DefaultApiUrl = new("https://api.intelligence.copilotkit.ai");
    private static readonly Uri DefaultRunnerUrl = new("wss://realtime.intelligence.copilotkit.ai/runner");
    private static readonly Uri DefaultClientUrl = new("wss://realtime.intelligence.copilotkit.ai/client");
    private Uri? apiUrl;
    private Uri? runnerUrl;
    private Uri? clientUrl;
    private string? apiKey;
    private TimeSpan? requestTimeout;
    /// <summary>An application-owned SDK, shared with scripts or workers.</summary>
    public IntelligenceClient? Intelligence { get; init; }
    public Uri ApiUrl { get => apiUrl ?? Intelligence?.Configuration.ApiUrl ?? DefaultApiUrl; init => apiUrl = value; }
    public Uri RunnerUrl { get => runnerUrl ?? Intelligence?.Configuration.RunnerUrl ?? DefaultRunnerUrl; init => runnerUrl = value; }
    public Uri ClientUrl { get => clientUrl ?? Intelligence?.Configuration.ClientUrl ?? DefaultClientUrl; init => clientUrl = value; }
    public string ApiKey { get => apiKey ?? Intelligence?.Configuration.ApiKey ?? ""; init => apiKey = value; }
    public required Func<HttpContext, CancellationToken, ValueTask<RuntimeUser?>> IdentifyUser { get; init; }
    public required IReadOnlyDictionary<string, IRuntimeAgent> Agents { get; init; }
    public A2UIOptions? A2UI { get; init; }
    public IReadOnlyList<McpAppServer> McpAppsServers { get; init; } = [];
    public Func<HttpContext, RuntimeUser, CancellationToken, ValueTask<JsonObject?>>? MemoryGrant { get; init; }
    public Func<HttpContext, RuntimeUser, string, JsonObject, CancellationToken, ValueTask<string?>>? LearningContainer { get; init; }
    public IReadOnlySet<string> AllowedOrigins { get; init; } = new HashSet<string>();
    public TimeSpan RequestTimeout { get => requestTimeout ?? Intelligence?.Configuration.RequestTimeout ?? TimeSpan.FromSeconds(30); init => requestTimeout = value; }
    public TimeSpan AckTimeout { get; init; } = TimeSpan.FromSeconds(5);
    public TimeSpan DeliveryTimeout { get; init; } = TimeSpan.FromSeconds(60);
    public TimeSpan LockHeartbeatInterval { get; init; } = TimeSpan.FromSeconds(20);
    public int LockTtlSeconds { get; init; } = 60;
    public string? LockKeyPrefix { get; init; }
    public long MaxRequestBytes { get; init; } = 4 * 1024 * 1024;
    public bool TelemetryDisabled { get; init; }
    public double TelemetrySampleRate { get; init; } = 0.05;
    public string? TelemetryId { get; init; }
    /// <summary>Optional legacy JWT claim for analytics attribution only. This does not verify or grant access.</summary>
    public string? LicenseToken { get; init; }
    public Uri? TelemetryUrl { get; init; }
    public IRuntimeTelemetryExporter? TelemetryExporter { get; init; }
    /// <summary>Application-owned error reporting, separate from sampled analytics. Callback failures are isolated.</summary>
    public Action<RuntimeError>? OnError { get; init; }

    internal void Validate()
    {
        if (Intelligence is not null)
        {
            Intelligence.EnsureActive();
            var sdk = Intelligence.Configuration;
            if (ApiKey != sdk.ApiKey || ApiUrl != sdk.ApiUrl || RunnerUrl != sdk.RunnerUrl
                || ClientUrl != sdk.ClientUrl || RequestTimeout != sdk.RequestTimeout)
                throw new ArgumentException("Runtime platform configuration must match the injected Intelligence SDK.");
        }
        if (string.IsNullOrWhiteSpace(ApiKey)) throw new ArgumentException("An Intelligence API key is required.");
        if (!ApiUrl.IsAbsoluteUri || ApiUrl.Scheme is not ("http" or "https")) throw new ArgumentException("ApiUrl must be HTTP(S).");
        if (!RunnerUrl.IsAbsoluteUri || RunnerUrl.Scheme is not ("ws" or "wss" or "http" or "https")) throw new ArgumentException("RunnerUrl must be a WebSocket URL.");
        if (Agents.Count == 0 || Agents.Any(pair => string.IsNullOrWhiteSpace(pair.Key))) throw new ArgumentException("Register at least one named agent.");
        if (A2UI is not null && (A2UI.MaxAttempts < 1 || string.IsNullOrWhiteSpace(A2UI.ToolName) || A2UI.DebugExposure is not (null or "hidden" or "collapsed" or "verbose"))) throw new ArgumentException("Invalid A2UI configuration.");
        foreach (var server in McpAppsServers) server.Validate();
        if (RequestTimeout <= TimeSpan.Zero || AckTimeout <= TimeSpan.Zero || DeliveryTimeout < AckTimeout || LockTtlSeconds < 2 || LockHeartbeatInterval <= TimeSpan.Zero || LockHeartbeatInterval.TotalSeconds >= LockTtlSeconds) throw new ArgumentException("Invalid runtime timing configuration.");
    }
}

/// <summary>A safe HTTP boundary error. Messages contain no upstream bodies or credentials.</summary>
public sealed class RuntimeRequestException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>An error sent only to the host application callback, never to the analytics sink.</summary>
public sealed record RuntimeError(string Operation, string Code, Exception Exception);

/// <summary>Validates input before acquiring locks or invoking agents.</summary>
internal static class RuntimeValidation
{
    public static string RequiredString(JsonObject input, string field)
    {
        if (input[field] is not JsonValue value || !value.TryGetValue<string>(out var text) || string.IsNullOrWhiteSpace(text)) throw new RuntimeRequestException(400, $"Valid {field} is required");
        return text;
    }

    public static void ValidateRun(JsonObject input)
    {
        RequiredString(input, "threadId"); RequiredString(input, "runId");
        foreach (var field in new[] { "messages", "tools", "context" }) if (input[field] is not JsonArray) throw new RuntimeRequestException(400, $"{field} must be an array");
        foreach (var node in input["messages"]!.AsArray())
        {
            if (node is not JsonObject message) throw new RuntimeRequestException(400, "Invalid message");
            RequiredString(message, "id");
            if (RequiredString(message, "role") is not ("system" or "developer" or "user" or "assistant" or "tool" or "activity")) throw new RuntimeRequestException(400, "Invalid message role");
        }
        foreach (var node in input["tools"]!.AsArray())
        {
            if (node is not JsonObject tool || tool["parameters"] is not JsonObject) throw new RuntimeRequestException(400, "Invalid tool");
            RequiredString(tool, "name");
        }
    }
}

/// <summary>Assigns durable event identity once; retries preserve the immutable payload.</summary>
internal sealed class EventSequencer(string threadId, string runId)
{
    private long next = 1;
    /// <summary>Discard untrusted durable identity while retaining other agent metadata.</summary>
    public JsonObject StampAgentEvent(JsonObject source)
    {
        var value = (JsonObject)source.DeepClone();
        if (value["metadata"] is JsonObject metadata)
        {
            metadata.Remove("cpki_event_id"); metadata.Remove("cpki_event_seq");
        }
        return Stamp(value);
    }

    public JsonObject Stamp(JsonObject source)
    {
        var value = (JsonObject)source.DeepClone();
        value["threadId"] = threadId; value["runId"] = runId;
        var metadata = value["metadata"] as JsonObject ?? new JsonObject();
        if (metadata["cpki_event_id"] is JsonValue id && id.TryGetValue<string>(out _) && metadata["cpki_event_seq"] is JsonValue sequence && sequence.TryGetValue<long>(out var existing)) next = Math.Max(next, existing + 1);
        else { metadata["cpki_event_id"] ??= Guid.NewGuid().ToString(); metadata["cpki_event_seq"] = next++; }
        value["metadata"] = metadata;
        return value;
    }
}
