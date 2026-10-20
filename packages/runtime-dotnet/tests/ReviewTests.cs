using System.Net;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class ReviewTests
{
    public static async Task RunAsync()
    {
        foreach (var frame in new[] { "data: []", "data: {}", "data: []\n\n", "data: {}\n\n" })
        {
            using var client = new HttpClient(new FrameHandler(frame));
            try
            {
                await foreach (var _ in new HttpAgent(new Uri("http://agent.test"), client).RunAsync(new JsonObject(), CancellationToken.None)) { }
                throw new Exception("invalid AG-UI event accepted");
            }
            catch (RuntimeRequestException error) when (error.StatusCode == 502) { }
        }
        var insecure = new McpAppServer { Url = new Uri("http://mcp.example.test"), Headers = new Dictionary<string, string> { ["Authorization"] = "test-only" } };
        using var agentClient = new HttpClient();
        var options = new RuntimeOptions { ApiKey = "test-only", IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(null), Agents = new Dictionary<string, IRuntimeAgent> { ["agent"] = new HttpAgent(new Uri("http://agent.test"), agentClient) }, McpAppsServers = [insecure] };
        try { options.Validate(); throw new Exception("runtime accepted remote MCP credentials over HTTP"); }
        catch (ArgumentException error) when (error.Message.Contains("HTTPS")) { }
        try { McpAppServer.FromJson(new JsonObject { ["url"] = insecure.Url.ToString(), ["headers"] = new JsonObject { ["Authorization"] = "test-only" } }); throw new Exception("JSON config accepted remote MCP credentials over HTTP"); }
        catch (ArgumentException error) when (error.Message.Contains("HTTPS")) { }
        using (var neverSend = new HttpClient(new RejectNetworkHandler()))
        {
            await using var session = new McpHttpSession(insecure, neverSend);
            try { await session.InitializeAsync(CancellationToken.None); throw new Exception("direct MCP session accepted remote credentials over HTTP"); }
            catch (ArgumentException error) when (error.Message.Contains("HTTPS")) { }
        }
        foreach (var url in new[] { "https://mcp.example.test", "http://127.0.0.1:8123", "http://[::1]:8123" })
            McpAppServer.FromJson(new JsonObject { ["url"] = url, ["headers"] = new JsonObject { ["Authorization"] = "test-only" } });
        McpAppServer.FromJson(new JsonObject { ["url"] = "http://mcp.example.test" });
        var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        var leaked = 0;
        app.MapGet("/redirect", (HttpContext context) => context.Response.Redirect("/capture"));
        app.MapGet("/capture", () => { leaked++; return "received"; });
        await app.StartAsync();
        using var mcp = IntelligenceRuntime.CreateMcpHttpClient();
        mcp.DefaultRequestHeaders.Add("x-server-secret", "test-only");
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var response = await mcp.GetAsync(address + "/redirect");
        if (response.StatusCode != HttpStatusCode.Redirect || leaked != 0) throw new Exception("MCP client followed a redirect with configured headers");
        await app.StopAsync();
        Console.WriteLine("PASS MCP redirect isolation and unterminated AG-UI validation");
    }

    private sealed class RejectNetworkHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => throw new Exception("invalid MCP credentials reached the network");
    }

    private sealed class FrameHandler(string frame) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(frame) });
    }
}
