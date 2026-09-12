using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class SdkLifecycleTests
{
    internal static async Task RunAsync()
    {
        using var handler = new PlatformHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key", ApiUrl = new Uri("https://platform.test") }, http);
        var events = Channel.CreateUnbounded<EventArgs>();
        sdk.ThreadCreated += (_, args) => events.Writer.TryWrite(args);
        sdk.ThreadUpdated += (_, args) => events.Writer.TryWrite(args);
        sdk.ThreadDeleted += (_, args) => events.Writer.TryWrite(args);
        await using var runtime = new IntelligenceRuntime(new RuntimeOptions
        {
            Intelligence = sdk, TelemetryDisabled = true,
            Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
            IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted")),
            LearningContainer = (_, _, _, _, _) => ValueTask.FromResult<string?>("existing-container")
        });
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        runtime.Map(app);
        await app.StartAsync();
        using var browser = new HttpClient
        {
            BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()),
            Timeout = TimeSpan.FromSeconds(5)
        };
        try
        {
            foreach (var (method, path) in new[]
            {
                (HttpMethod.Patch, "/copilotkit/threads/thread"),
                (HttpMethod.Post, "/copilotkit/threads/thread/archive"),
                (HttpMethod.Delete, "/copilotkit/threads/thread")
            })
            {
                using var request = new HttpRequestMessage(method, path)
                {
                    Content = JsonContent.Create(new { agentId = "default", userId = "forged", name = "new" })
                };
                using var response = await browser.SendAsync(request);
                Check(response.IsSuccessStatusCode, "Runtime mutation completes through the shared SDK: " + method);
                Check(events.Reader.TryRead(out var received), "Runtime mutation emits an SDK event");
                if (method == HttpMethod.Delete)
                    Check(received is ThreadDeletedEventArgs { ThreadId: "thread", UserId: "trusted", AgentId: "default" }, "Runtime deletion event uses trusted identity");
                else
                    Check(received is ThreadEventArgs changed && changed.Thread.Id == "canonical"
                        && changed.Thread.ExtensionData["userId"].GetString() == "trusted", "Runtime update event uses canonical platform data and trusted identity");
            }

            using var denied = await browser.PatchAsJsonAsync("/copilotkit/threads/denied", new { agentId = "default", userId = "forged" });
            Check(denied.StatusCode == HttpStatusCode.Forbidden && !events.Reader.TryRead(out _), "denied Runtime write does not emit success");
            using var subscribed = await browser.PostAsJsonAsync("/copilotkit/threads/subscribe", new { });
            Check(subscribed.IsSuccessStatusCode && !events.Reader.TryRead(out _), "thread subscription does not emit creation");
            using var run = await browser.PostAsJsonAsync("/copilotkit/agent/default/run", new
            {
                threadId = "new-thread", runId = "run", messages = Array.Empty<object>(), tools = Array.Empty<object>(),
                context = Array.Empty<object>(), state = new { }, forwardedProps = new { }
            });
            Check(run.StatusCode == HttpStatusCode.Conflict, "run reports a later lock conflict");
            Check(events.Reader.TryRead(out var created) && created is ThreadEventArgs creation
                && creation.Thread.ExtensionData["learningContainerId"].GetString() == "existing-container"
                && creation.Thread.ExtensionData["userId"].GetString() == "trusted", "persisted Runtime creation emits its existing Learning Container before a later lock failure");
            Check(!events.Reader.TryRead(out _), "nested lock operation emits no lifecycle event");
        }
        finally { await app.StopAsync(); }
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }

    private sealed class PlatformHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            var status = path.EndsWith("/denied") ? HttpStatusCode.Forbidden
                : path.EndsWith("/lock") ? HttpStatusCode.Conflict
                : request.Method == HttpMethod.Get && path.EndsWith("/new-thread") ? HttpStatusCode.NotFound : HttpStatusCode.OK;
            var body = request.Content is null ? new JsonObject() : JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken))!.AsObject();
            body["id"] = "canonical";
            var result = new JsonObject { ["thread"] = body, ["joinToken"] = "token" };
            return new HttpResponseMessage(status) { Content = JsonContent.Create(result) };
        }
    }
}
