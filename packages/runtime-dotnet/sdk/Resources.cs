using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>One access level in a trusted Memory grant.</summary>
public enum MemoryAccess
{
    /// <summary>No access.</summary>
    None,
    /// <summary>Read access.</summary>
    Read,
    /// <summary>Read and write access.</summary>
    ReadWrite
}

/// <summary>Application-owned access limits for user and project Memory.</summary>
public sealed record MemoryGrant(MemoryAccess User, MemoryAccess Project);

/// <summary>The result of a thread lookup with concurrent creation support.</summary>
public sealed record ThreadResolution(
    [property: JsonPropertyName("thread")] ThreadSummary Thread,
    [property: JsonPropertyName("created")] bool Created);

public sealed partial class IntelligenceClient
{
    /// <summary>Lists one user's threads for one agent, retaining subscription credentials and pagination.</summary>
    public async Task<ListThreadsResponse> ListThreadsAsync(string userId, string agentId, bool includeArchived = false,
        int? limit = null, string? cursor = null, CancellationToken cancellationToken = default)
    {
        var path = "/api/threads?userId=" + Segment(userId) + "&agentId=" + Segment(agentId);
        if (includeArchived) path += "&includeArchived=true";
        if (limit is not null) path += "&limit=" + limit.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (cursor is not null) path += "&cursor=" + Uri.EscapeDataString(cursor);
        return Resource<ListThreadsResponse>(await RequestAsync(HttpMethod.Get, path, cancellationToken: cancellationToken));
    }

    /// <summary>Creates a thread with an optional existing Learning Container ID.</summary>
    public async Task<ThreadSummary> CreateThreadAsync(string threadId, string userId, string agentId,
        string? name = null, string? learningContainerId = null, CancellationToken cancellationToken = default)
    {
        Segment(threadId); Segment(userId); Segment(agentId);
        var body = new JsonObject { ["threadId"] = threadId, ["userId"] = userId, ["agentId"] = agentId };
        if (name is not null) body["name"] = name;
        if (learningContainerId is not null) body["learningContainerId"] = learningContainerId;
        return await RequestThreadAsync(HttpMethod.Post, "/api/threads", body, cancellationToken);
    }

    /// <summary>Reads or creates a thread and resolves concurrent creation with a scoped read.</summary>
    public async Task<ThreadResolution> GetOrCreateThreadAsync(string threadId, string userId, string agentId,
        string? name = null, string? learningContainerId = null, CancellationToken cancellationToken = default)
    {
        try { return new(await GetThreadAsync(threadId, userId, cancellationToken), false); }
        catch (IntelligenceException error) when (error.StatusCode == 404) { }
        try { return new(await CreateThreadAsync(threadId, userId, agentId, name, learningContainerId, cancellationToken), true); }
        catch (IntelligenceException error) when (error.StatusCode == 409)
        {
            return new(await GetThreadAsync(threadId, userId, cancellationToken), false);
        }
    }

    /// <summary>Updates thread metadata without letting updates replace caller identity.</summary>
    public async Task<ThreadSummary> UpdateThreadAsync(string threadId, string userId, string agentId,
        JsonObject updates, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(updates);
        Segment(userId); Segment(agentId);
        var body = (JsonObject)updates.DeepClone();
        body["userId"] = userId; body["agentId"] = agentId;
        return await RequestThreadAsync(HttpMethod.Patch, "/api/threads/" + Segment(threadId), body, cancellationToken);
    }

    /// <summary>Archives a thread and retains its history.</summary>
    public Task ArchiveThreadAsync(string threadId, string userId, string agentId, CancellationToken cancellationToken = default)
        => UpdateThreadAsync(threadId, userId, agentId, new JsonObject { ["archived"] = true }, cancellationToken);

    /// <summary>Permanently deletes a thread and its history.</summary>
    public async Task DeleteThreadAsync(string threadId, string userId, string agentId, CancellationToken cancellationToken = default)
    {
        Segment(userId); Segment(agentId);
        await RequestAsync(HttpMethod.Delete, "/api/threads/" + Segment(threadId), new JsonObject
        {
            ["userId"] = userId, ["agentId"] = agentId,
            ["reason"] = $"Deleted via CopilotKit SDK (userId={userId}, agentId={agentId})"
        }, cancellationToken);
    }

    /// <summary>Reads persisted messages in chronological order.</summary>
    public async Task<ThreadMessagesResponse> GetThreadMessagesAsync(string threadId, string userId, CancellationToken cancellationToken = default)
        => Resource<ThreadMessagesResponse>(await RequestAsync(HttpMethod.Get, "/api/threads/" + Segment(threadId) + "/messages?userId=" + Segment(userId), cancellationToken: cancellationToken));

    /// <summary>Reads project-authorized events from the inspection API.</summary>
    public async Task<ThreadEventsResponse> GetThreadEventsAsync(string threadId, CancellationToken cancellationToken = default)
        => Resource<ThreadEventsResponse>(await RequestAsync(HttpMethod.Get, "/api/_inspect/threads/" + Segment(threadId) + "/events", cancellationToken: cancellationToken));

