using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>A server-owned MCP Apps endpoint. Browser requests can select registered IDs, never arbitrary URLs.</summary>
public sealed class McpAppServer
{
    public required Uri Url { get; init; }
    public string? ServerId { get; init; }
    public string? AgentId { get; init; }
    public IReadOnlyDictionary<string, string> Headers { get; init; } = new Dictionary<string, string>();

    /// <summary>Stable frontend identifier matching MCP Apps middleware 0.0.3 HTTP config hashing.</summary>
    public string Hash => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(new JsonObject { ["type"] = "http", ["url"] = Url.OriginalString }.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping })))).ToLowerInvariant();

    public static McpAppServer FromJson(JsonObject value)
    {
        if (value.ContainsKey("includeTools") || value.ContainsKey("excludeTools")) throw new ArgumentException("MCP Apps tool filtering is not supported by the reference middleware.");
        if (A2UIValidation.Text(value["type"]) is { } type && type != "http") throw new ArgumentException("Only MCP Streamable HTTP transport is supported.");
        var uri = new Uri(RuntimeValidation.RequiredString(value, "url"));
        if (uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)) throw new ArgumentException("MCP URL must be HTTP(S), without embedded credentials.");
        var server = new McpAppServer
        {
            Url = uri, ServerId = A2UIValidation.Text(value["serverId"]), AgentId = A2UIValidation.Text(value["agentId"]),
            Headers = value["headers"] is JsonObject headers ? headers.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>(), StringComparer.OrdinalIgnoreCase) : new Dictionary<string, string>()
        };
        server.Validate();
        return server;
    }

    /// <summary>Keep credentials encrypted outside numeric loopback development endpoints.</summary>
    internal void Validate()
    {
        if (!Url.IsAbsoluteUri || Url.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(Url.UserInfo))
            throw new ArgumentException("MCP URL must be HTTP(S), without embedded credentials.");
        var numericLoopback = System.Net.IPAddress.TryParse(Url.Host.Trim('[', ']'), out var address) && System.Net.IPAddress.IsLoopback(address);
        if (Headers.Count > 0 && Url.Scheme != "https" && !numericLoopback)
            throw new ArgumentException("MCP servers with headers require HTTPS, except numeric loopback development endpoints.");
    }
}

