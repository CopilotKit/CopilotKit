using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace CopilotKit.Intelligence;

/// <summary>A conditional read of one container in a batch.</summary>
public sealed record LearnedSkillsBatchRequest(string ContainerId, string? Revision = null, string? IfNoneMatch = null);
/// <summary>One independent delivery outcome.</summary>
public sealed record LearnedSkillsBatchResult(LearnedSkillsResult? Result, LearnedSkillsException? Error);

public sealed partial class IntelligenceClient
{
    /// <summary>Reads 1–50 containers in one request. Malformed envelopes fail the entire batch.</summary>
    public async Task<IReadOnlyDictionary<string, LearnedSkillsBatchResult>> GetLearnedSkillsSnapshotsAsync(
        IReadOnlyList<LearnedSkillsBatchRequest> containers, CancellationToken cancellationToken = default)
    {
        EnsureActive();
        if (containers is null || containers.Count is < 1 or > 50) throw new LearnedSkillsException("INVALID_CONFIG", false);
        var sources = containers.ToArray();
        var requested = new Dictionary<string, LearnedSkillsBatchRequest>(StringComparer.Ordinal);
        foreach (var source in sources)
        {
            if (source is null || string.IsNullOrWhiteSpace(source.ContainerId) || source.ContainerId is "." or ".."
                || source.Revision is not null && string.IsNullOrWhiteSpace(source.Revision)
                || source.IfNoneMatch is not null && !IsSkillsETag(source.IfNoneMatch)
                || !requested.TryAdd(source.ContainerId, source)) throw new LearnedSkillsException("INVALID_CONFIG", false);
            try { _ = new UTF8Encoding(false, true).GetByteCount(source.ContainerId); }
            catch (EncoderFallbackException cause) { throw new LearnedSkillsException("INVALID_CONFIG", false, cause); }
        }
        cancellationToken.ThrowIfCancellationRequested();
        using var request = new HttpRequestMessage(HttpMethod.Post, options.ApiUrl.ToString().TrimEnd('/') + "/api/v1/learning/skills/batch");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        request.Content = JsonContent.Create(new { containers = sources.Select(source => {
            var item = new Dictionary<string, string> { ["containerId"] = source.ContainerId };
            if (source.Revision is not null) item["revision"] = source.Revision;
            if (source.IfNoneMatch is not null) item["ifNoneMatch"] = source.IfNoneMatch;
            return item;
        }) });
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(options.RequestTimeout);
        LearnedSkillsException? observedDenial = null;
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (response.StatusCode != HttpStatusCode.OK) throw await SkillsResponseErrorAsync(response, deadline.Token);
            if (response.Content.Headers.ContentType?.MediaType != "application/json") throw InvalidBatch();
            using var document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(deadline.Token));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("containers", out var entries)
                || entries.ValueKind != JsonValueKind.Array) throw InvalidBatch();
            foreach (var entry in entries.EnumerateArray())
            {
                if (entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("containerId", out var id)
                    && id.ValueKind == JsonValueKind.String && requested.ContainsKey(id.GetString()!)
                    && entry.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String && status.GetString() == "error"
                    && entry.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object
                    && error.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String
                    && code.GetString() is "AUTHENTICATION_FAILED" or "AUTHORIZATION_FAILED" or "ENTITLEMENT_REQUIRED" or "DELIVERY_DISABLED" or "CONTAINER_NOT_FOUND" or "REVISION_NOT_FOUND" or "REVISION_REVOKED")
                    observedDenial = new LearnedSkillsException(code.GetString()!, false);
            }
            if (entries.GetArrayLength() != sources.Length || DuplicateProperties(root)) throw InvalidBatch();
            var results = new Dictionary<string, LearnedSkillsBatchResult>(StringComparer.Ordinal);
            foreach (var entry in entries.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object) throw InvalidBatch();
                var id = BatchString(entry, "containerId");
                if (!requested.TryGetValue(id, out var source) || results.ContainsKey(id)) throw InvalidBatch();
                var status = BatchString(entry, "status");
                if (status == "error")
                {
                    if (!entry.TryGetProperty("error", out var error) || error.ValueKind != JsonValueKind.Object) throw InvalidBatch();
                    var code = BatchString(error, "code");
                    if (!LearnedSkillsException.Messages.ContainsKey(code) || !error.TryGetProperty("retryable", out var retryable)
                        || retryable.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw InvalidBatch();
                    results.Add(id, new(null, new LearnedSkillsException(code, retryable.GetBoolean())));
                    continue;
                }
                var revision = BatchString(entry, "revision");
                var etag = BatchString(entry, "etag");
                if (string.IsNullOrWhiteSpace(revision) || !IsSkillsETag(etag) || source.Revision is not null && revision != source.Revision) throw InvalidBatch();
                LearnedSkillsResult result;
                if (status == "unchanged")
                {
                    if (source.IfNoneMatch != etag || entry.TryGetProperty("bytesBase64", out _)) throw InvalidBatch();
                    result = new LearnedSkillsUnchanged(revision, etag);
                }
                else if (status == "snapshot")
                {
                    var contentType = BatchString(entry, "contentType");
                    if (contentType != "application/zip") throw InvalidBatch();
                    var encoded = BatchString(entry, "bytesBase64");
                    var bytes = Convert.FromBase64String(encoded);
                    if (Convert.ToBase64String(bytes) != encoded) throw InvalidBatch();
                    result = new LearnedSkillsSnapshot(bytes, revision, etag, contentType);
                }
                else throw InvalidBatch();
                results.Add(id, new(result, null));
            }
            deadline.Token.ThrowIfCancellationRequested();
            return results;
        }
        catch (LearnedSkillsException error) when (error.Code == "INVALID_SNAPSHOT" && observedDenial is not null) { throw observedDenial; }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException cause) { throw new LearnedSkillsException("TIMEOUT", true, cause); }
        catch (HttpRequestException cause) { throw new LearnedSkillsException("NETWORK_ERROR", true, cause); }
        catch (IOException cause) { throw new LearnedSkillsException("NETWORK_ERROR", true, cause); }
        catch (Exception cause) when (cause is JsonException or FormatException) { throw observedDenial ?? new LearnedSkillsException("INVALID_SNAPSHOT", false, cause); }
    }

    private static bool DuplicateProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            return value.EnumerateObject().Any(property => !names.Add(property.Name) || DuplicateProperties(property.Value));
        }
        return value.ValueKind == JsonValueKind.Array && value.EnumerateArray().Any(DuplicateProperties);
    }

    private static LearnedSkillsException InvalidBatch() => new("INVALID_SNAPSHOT", false);
    private static string BatchString(JsonElement entry, string name) => entry.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString()! : throw InvalidBatch();
}