    /// <summary>Reads folded state and the snapshot-presence marker from the inspection API.</summary>
    public async Task<ThreadStateResponse> GetThreadStateAsync(string threadId, CancellationToken cancellationToken = default)
        => Resource<ThreadStateResponse>(await RequestAsync(HttpMethod.Get, "/api/_inspect/threads/" + Segment(threadId) + "/state", cancellationToken: cancellationToken));

    /// <summary>Lists Memory for an application user under an optional trusted grant.</summary>
    public async Task<ListMemoriesResponse> ListMemoriesAsync(string userId, MemoryGrant? grant = null,
        bool includeInvalidated = false, CancellationToken cancellationToken = default)
        => Resource<ListMemoriesResponse>(await RequestAsync(HttpMethod.Get, "/api/memories" + (includeInvalidated ? "?includeInvalidated=true" : ""),
            cancellationToken: cancellationToken, headers: MemoryHeaders(userId, grant)));

    /// <summary>Creates a memory and retains the platform's absorbed marker.</summary>
    public async Task<SaveMemoryResponse> CreateMemoryAsync(string userId, string content, string kind, string? scope = null,
        IReadOnlyList<string>? sourceThreadIds = null, MemoryGrant? grant = null, CancellationToken cancellationToken = default)
        => Resource<SaveMemoryResponse>(await RequestAsync(HttpMethod.Post, "/api/memories", MemoryBody(content, kind, scope, sourceThreadIds), cancellationToken, MemoryHeaders(userId, grant)));

    /// <summary>Supersedes a memory and returns its replacement and retired ID.</summary>
    public async Task<SaveMemoryResponse> UpdateMemoryAsync(string memoryId, string userId, string content, string kind, string? scope = null,
        IReadOnlyList<string>? sourceThreadIds = null, MemoryGrant? grant = null, CancellationToken cancellationToken = default)
        => Resource<SaveMemoryResponse>(await RequestAsync(HttpMethod.Patch, "/api/memories/" + Segment(memoryId), MemoryBody(content, kind, scope, sourceThreadIds), cancellationToken, MemoryHeaders(userId, grant)));

    /// <summary>Retires a memory without deleting its history.</summary>
    public async Task RemoveMemoryAsync(string memoryId, string userId, MemoryGrant? grant = null, CancellationToken cancellationToken = default)
        => await RequestAsync(HttpMethod.Delete, "/api/memories/" + Segment(memoryId), cancellationToken: cancellationToken, headers: MemoryHeaders(userId, grant));

    /// <summary>Recalls relevant memories with their relevance scores.</summary>
    public async Task<RecallMemoriesResponse> RecallMemoriesAsync(string userId, string query, int? limit = null, string? scope = null,
        MemoryGrant? grant = null, CancellationToken cancellationToken = default)
    {
        var body = new JsonObject { ["query"] = query };
        if (limit is not null) body["limit"] = limit;
        if (scope is not null) body["scope"] = scope;
        return Resource<RecallMemoriesResponse>(await RequestAsync(HttpMethod.Post, "/api/memories/recall", body, cancellationToken, MemoryHeaders(userId, grant)));
    }

    /// <summary>Writes an annotation. Reuse the client event ID for an idempotent retry.</summary>
    public async Task<AnnotateResponse> AnnotateAsync(string userId, string threadId, string type, string? clientEventId = null,
        JsonObject? payload = null, string? occurredAt = null, CancellationToken cancellationToken = default)
    {
        Segment(userId); Segment(threadId); ArgumentException.ThrowIfNullOrWhiteSpace(type);
        var body = new JsonObject { ["type"] = type, ["userId"] = userId, ["threadId"] = threadId };
        if (payload is not null) body["payload"] = payload.DeepClone();
        if (occurredAt is not null) body["occurredAt"] = occurredAt;
        return Resource<AnnotateResponse>(await RequestAsync(HttpMethod.Put, "/connector/annotate/" + Segment(clientEventId ?? Guid.NewGuid().ToString()), body, cancellationToken));
    }

    private static JsonObject MemoryBody(string content, string kind, string? scope, IReadOnlyList<string>? sourceThreadIds)
    {
        var body = new JsonObject
        {
            ["content"] = content, ["kind"] = kind,
            ["sourceThreadIds"] = new JsonArray((sourceThreadIds ?? []).Select(id => (JsonNode?)JsonValue.Create(id)).ToArray())
        };
        if (scope is not null) body["scope"] = scope;
        return body;
    }

    private static Dictionary<string, string> MemoryHeaders(string userId, MemoryGrant? grant)
    {
        Segment(userId);
        var headers = new Dictionary<string, string> { ["x-cpki-user-id"] = userId };
        if (grant is not null) headers["x-cpki-memory-grant"] = new JsonObject
        {
            ["user"] = Access(grant.User), ["project"] = Access(grant.Project)
        }.ToJsonString();
        return headers;
    }

    private static string Access(MemoryAccess access) => access switch
    {
        MemoryAccess.None => "none", MemoryAccess.Read => "read", MemoryAccess.ReadWrite => "read-write",
        _ => throw new ArgumentOutOfRangeException(nameof(access), "Invalid memory access level")
    };
}