/// <summary>Discovers and executes UI-enabled MCP tools, including iframe resource reentry, before persistence.</summary>
public sealed class McpAppsAgent(IRuntimeAgent next, IReadOnlyList<McpAppServer> servers, HttpClient httpClient, Action<string>? report = null) : IRuntimeAgent
{
    public string Description => next.Description;
    private sealed record UiTool(JsonObject Tool, McpAppServer Server, string ResourceUri);
    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (input["forwardedProps"]?["__proxiedMCPRequest"] is JsonObject proxy)
        {
            yield return new JsonObject { ["type"] = "RUN_STARTED", ["threadId"] = input["threadId"]?.DeepClone(), ["runId"] = input["runId"]?.DeepClone() };
            JsonNode? result;
            try
            {
                var method = A2UIValidation.Text(proxy["method"]) ?? "";
                if (method is not ("tools/call" or "resources/read" or "notifications/message" or "ping")) throw new RuntimeRequestException(400, "MCP method not allowed for UI proxy");
                var id = A2UIValidation.Text(proxy["serverId"]); var hash = A2UIValidation.Text(proxy["serverHash"]);
                var server = (id is null ? null : servers.LastOrDefault(server => server.ServerId == id)) ?? servers.LastOrDefault(server => server.Hash == hash) ?? throw new RuntimeRequestException(404, "Unknown MCP server");
                await using var session = new McpHttpSession(server, httpClient);
                await session.InitializeAsync(cancellationToken);
                result = await session.RequestAsync(method, proxy["params"] as JsonObject, cancellationToken, notification: method == "notifications/message");
                if (method == "notifications/message") result = new JsonObject { ["success"] = true };
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception) { report?.Invoke("mcp.proxy_failed"); result = new JsonObject { ["error"] = "MCP proxy request failed" }; }
            yield return new JsonObject { ["type"] = "RUN_FINISHED", ["threadId"] = input["threadId"]?.DeepClone(), ["runId"] = input["runId"]?.DeepClone(), ["result"] = result };
            yield break;
        }
        var tools = new List<UiTool>();
        foreach (var server in servers)
        {
            try
            {
                await using var session = new McpHttpSession(server, httpClient);
                await session.InitializeAsync(cancellationToken);
                string? cursor = null; var seen = new HashSet<string>(StringComparer.Ordinal);
                do
                {
                    var response = await session.RequestAsync("tools/list", cursor is null ? new JsonObject() : new JsonObject { ["cursor"] = cursor }, cancellationToken);
                    if (response?["tools"] is not JsonArray listed) throw new RuntimeRequestException(502, "MCP server returned an invalid tool list");
                    foreach (var tool in listed.OfType<JsonObject>())
                    {
                        var meta = tool["_meta"] as JsonObject;
                        var ui = meta?["ui"] as JsonObject;
                        var resource = A2UIValidation.Text(ui?["resourceUri"]) ?? A2UIValidation.Text(meta?["ui/resourceUri"]);
                        if (resource is null || A2UIValidation.Text(tool["name"]) is not { } name) continue;
                        tools.Add(new UiTool(new JsonObject { ["name"] = name, ["description"] = (A2UIValidation.Text(tool["description"]) ?? "") + "\n[UI Resource: " + resource + "]", ["parameters"] = tool["inputSchema"]?.DeepClone() ?? new JsonObject { ["type"] = "object", ["properties"] = new JsonObject() } }, server, resource));
                        if (tools.Count > 1000) throw new RuntimeRequestException(502, "MCP tool limit exceeded");
                    }
                    cursor = A2UIValidation.Text(response["nextCursor"]);
                    if (cursor is not null && (!seen.Add(cursor) || seen.Count > 100)) throw new RuntimeRequestException(502, "MCP pagination limit exceeded");
                } while (cursor is not null);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception) { report?.Invoke("mcp.discovery_failed"); }
        }
        var enhanced = (JsonObject)input.DeepClone();
        enhanced["tools"] = new JsonArray((input["tools"] as JsonArray ?? []).Select(tool => tool?.DeepClone()).Concat(tools.Select(tool => (JsonNode?)tool.Tool.DeepClone())).ToArray());
        var byName = new Dictionary<string, UiTool>(StringComparer.Ordinal); foreach (var tool in tools) byName[tool.Tool["name"]!.GetValue<string>()] = tool;
        var calls = new AgentToolCalls(enhanced); JsonObject? held = null; Exception? failure = null;
        await using var source = next.RunAsync(enhanced, cancellationToken).GetAsyncEnumerator(cancellationToken);
        while (true)
        {
            bool available;
            try { available = await source.MoveNextAsync(); } catch (Exception error) { failure = error; break; }
            if (!available) break;
            var value = source.Current; calls.Observe(value);
            if (held is not null) { yield return held; held = null; }
            if (A2UIValidation.Text(value["type"]) == "RUN_FINISHED") held = value;
            else yield return value;
        }
        if (held is not null)
        {
            if (failure is null)
            {
                foreach (var call in calls.Pending.Where(call => byName.ContainsKey(call.Name)))
                {
                    var tool = byName[call.Name]; JsonObject result; JsonObject? activity = null;
                    try
                    {
                        var args = JsonNode.Parse(string.IsNullOrWhiteSpace(call.Arguments) ? "{}" : call.Arguments) as JsonObject ?? throw new RuntimeRequestException(400, "MCP tool arguments must be an object");
                        await using var session = new McpHttpSession(tool.Server, httpClient);
                        await session.InitializeAsync(cancellationToken);
                        var content = await session.RequestAsync("tools/call", new JsonObject { ["name"] = call.Name, ["arguments"] = args.DeepClone() }, cancellationToken) ?? new JsonObject();
                        var text = string.Join('\n', (content["content"] as JsonArray ?? []).OfType<JsonObject>().Where(item => A2UIValidation.Text(item["type"]) == "text").Select(item => A2UIValidation.Text(item["text"])).Where(item => item is not null));
                        result = AgentToolCalls.Result(call.Id, text.Length > 0 ? text : content["content"]?.ToJsonString() ?? "null");
                        var activityContent = new JsonObject { ["result"] = content, ["resourceUri"] = tool.ResourceUri, ["serverHash"] = tool.Server.Hash, ["toolInput"] = args };
                        if (tool.Server.ServerId is not null) activityContent["serverId"] = tool.Server.ServerId;
                        activity = new JsonObject { ["type"] = "ACTIVITY_SNAPSHOT", ["messageId"] = Guid.NewGuid().ToString(), ["activityType"] = "mcp-apps", ["content"] = activityContent, ["replace"] = true };
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                    catch (Exception) { report?.Invoke("mcp.tool_failed"); result = AgentToolCalls.Result(call.Id, "{\"error\":\"MCP tool execution failed\"}"); }
                    yield return result; if (activity is not null) yield return activity;
                }
            }
            yield return held;
        }
        if (failure is not null) ExceptionDispatchInfo.Capture(failure).Throw();
    }
}

