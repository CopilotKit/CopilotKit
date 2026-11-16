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
        await McpFilteringRegressions();
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
        var filtered = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.example.test", ["includeTools"] = new JsonArray("generate_qr", "admin_dashboard"), ["excludeTools"] = new JsonArray("admin_dashboard") });
        if (!filtered.AllowsTool("generate_qr") || filtered.AllowsTool("admin_dashboard") || filtered.AllowsTool("other")) throw new Exception("includeTools then excludeTools did not select the MCP App tool");
        var excluded = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.example.test", ["excludeTools"] = new JsonArray("admin_dashboard") });
        if (!excluded.AllowsTool("generate_qr") || excluded.AllowsTool("admin_dashboard")) throw new Exception("excludeTools alone did not hide the named MCP App tool");
        var none = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.example.test", ["includeTools"] = new JsonArray() });
        if (none.AllowsTool("generate_qr")) throw new Exception("empty includeTools must expose no MCP App tools");
        foreach (var key in new[] { "includeTools", "excludeTools" })
        foreach (var malformed in new JsonNode?[] { JsonValue.Create("generate_qr"), JsonNode.Parse("null"), new JsonArray(""), new JsonArray(JsonValue.Create(1)) })
        {
            try { McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.example.test", [key] = malformed }); throw new Exception($"malformed {key} was accepted"); }
            catch (ArgumentException error) when (error.Message.Contains(key)) { }
        }
        try { new McpAppServer { Url = new Uri("https://mcp.example.test"), IncludeTools = new[] { "" } }.Validate(); throw new Exception("empty include tool name accepted"); }
        catch (ArgumentException error) when (error.Message.Contains("includeTools")) { }
        try { new McpAppServer { Url = new Uri("https://mcp.example.test"), ExcludeTools = new[] { "generate_qr", "" } }.Validate(); throw new Exception("empty exclude tool name accepted"); }
        catch (ArgumentException error) when (error.Message.Contains("excludeTools")) { }
        new McpAppServer { Url = new Uri("https://mcp.example.test"), IncludeTools = Array.Empty<string>(), ExcludeTools = Array.Empty<string>() }.Validate();
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

    private static async Task McpFilteringRegressions()
    {
        var failures = new List<string>();
        foreach (var allowlist in new[] { false, true })
        {
            using var wire = new AppOnlyHandler();
            using var http = new HttpClient(wire);
            var source = new SequenceAgent([new JsonObject { ["type"] = "RUN_FINISHED" }]);
            var server = new McpAppServer
            {
                Url = new Uri("https://mcp.test/mcp"), ServerId = "dashboard",
                IncludeTools = allowlist ? ["refresh_dashboard"] : null,
                ExcludeTools = ["admin_dashboard"]
            };
            var agent = new McpAppsAgent(source, [server], http);
            var input = new JsonObject { ["messages"] = new JsonArray(), ["tools"] = new JsonArray() };
            await foreach (var _ in agent.RunAsync(input, CancellationToken.None)) { }
            if (source.Input!["tools"]!.AsArray().Any(tool => tool?["name"]?.GetValue<string>() == "refresh_dashboard"))
                failures.Add("app-only tool was exposed to the model");
            input["forwardedProps"] = new JsonObject
            {
                ["__proxiedMCPRequest"] = new JsonObject
                {
                    ["serverId"] = "dashboard", ["method"] = "tools/call",
                    ["params"] = new JsonObject { ["name"] = "refresh_dashboard", ["arguments"] = new JsonObject() }
                }
            };
            var events = new List<JsonObject>();
            await foreach (var item in agent.RunAsync(input, CancellationToken.None)) events.Add(item);
            if (wire.ToolCalls != 1 || events.Last()["result"]?["content"]?[0]?["text"]?.GetValue<string>() != "refreshed")
                failures.Add($"app-only proxy rejected a policy-permitted tool (allowlist={allowlist})");
            var beforeBlocked = wire.ToolCalls;
            input["forwardedProps"]!["__proxiedMCPRequest"]!["params"]!["name"] = "admin_dashboard";
            await foreach (var _ in agent.RunAsync(input, CancellationToken.None)) { }
            if (wire.ToolCalls != beforeBlocked) failures.Add("excluded app-only tool was executed");
        }

        using var historyWire = new SharedNameHandler();
        using var historyHttp = new HttpClient(historyWire);
        var beta = new McpAppServer
        {
            Url = new Uri("https://mcp.test/mcp"), ServerId = "beta",
            Headers = new Dictionary<string, string> { ["x-token"] = "beta" }
        };
        var history = JsonNode.Parse("""
            {"tools":[],"messages":[{"role":"assistant","toolCalls":[{"id":"old-alpha-call","function":{"name":"show_weather","arguments":"{}"}}]}]}
            """)!.AsObject();
        var eventsFromHistory = new List<JsonObject>();
        var historyAgent = new McpAppsAgent(new SequenceAgent([new JsonObject { ["type"] = "RUN_FINISHED" }]), [beta], historyHttp);
        await foreach (var item in historyAgent.RunAsync(history, CancellationToken.None)) eventsFromHistory.Add(item);
        if (historyWire.ToolCalls.Count != 0) failures.Add("history-only call executed against the replacement server");
        var rejected = eventsFromHistory.FindIndex(item => item["type"]?.GetValue<string>() == "TOOL_CALL_RESULT" && item["toolCallId"]?.GetValue<string>() == "old-alpha-call");
        if (rejected < 0 || rejected >= eventsFromHistory.Count - 1) failures.Add("history-only call was not resolved before run finish");
        if (failures.Count > 0) throw new Exception(string.Join("; ", failures));
        Console.WriteLine("PASS app-only MCP proxy policy and history-only call isolation");
    }

    private sealed class AppOnlyHandler : HttpMessageHandler
    {
        public int ToolCalls { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(HttpStatusCode.NoContent);
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
            if (body["id"] is null) return new HttpResponseMessage(HttpStatusCode.Accepted);
            var method = body["method"]!.GetValue<string>();
            JsonNode result;
            if (method == "tools/list")
                result = JsonNode.Parse("""
                    {"tools":[{"name":"refresh_dashboard","inputSchema":{"type":"object"},"_meta":{"ui":{"visibility":["app"]}}},{"name":"admin_dashboard","inputSchema":{"type":"object"},"_meta":{"ui":{"visibility":["app"]}}}]}
                    """)!;
            else if (method == "tools/call")
            {
                ToolCalls++;
                result = JsonNode.Parse("""{"content":[{"type":"text","text":"refreshed"}]}""")!;
            }
            else result = JsonNode.Parse("""{"protocolVersion":"2025-03-26","capabilities":{},"serverInfo":{"name":"test","version":"1"}}""")!;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = System.Net.Http.Json.JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result })
            };
        }
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
