using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class InspectorRuntimeTests
{
    /// <summary>Exercise metadata sanitization, HTTP boundaries, and provider failures through real routes.</summary>
    internal static async Task RunAsync()
    {
        using var handler = new PlatformHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions
        {
            ApiKey = "server-key", ApiUrl = new Uri("https://platform.test")
        }, http);
        var identified = 0;
        var errors = new ConcurrentQueue<RuntimeError>();
        await using var runtime = new IntelligenceRuntime(new RuntimeOptions
        {
            Intelligence = sdk, TelemetryDisabled = true,
            Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
            AllowedOrigins = new HashSet<string> { "https://app.test" },
            IdentifyUser = (_, _) => { Interlocked.Increment(ref identified); return ValueTask.FromResult<RuntimeUser?>(null); },
            OnError = error => { errors.Enqueue(error); throw new InvalidOperationException("reporter failure"); }
        });
        // Isolate the short deadline from successful requests and cold startup.
        using var timeoutSdk = new IntelligenceClient(new IntelligenceOptions
        {
            ApiKey = "server-key", ApiUrl = new Uri("https://platform.test"), RequestTimeout = TimeSpan.FromSeconds(1)
        }, http);
        await using var timeoutRuntime = new IntelligenceRuntime(new RuntimeOptions
        {
            Intelligence = timeoutSdk, TelemetryDisabled = true,
            Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
            IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(null),
            OnError = error => errors.Enqueue(error)
        });
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        runtime.Map(app);
        timeoutRuntime.Map(app, "/timeout");
        await app.StartAsync();
        using var browser = new HttpClient
        {
            BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()),
            Timeout = TimeSpan.FromSeconds(5)
        };
        try
        {
            using var info = await browser.GetAsync("/copilotkit/info");
            var discovery = await info.Content.ReadFromJsonAsync<JsonObject>();
            Check(discovery?["inspectorMetadata"]?.GetValue<bool>() == true, "info advertises Inspector metadata without fetching it");
            Check(handler.MetadataCalls == 0 && identified == 0, "discovery does not fetch metadata or identify an app user");

            handler.Responses.Enqueue((200, """
                {"schemaVersion":1,"identity":{"organizationName":" Org ","projectName":" Project "},
                "license":{"state":"invalid"},"usage":{"used":0,"limit":{"kind":"unknown"}},
                "action":{"kind":"renew","url":"https://example.com?secret=hidden"},"secret":"provider-secret-payload"}
                """));
            using var request = new HttpRequestMessage(HttpMethod.Get, "/copilotkit/inspector-metadata");
            request.Headers.Add("Authorization", "Bearer browser-key");
            request.Headers.Add("Cookie", "session=browser-secret");
            request.Headers.Add("Origin", "https://app.test");
            using var response = await browser.SendAsync(request);
            var metadata = await response.Content.ReadFromJsonAsync<JsonObject>();

            Check(response.StatusCode == HttpStatusCode.OK, $"metadata route returns JSON (status: {response.StatusCode})");
            Check(response.Headers.CacheControl is { NoStore: true, Private: true }, "metadata route returns private no-store JSON");
            Check(JsonNode.DeepEquals(metadata, JsonNode.Parse("""{"schemaVersion":1,"identity":{"organizationName":"Org","projectName":"Project"},"usage":{"used":0,"limit":{"kind":"unknown"}}}""")), "Runtime returns only sanitized metadata modules");
            Check(handler.Authorization == "Bearer server-key" && handler.Cookie is null && identified == 0, "public metadata uses SDK credentials without browser credentials or app-user authentication");
            Check(response.Headers.GetValues("Access-Control-Allow-Origin").Single() == "https://app.test", "metadata retains allowed-origin CORS headers");

            foreach (var (status, body, reportsError) in new[]
            {
                (204, "provider-secret-payload", false), (404, "provider-secret-payload", false),
                (200, "{\"schemaVersion\":2}", false), (200, "null", false),
                (200, "", true), (200, "provider-secret-payload", true),
                (401, "provider-secret-payload", true), (503, "provider-secret-payload", true),
                (0, "timeout", true), (-1, "transport", true)
            })
            {
                handler.Responses.Enqueue((status, body));
                var previousErrors = errors.Count;
                using var absent = await browser.GetAsync(status == 0 ? "/timeout/inspector-metadata" : "/copilotkit/inspector-metadata");
                Check(absent.StatusCode == HttpStatusCode.NoContent && (await absent.Content.ReadAsByteArrayAsync()).Length == 0
                    && absent.Content.Headers.ContentType is null && absent.Headers.CacheControl is { NoStore: true, Private: true }, "metadata absence and provider failures return private empty 204: " + status + "/" + body);
                Check(errors.Count == previousErrors + (reportsError ? 1 : 0), "metadata reports provider errors without failing when the reporter throws");
            }
            Check(handler.PendingRequestCancelled, "metadata deadline cancels the pending provider request");
            Check(errors.All(error => error.Operation == "inspector.metadata" && error.Code == "INSPECTOR_METADATA_FAILED"), "metadata errors carry a stable operation and code");

            var calls = handler.MetadataCalls;
            using var wrongMethod = await browser.PostAsJsonAsync("/copilotkit/inspector-metadata", new { });
            Check(wrongMethod.StatusCode == HttpStatusCode.MethodNotAllowed && wrongMethod.Content.Headers.Allow.Contains("GET"), "metadata rejects non-GET methods with Allow GET");
            using var blockedRequest = new HttpRequestMessage(HttpMethod.Get, "/copilotkit/inspector-metadata");
            blockedRequest.Headers.Add("Origin", "https://blocked.test");
            using var blocked = await browser.SendAsync(blockedRequest);
            Check(blocked.StatusCode == HttpStatusCode.Forbidden && handler.MetadataCalls == calls && identified == 0, "origin and method rejection occurs before metadata I/O or authentication");
            using var protectedRequest = await browser.GetAsync("/copilotkit/threads");
            Check(protectedRequest.StatusCode == HttpStatusCode.Unauthorized && identified == 1, "public metadata does not make thread routes public");
        }
        finally { await app.StopAsync(); }
    }

    /// <summary>Fail the executable test suite with the violated contract name.</summary>
    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }

    /// <summary>Serve queued metadata fixtures and await the real cancellation token for timeouts.</summary>
    private sealed class PlatformHandler : HttpMessageHandler
    {
        internal ConcurrentQueue<(int Status, string Body)> Responses { get; } = new();
        internal int MetadataCalls { get; private set; }
        internal string? Authorization { get; private set; }
        internal string? Cookie { get; private set; }
        internal bool PendingRequestCancelled { get; private set; }

        /// <summary>Capture forwarded credentials and simulate provider responses without network I/O.</summary>
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath == "/api/entitlements/runtime")
                return new(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"unavailable\"}") };
            if (request.RequestUri.AbsolutePath != "/api/inspector/metadata") throw new Exception("unexpected platform path");
            MetadataCalls++;
            Authorization = request.Headers.Authorization?.ToString();
            Cookie = request.Headers.TryGetValues("Cookie", out var cookies) ? string.Join(",", cookies) : null;
            if (!Responses.TryDequeue(out var response)) throw new Exception("unexpected metadata request");
            if (response.Status == 0)
            {
                try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    PendingRequestCancelled = true;
                    throw;
                }
            }
            if (response.Status == -1) throw new HttpRequestException("provider-secret-payload");
            return new((HttpStatusCode)response.Status) { Content = new StringContent(response.Body) };
        }
    }
}
