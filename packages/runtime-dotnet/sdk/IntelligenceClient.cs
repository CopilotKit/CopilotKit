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
    /// <summary>The maximum duration of one request, including its response body.</summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(30);
}

/// <summary>A safe platform error that retains the HTTP status without response bodies.</summary>
public sealed class IntelligenceException(int statusCode, string message) : Exception(message)
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
    public async Task<JsonObject> GetThreadAsync(string threadId, string userId, CancellationToken cancellationToken = default)
    {
        return Thread(await RequestAsync(HttpMethod.Get, "/api/threads/" + Segment(threadId) + "?userId=" + Segment(userId), cancellationToken: cancellationToken));
    }

    private async Task<JsonNode?> RequestAsync(HttpMethod method, string path, JsonNode? body = null,
        CancellationToken cancellationToken = default, Dictionary<string, string>? headers = null)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        using var request = new HttpRequestMessage(method, options.ApiUrl.ToString().TrimEnd('/') + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        if (headers is not null)
            foreach (var header in headers) request.Headers.Add(header.Key, header.Value);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.RequestTimeout);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
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
            return bytes.Length == 0 ? null : JsonNode.Parse(bytes.GetBuffer().AsSpan(0, (int)bytes.Length));
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

    private static JsonObject Thread(JsonNode? node)
    {
        if (node is not JsonObject envelope || envelope["thread"] is not JsonObject thread
            || thread["id"] is not JsonValue id || !id.TryGetValue<string>(out var value) || string.IsNullOrWhiteSpace(value))
            throw new IntelligenceException(502, "Invalid Intelligence thread response");
        return thread;
    }

    /// <summary>Releases connections owned by this SDK.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        if (ownsHttp) http.Dispose();
    }
}
