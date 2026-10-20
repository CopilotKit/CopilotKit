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

internal static class EntitlementRuntimeTests
{
    internal static async Task RunAsync()
    {
        foreach (var scenario in new (string Body, int HttpStatus, string Status, string License)[]
        {
            ("""{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}""", 200, "ready", "valid"),
            ("""{"organizationId":"org","active":true,"source":"awsMarketplaceDeploymentLicense","features":{},"limits":{}}""", 200, "ready", "valid"),
            ("""{"status":"ready","entitlement":{"active":false,"source":"selfHostedDeploymentLicense","features":{},"limits":{}}}""", 200, "ready", "none"),
            ("""{"status":"degraded","error":{"code":"BUSY","message":"Try later","retryable":true}}""", 200, "degraded", "unknown"),
            ("""{"status":"misconfigured","error":{"code":"CONFIG","message":"Set a key","retryable":false}}""", 200, "misconfigured", "none"),
            ("private-provider-content", 200, "misconfigured", "none"),
            ("private-provider-content", 403, "misconfigured", "none"),
            ("private-provider-content", 503, "unavailable", "unknown")
        })
        {
            using var handler = new EntitlementHandler(scenario.HttpStatus, scenario.Body);
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "server-key" }, http);
            try { await sdk.GetRuntimeEntitlementsAsync(); } catch (RuntimeEntitlementException) { }
            var identified = 0;
            await using var runtime = new IntelligenceRuntime(new RuntimeOptions
            {
                Intelligence = sdk, TelemetryDisabled = true, Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
                IdentifyUser = (_, _) => { identified++; return ValueTask.FromResult<RuntimeUser?>(null); }
            });
            var builder = WebApplication.CreateBuilder();
            builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
            await using var app = builder.Build();
            runtime.Map(app);
            await app.StartAsync();
            using var browser = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
            try
            {
                using var response = await browser.GetAsync("/copilotkit/info");
                var info = await response.Content.ReadFromJsonAsync<JsonObject>();
                Check(response.StatusCode == HttpStatusCode.OK && info?["runtimeEntitlements"]?["status"]?.GetValue<string>() == scenario.Status
                    && info["licenseStatus"]?.GetValue<string>() == scenario.License, "discovery normalizes entitlement and compatibility license: " + scenario.Status + "/" + scenario.License);
                Check(handler.Calls == 1 && identified == 0, "public discovery reuses the SDK lookup without app-user authentication");
                Check(!info!.ToJsonString().Contains("private-provider-content"), "discovery excludes private failure content");
                if (scenario.HttpStatus != 200 || scenario.Body == "private-provider-content")
                {
                    var expectedCode = scenario.Status == "misconfigured" ? "runtime_entitlements_misconfigured" : "runtime_entitlements_unavailable";
                    Check(info["runtimeEntitlements"]?["error"]?["code"]?.GetValue<string>() == expectedCode, "discovery uses the TypeScript failure projection");
                }
            }
            finally { await app.StopAsync(); }
        }
    }

    private sealed class EntitlementHandler(int status, string body) : HttpMessageHandler
    {
        internal int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            Check(request.Headers.Authorization?.ToString() == "Bearer server-key", "lookup uses server credentials");
            return Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(body) });
        }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
