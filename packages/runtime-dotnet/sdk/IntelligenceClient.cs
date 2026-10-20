using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>Server-owned credentials and endpoints for the standalone SDK.</summary>
public sealed class IntelligenceOptions
{
    /// <summary>The server-side Intelligence API key.</summary>
    public required string ApiKey { get; init; }
    /// <summary>The Intelligence HTTP API endpoint.</summary>
    public Uri ApiUrl { get; init; } = new("https://api.intelligence.copilotkit.ai");
    /// <summary>The runner gateway endpoint, without the final websocket suffix.</summary>
    public Uri RunnerUrl { get; init; } = new("wss://realtime.intelligence.copilotkit.ai/runner");
    /// <summary>The browser gateway endpoint.</summary>
    public Uri ClientUrl { get; init; } = new("wss://realtime.intelligence.copilotkit.ai/client");
    /// <summary>The maximum duration of one request, including its response body.</summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(30);
}

/// <summary>A safe platform error that retains the HTTP status without response bodies.</summary>
public class IntelligenceException(int statusCode, string message) : Exception(message)
{
    /// <summary>The platform status, or 502 for an invalid response or transport failure.</summary>
    public int StatusCode { get; } = statusCode;
}

/// <summary>A reusable Intelligence client with no HTTP host or agent requirement.</summary>
public sealed partial class IntelligenceClient : IDisposable
{
    private readonly IntelligenceOptions options;
    private readonly HttpClient http;
    private readonly bool ownsHttp;
    private int disposed;
    internal IntelligenceOptions Configuration => options;
    internal void EnsureActive() => ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);

    /// <summary>Creates a client. A supplied HTTP client remains application-owned.</summary>
    public IntelligenceClient(IntelligenceOptions options, HttpClient? httpClient = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentException.ThrowIfNullOrWhiteSpace(options.ApiKey);
        if (options.ApiUrl is null || !options.ApiUrl.IsAbsoluteUri || options.ApiUrl.Scheme is not ("http" or "https")
            || string.IsNullOrEmpty(options.ApiUrl.Host) || !string.IsNullOrEmpty(options.ApiUrl.UserInfo)
            || !string.IsNullOrEmpty(options.ApiUrl.Query) || !string.IsNullOrEmpty(options.ApiUrl.Fragment))
            throw new ArgumentException("ApiUrl must be HTTP(S), without credentials, query, or fragment.", nameof(options));
        if (options.RequestTimeout <= TimeSpan.Zero || options.RequestTimeout.TotalMilliseconds > uint.MaxValue - 1)
            throw new ArgumentException("RequestTimeout must be positive and at most 4294967294 milliseconds.", nameof(options));
        foreach (var endpoint in new[] { options.RunnerUrl, options.ClientUrl })
        {
            if (endpoint is null || !endpoint.IsAbsoluteUri || endpoint.Scheme is not ("ws" or "wss" or "http" or "https")
                || string.IsNullOrEmpty(endpoint.Host) || !string.IsNullOrEmpty(endpoint.UserInfo)
                || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
                throw new ArgumentException("Gateway URLs must be WS(S) or HTTP(S), without credentials, query, or fragment.", nameof(options));
        }
        this.options = options;
        http = httpClient ?? new HttpClient(new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2)
        }) { Timeout = Timeout.InfiniteTimeSpan };
        ownsHttp = httpClient is null;
    }

    /// <summary>Reads a thread with an explicit application-user scope.</summary>
    public async Task<ThreadSummary> GetThreadAsync(string threadId, string userId, CancellationToken cancellationToken = default)
    {
        return await RequestThreadAsync(HttpMethod.Get, "/api/threads/" + Segment(threadId) + "?userId=" + Segment(userId), cancellationToken: cancellationToken);
    }

    internal async Task<JsonNode?> RequestAsync(HttpMethod method, string path, JsonNode? body = null,
        CancellationToken cancellationToken = default, Dictionary<string, string>? headers = null,
        bool inspectorMetadata = false)
        => (await RequestResultAsync(method, path, body, cancellationToken, headers, inspectorMetadata)).Body;

    private async Task<ThreadSummary> RequestThreadAsync(HttpMethod method, string path, JsonNode? body = null,
        CancellationToken cancellationToken = default)
    {
        var result = await RequestResultAsync(method, path, body, cancellationToken);
        return result.Thread ?? Thread(result.Body);
    }

    private async Task<(JsonNode? Body, ThreadSummary? Thread)> RequestResultAsync(HttpMethod method, string path, JsonNode? body = null,
        CancellationToken cancellationToken = default, Dictionary<string, string>? headers = null,
        bool inspectorMetadata = false)
    {
        EnsureActive();
        using var request = new HttpRequestMessage(method, options.ApiUrl.ToString().TrimEnd('/') + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        if (headers is not null)
            foreach (var header in headers) request.Headers.Add(header.Key, header.Value);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(inspectorMetadata && options.RequestTimeout > TimeSpan.FromSeconds(5)
            ? TimeSpan.FromSeconds(5) : options.RequestTimeout);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (inspectorMetadata && response.StatusCode is System.Net.HttpStatusCode.NoContent or System.Net.HttpStatusCode.NotFound)
                return (null, null);
            if (!response.IsSuccessStatusCode) throw new IntelligenceException((int)response.StatusCode, "Intelligence request rejected");
            const int maxResponseBytes = 16 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > maxResponseBytes)
                throw new IntelligenceException(502, "Intelligence response exceeds 16 MiB");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var bytes = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer, timeout.Token)) > 0)
            {
                if (bytes.Length + count > maxResponseBytes)
                    throw new IntelligenceException(502, "Intelligence response exceeds 16 MiB");
                bytes.Write(buffer, 0, count);
            }
            if (inspectorMetadata && bytes.Length == 0) throw new IntelligenceException(502, "Invalid Intelligence response");
            var result = bytes.Length == 0 ? null : JsonNode.Parse(bytes.GetBuffer().AsSpan(0, (int)bytes.Length));
            return (result, NotifyThreadMutation(method, path, body, result));
        }
        catch (JsonException) { throw new IntelligenceException(502, "Invalid Intelligence response"); }
        catch (HttpRequestException) { throw new IntelligenceException(502, "Intelligence connection failed"); }
        catch (IOException) { throw new IntelligenceException(502, "Intelligence connection failed"); }
    }

    private static string Segment(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        if (value is "." or "..") throw new ArgumentException("Identifier must not be a dot segment.", nameof(value));
        return Uri.EscapeDataString(value);
    }

    private static JsonObject Object(JsonNode? node) => node as JsonObject ?? throw new IntelligenceException(502, "Invalid Intelligence response");

    private static ThreadSummary Thread(JsonNode? node)
    {
        if (node is not JsonObject envelope || envelope["thread"] is not JsonObject thread
            || thread["id"] is not JsonValue id || !id.TryGetValue<string>(out var value) || string.IsNullOrWhiteSpace(value))
            throw new IntelligenceException(502, "Invalid Intelligence thread response");
        return Resource<ThreadSummary>(thread);
    }

    /// <summary>Cancels entitlement lookups, clears their cache, and releases SDK-owned connections.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lock (entitlementGate)
        {
            entitlementCache = null;
            var pending = entitlementFlight;
            entitlementFlight = null;
            pending?.Cancellation.Cancel();
        }
        if (ownsHttp) http.Dispose();
    }
}