/// <summary>Minimal MCP Streamable HTTP client with sessions, protocol negotiation, pagination support and bounded replies.</summary>
internal sealed class McpHttpSession(McpAppServer server, HttpClient http) : IAsyncDisposable
{
    private string? sessionId;
    private string protocol = "2025-03-26";
    private long reference;
    public async Task InitializeAsync(CancellationToken ct)
    {
        server.Validate();
        var result = await RequestAsync("initialize", new JsonObject
        {
            ["protocolVersion"] = protocol,
            ["clientInfo"] = new JsonObject { ["name"] = "mcp-apps-middleware", ["version"] = "1.0.0" },
            ["capabilities"] = new JsonObject { ["extensions"] = new JsonObject { ["io.modelcontextprotocol/ui"] = new JsonObject { ["mimeTypes"] = new JsonArray("text/html+mcp") } } }
        }, ct);
        protocol = A2UIValidation.Text(result?["protocolVersion"]) ?? throw new RuntimeRequestException(502, "MCP protocol negotiation failed");
        if (protocol is not ("2024-11-05" or "2025-03-26" or "2025-06-18" or "2025-11-25")) throw new RuntimeRequestException(502, "Unsupported MCP protocol version");
        await RequestAsync("notifications/initialized", new JsonObject(), ct, true);
    }
    public async Task<JsonNode?> RequestAsync(string method, JsonObject? parameters, CancellationToken ct, bool notification = false)
    {
        var id = ++reference;
        var body = new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method };
        if (parameters is not null) body["params"] = parameters.DeepClone();
        if (!notification) body["id"] = id;
        using var request = Request(HttpMethod.Post); request.Content = JsonContent.Create(body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode) throw new RuntimeRequestException(502, "MCP server request failed");
        if (response.Headers.TryGetValues("Mcp-Session-Id", out var sessions)) sessionId = sessions.Single();
        if (notification) return null;
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        if (response.Content.Headers.ContentType?.MediaType == "text/event-stream")
        {
            using var reader = new StreamReader(stream); var data = new StringBuilder(); var total = 0;
            while (await reader.ReadLineAsync(timeout.Token) is { } line)
            {
                total += line.Length; if (total > 4 * 1024 * 1024) throw new RuntimeRequestException(502, "MCP reply exceeds size limit");
                if (line.Length == 0)
                {
                    if (data.Length == 0) continue;
                    var parsed = JsonNode.Parse(data.ToString()); data.Clear();
                    if (Matches(parsed, id)) return Unwrap(parsed!);
                }
                else if (line.StartsWith("data:", StringComparison.Ordinal)) data.Append(line[5..].TrimStart(' ')).Append('\n');
            }
            if (data.Length > 0) { var parsed = JsonNode.Parse(data.ToString()); if (Matches(parsed, id)) return Unwrap(parsed!); }
            throw new RuntimeRequestException(502, "MCP stream ended without a matching response");
        }
        using var memory = new MemoryStream(); var buffer = new byte[8192]; int read;
        while ((read = await stream.ReadAsync(buffer, timeout.Token)) > 0) { if (memory.Length + read > 4 * 1024 * 1024) throw new RuntimeRequestException(502, "MCP reply exceeds size limit"); memory.Write(buffer, 0, read); }
        var value = JsonNode.Parse(memory.ToArray());
        if (!Matches(value, id)) throw new RuntimeRequestException(502, "MCP reply ID mismatch");
        return Unwrap(value!);
    }
    private HttpRequestMessage Request(HttpMethod method)
    {
        var request = new HttpRequestMessage(method, server.Url);
        foreach (var pair in server.Headers) request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
        request.Headers.Accept.ParseAdd("application/json, text/event-stream");
        request.Headers.TryAddWithoutValidation("MCP-Protocol-Version", protocol);
        if (sessionId is not null) request.Headers.TryAddWithoutValidation("Mcp-Session-Id", sessionId);
        return request;
    }
    private static bool Matches(JsonNode? value, long id) => value is JsonObject obj && obj["id"] is JsonValue identifier && identifier.TryGetValue<long>(out var number) && number == id;
    private static JsonNode? Unwrap(JsonNode value)
    {
        if (value["error"] is not null) throw new RuntimeRequestException(502, "MCP server returned a JSON-RPC error");
        return value["result"]?.DeepClone();
    }
    public async ValueTask DisposeAsync()
    {
        if (sessionId is null) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { using var request = Request(HttpMethod.Delete); using var response = await http.SendAsync(request, timeout.Token); }
        catch (Exception) { /* Session cleanup is best effort and cannot replace the call result. */ }
    }
}
