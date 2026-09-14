using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var config = JsonNode.Parse(Environment.GetEnvironmentVariable("CPK_CONFIG") ?? throw new InvalidOperationException("CPK_CONFIG is required"))!;
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:" + (config["port"]?.GetValue<int>() ?? 0));
var app = builder.Build();
using var agentHttp = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
await using var runtime = new IntelligenceRuntime(new RuntimeOptions
{
    ApiUrl = new Uri(config["apiUrl"]!.GetValue<string>()), RunnerUrl = new Uri(config["runnerUrl"]!.GetValue<string>()), ClientUrl = new Uri(config["clientUrl"]!.GetValue<string>()), ApiKey = config["apiKey"]!.GetValue<string>(),
    Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new HttpAgent(new Uri(config["agentUrl"]!.GetValue<string>()), agentHttp, "Conformance agent") },
    A2UI = config["a2ui"] is JsonObject a2ui ? A2UIOptions.FromJson(a2ui) : null,
    McpAppsServers = (config["mcpApps"]?["servers"] as JsonArray ?? []).Select(server => McpAppServer.FromJson(server!.AsObject())).ToList(),
    IdentifyUser = (context, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser(context.Request.Headers["x-test-user-id"].FirstOrDefault() ?? "test-user", context.Request.Headers["x-test-user-name"].FirstOrDefault() ?? "Test User")),
    MemoryGrant = config["omitMemoryPolicy"]?.GetValue<bool>() != true && config.AsObject().ContainsKey("memoryGrant") ? (_, _, _) => ValueTask.FromResult(config["memoryGrant"]?.DeepClone() as JsonObject) : null,
    TelemetryDisabled = config["telemetryDisabled"]?.GetValue<bool>() ?? false,
    TelemetrySampleRate = config["telemetrySampleRate"]?.GetValue<double>() ?? 0.05,
    TelemetryId = config["telemetryId"]?.GetValue<string>(),
    LicenseToken = config["licenseToken"]?.GetValue<string>(),
    TelemetryUrl = config["telemetryUrl"] is null ? null : new Uri(config["telemetryUrl"]!.GetValue<string>()),
    AckTimeout = TimeSpan.FromMilliseconds(config["ackTimeoutMs"]?.GetValue<int>() ?? 500),
    LockHeartbeatInterval = TimeSpan.FromMilliseconds(config["lockHeartbeatMs"]?.GetValue<int>() ?? 1000)
});
runtime.Map(app);
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine(new JsonObject { ["port"] = new Uri(address).Port }.ToJsonString());
await app.WaitForShutdownAsync();
