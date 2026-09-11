using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CopilotKit.Intelligence;

/// <summary>A raw snapshot response, or an unchanged response without a body.</summary>
public abstract record LearnedSkillsResult(string Revision, string ETag);
/// <summary>Raw ZIP bytes. The canonical client does not parse the archive.</summary>
public sealed record LearnedSkillsSnapshot(byte[] Bytes, string Revision, string ETag, string ContentType) : LearnedSkillsResult(Revision, ETag);
/// <summary>The server confirmed the conditional snapshot is unchanged.</summary>
public sealed record LearnedSkillsUnchanged(string Revision, string ETag) : LearnedSkillsResult(Revision, ETag);

/// <summary>A safe, typed delivery failure with an optional diagnostic cause.</summary>
public sealed class LearnedSkillsException : Exception
{
    /// <summary>The stable cross-language failure code.</summary>
    public string Code { get; }
    /// <summary>Whether the failure can recover without configuration changes.</summary>
    public bool Retryable { get; }
    /// <summary>Creates a failure. Unknown codes are rejected.</summary>
    public LearnedSkillsException(string code, bool retryable, Exception? cause = null)
        : base(Messages.TryGetValue(code, out var message) ? message : throw new ArgumentException("Unknown learned-skills error code.", nameof(code)), cause)
    {
        Code = code;
        Retryable = retryable;
    }
    /// <summary>Formats safe fields only; inspect InnerException explicitly for diagnostics.</summary>
    public override string ToString() => $"{GetType().FullName}: {Code}: {Message}";
    internal static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["INVALID_CONFIG"] = "Invalid learned-skills request configuration.",
        ["AUTHENTICATION_FAILED"] = "Learned-skills authentication failed.",
        ["AUTHORIZATION_FAILED"] = "Learned-skills access was denied.",
        ["ENTITLEMENT_REQUIRED"] = "Learned-skills delivery requires an entitlement.",
        ["DELIVERY_DISABLED"] = "Learned-skills delivery is disabled.",
        ["CONTAINER_NOT_FOUND"] = "The learning container was not found.",
        ["REVISION_NOT_FOUND"] = "The learned-skills revision was not found.",
        ["REVISION_REVOKED"] = "The learned-skills revision was revoked.",
        ["NETWORK_ERROR"] = "The learned-skills request failed during transport.",
        ["TIMEOUT"] = "The learned-skills request timed out.",
        ["INVALID_SNAPSHOT"] = "The learned-skills response metadata is invalid.",
        ["UNSUPPORTED_SERVER"] = "The server returned an unsupported learned-skills response."
    };
}

public sealed partial class IntelligenceClient
{
    /// <summary>Reads raw learned-skill delivery using this client's credentials and HTTP pool.</summary>
    public async Task<LearnedSkillsResult> GetLearnedSkillsSnapshotAsync(string containerId, string? revision = null,
        string? ifNoneMatch = null, CancellationToken cancellationToken = default)
    {
        EnsureActive();
        if (string.IsNullOrWhiteSpace(containerId) || containerId is "." or ".."
            || revision is not null && string.IsNullOrWhiteSpace(revision)
            || ifNoneMatch is not null && !IsSkillsETag(ifNoneMatch))
            throw new LearnedSkillsException("INVALID_CONFIG", false);
        cancellationToken.ThrowIfCancellationRequested();
        var path = "/api/v1/learning/containers/" + Uri.EscapeDataString(containerId) + "/skills";
        if (revision is not null) path += "?revision=" + Uri.EscapeDataString(revision);
        using var request = new HttpRequestMessage(HttpMethod.Get, options.ApiUrl.ToString().TrimEnd('/') + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/zip"));
        if (ifNoneMatch is not null) request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(options.RequestTimeout);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.NotModified))
                throw await SkillsResponseErrorAsync(response, deadline.Token);
            var responseRevision = SingleSkillsHeader(response, "X-CopilotKit-Skills-Revision");
            var etag = SingleSkillsHeader(response, "ETag");
            if (string.IsNullOrWhiteSpace(responseRevision) || etag is null || !IsSkillsETag(etag)
                || revision is not null && revision != responseRevision)
                throw new LearnedSkillsException("INVALID_SNAPSHOT", false);
            if (response.StatusCode == HttpStatusCode.NotModified)
            {
                if (ifNoneMatch is null) throw new LearnedSkillsException("INVALID_SNAPSHOT", false);
                return new LearnedSkillsUnchanged(responseRevision, etag);
            }
            var contentType = response.Content.Headers.ContentType;
            if (contentType is null || !string.Equals(contentType.MediaType, "application/zip", StringComparison.OrdinalIgnoreCase))
                throw new LearnedSkillsException("INVALID_SNAPSHOT", false);
            var bytes = await response.Content.ReadAsByteArrayAsync(deadline.Token);
            deadline.Token.ThrowIfCancellationRequested();
            return new LearnedSkillsSnapshot(bytes, responseRevision, etag, contentType.ToString());
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException error) { throw new LearnedSkillsException("TIMEOUT", true, error); }
        catch (HttpRequestException error) { throw new LearnedSkillsException("NETWORK_ERROR", true, error); }
        catch (IOException error) { throw new LearnedSkillsException("NETWORK_ERROR", true, error); }
    }

    private static bool IsSkillsETag(string value) => value.Length == 66 && Regex.IsMatch(value, "^\"[a-f0-9]{64}\"$", RegexOptions.CultureInvariant);
    private static string? SingleSkillsHeader(HttpResponseMessage response, string name)
    {
        if (!response.Headers.TryGetValues(name, out var values)) return null;
        var items = values.Take(2).ToArray();
        return items.Length == 1 ? items[0] : null;
    }
    private static async Task<LearnedSkillsException> SkillsResponseErrorAsync(HttpResponseMessage response, CancellationToken token)
    {
        var denial = response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => "AUTHENTICATION_FAILED",
            HttpStatusCode.Forbidden => "AUTHORIZATION_FAILED",
            _ => null
        };
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            return new LearnedSkillsException("AUTHENTICATION_FAILED", false);
        LearnedSkillsException error = new("UNSUPPORTED_SERVER", false);
        try
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(token));
            if (body.RootElement.ValueKind == JsonValueKind.Object && body.RootElement.TryGetProperty("error", out var envelope)
                && envelope.ValueKind == JsonValueKind.Object
                && envelope.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String
                && LearnedSkillsException.Messages.ContainsKey(code.GetString()!)
                && envelope.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String
                && envelope.TryGetProperty("category", out var category) && category.ValueKind == JsonValueKind.String
                && envelope.TryGetProperty("retryable", out var retryable) && retryable.ValueKind is JsonValueKind.True or JsonValueKind.False)
                error = new LearnedSkillsException(code.GetString()!, retryable.GetBoolean());
        }
        catch (JsonException) { }
        catch (Exception cause) when (denial is not null && cause is HttpRequestException or IOException or OperationCanceledException)
        {
            return new LearnedSkillsException(denial, false, cause);
        }
        if (response.StatusCode == HttpStatusCode.Unauthorized) return new LearnedSkillsException(denial!, false);
        if (denial is not null && error.Code is not ("AUTHENTICATION_FAILED" or "AUTHORIZATION_FAILED" or "ENTITLEMENT_REQUIRED"
            or "DELIVERY_DISABLED" or "CONTAINER_NOT_FOUND" or "REVISION_NOT_FOUND" or "REVISION_REVOKED"))
            return new LearnedSkillsException(denial, false);
        return error;
    }
}
