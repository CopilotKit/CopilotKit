using System.Net;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class SdkInjectionTests
{
    internal static async Task RunAsync()
    {
        using var handler = new SdkHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions
        {
            ApiKey = "sdk-key", ApiUrl = new Uri("https://sdk.test/base"),
            RunnerUrl = new Uri("wss://sdk.test/runner"), ClientUrl = new Uri("wss://sdk.test/client"),
            RequestTimeout = TimeSpan.FromSeconds(7)
        }, http);
        var options = new RuntimeOptions
        {
            Intelligence = sdk, Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
            IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted")),
            MemoryGrant = (_, _, _) => ValueTask.FromResult<JsonObject?>(new JsonObject { ["user"] = "read-write", ["project"] = "read" }),
            TelemetryDisabled = true
        };
        await using var runtime = new IntelligenceRuntime(options);
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        runtime.Map(app);
        await app.StartAsync();
        using var browser = new HttpClient
        {
            BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single())
        };

        using var threads = await browser.GetAsync("/copilotkit/threads?agentId=default");
        Check(threads.IsSuccessStatusCode && handler.Url == "https://sdk.test/base/api/threads?userId=trusted&agentId=default", "Runtime uses the injected SDK endpoint and trusted user");
        Check(handler.Authorization == "Bearer sdk-key", "Runtime uses the SDK credential without duplicate configuration");
        using var memories = await browser.GetAsync("/copilotkit/memories");
        Check(memories.IsSuccessStatusCode && handler.User == "trusted" && handler.Grant == "{\"user\":\"read-write\",\"project\":\"read\"}", "Runtime passes its trusted Memory grant through the SDK");
        Check(options.RunnerUrl == new Uri("wss://sdk.test/runner") && options.ClientUrl == new Uri("wss://sdk.test/client") && options.RequestTimeout == TimeSpan.FromSeconds(7), "Runtime derives gateway endpoints and deadline from the SDK");
        handler.Status = HttpStatusCode.Forbidden;
        using var denied = await browser.GetAsync("/copilotkit/threads?agentId=default");
        Check(denied.StatusCode == HttpStatusCode.Forbidden, "SDK platform status survives the Runtime boundary");
        handler.Status = HttpStatusCode.OK;

        await app.StopAsync();
        await runtime.DisposeAsync();
        var thread = await sdk.GetThreadAsync("thread", "trusted");

        Check(thread.Id == "thread" && !handler.Disposed, "Runtime shutdown leaves the borrowed SDK usable");
        await RejectsConflictingConfiguration(sdk, http);
        await DisposesOnlyOwnedSdk();
        await RejectsDisposedSdk();
    }

    private static RuntimeOptions Configuration(IntelligenceClient? sdk = null, string key = "sdk-key", string api = "https://sdk.test/base",
        string runner = "wss://sdk.test/runner", string client = "wss://sdk.test/client", int seconds = 7) => new()
    {
        Intelligence = sdk, ApiKey = key, ApiUrl = new Uri(api), RunnerUrl = new Uri(runner), ClientUrl = new Uri(client),
        RequestTimeout = TimeSpan.FromSeconds(seconds), TelemetryDisabled = true,
        Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
        IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted"))
    };

    private static async Task RejectsConflictingConfiguration(IntelligenceClient sdk, HttpClient http)
    {
        foreach (var config in new[]
        {
            Configuration(sdk, key: "other-key"), Configuration(sdk, api: "https://other.test"),
            Configuration(sdk, runner: "wss://other.test/runner"), Configuration(sdk, client: "wss://other.test/client"),
            Configuration(sdk, seconds: 8)
        })
        {
            try { await using var runtime = new IntelligenceRuntime(config); throw new Exception("conflicting SDK configuration was accepted"); }
            catch (ArgumentException) { Check(true, "Runtime rejects conflicting SDK configuration"); }
        }
        try { await using var runtime = new IntelligenceRuntime(Configuration(sdk), http); throw new Exception("duplicate SDK transport was accepted"); }
        catch (ArgumentException) { Check(true, "Runtime rejects a second platform HTTP client with an injected SDK"); }
        await using var matching = new IntelligenceRuntime(Configuration(sdk));
        Check(ReferenceEquals(matching.Intelligence, sdk), "identical duplicate configuration retains the injected SDK");
    }

    private static async Task DisposesOnlyOwnedSdk()
    {
        using var handler = new SdkHandler();
        using var http = new HttpClient(handler);
        var runtime = new IntelligenceRuntime(Configuration(), http);
        var sdk = runtime.Intelligence;

        await runtime.DisposeAsync();
        await runtime.DisposeAsync();
        try { await sdk.GetThreadAsync("thread", "trusted"); throw new Exception("owned SDK remained active after shutdown"); }
        catch (ObjectDisposedException) { Check(true, "Runtime disposes an SDK that it creates"); }
        using var response = await http.GetAsync("https://sdk.test/health");
        Check(response.IsSuccessStatusCode && !handler.Disposed, "legacy supplied HTTP client remains application-owned");
    }

    private static async Task RejectsDisposedSdk()
    {
        var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" });
        sdk.Dispose();
        var config = new RuntimeOptions
        {
            Intelligence = sdk, TelemetryDisabled = true,
            Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
            IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted"))
        };

        try { await using var runtime = new IntelligenceRuntime(config); throw new Exception("disposed SDK was accepted"); }
        catch (ObjectDisposedException) { Check(true, "Runtime rejects an already disposed SDK"); }
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }

    private sealed class SdkHandler : HttpMessageHandler
    {
        internal string? Url { get; private set; }
        internal string? Authorization { get; private set; }
        internal string? User { get; private set; }
        internal string? Grant { get; private set; }
        internal bool Disposed { get; private set; }
        internal HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Url = request.RequestUri!.AbsoluteUri;
            Authorization = request.Headers.Authorization?.ToString();
            User = request.Headers.TryGetValues("x-cpki-user-id", out var users) ? users.Single() : null;
            Grant = request.Headers.TryGetValues("x-cpki-memory-grant", out var grants) ? grants.Single() : null;
            return Task.FromResult(new HttpResponseMessage(Status)
            {
                Content = new StringContent("{\"thread\":{\"id\":\"thread\"},\"threads\":[],\"memories\":[]}")
            });
        }

        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }
}
