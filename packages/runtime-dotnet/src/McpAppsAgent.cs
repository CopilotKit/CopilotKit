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
    /// <summary>Allowlist of MCP tool names. Null exposes every UI tool; an empty list exposes none.</summary>
    public IReadOnlyList<string>? IncludeTools { get; init; }
    /// <summary>Tool names removed after <see cref="IncludeTools"/>. A name in both lists is excluded.</summary>
    public IReadOnlyList<string>? ExcludeTools { get; init; }

    internal bool AllowsTool(string name)
    {
        if (IncludeTools is not null && !IncludeTools.Contains(name, StringComparer.Ordinal)) return false;
        if (ExcludeTools is not null && ExcludeTools.Contains(name, StringComparer.Ordinal)) return false;
        return true;
    }

    private static IReadOnlyList<string>? ToolNames(JsonObject value, string key)
    {
        if (!value.ContainsKey(key)) return null;
        if (value[key] is not JsonArray names) throw new ArgumentException($"{key} must be an array of non-empty tool names.");
        var parsed = new string[names.Count];
        for (var index = 0; index < names.Count; index++)
        {
            if (A2UIValidation.Text(names[index]) is not { Length: > 0 } name) throw new ArgumentException($"{key} must be an array of non-empty tool names.");
            parsed[index] = name;
        }
        return parsed;
    }

    /// <summary>Stable frontend identifier matching MCP Apps middleware 0.0.3 HTTP config hashing.</summary>
    public string Hash => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(new JsonObject { ["type"] = "http", ["url"] = Url.OriginalString }.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping })))).ToLowerInvariant();

    public static McpAppServer FromJson(JsonObject value)
    {
        if (A2UIValidation.Text(value["type"]) is { } type && type != "http") throw new ArgumentException("Only MCP Streamable HTTP transport is supported.");
        var uri = new Uri(RuntimeValidation.RequiredString(value, "url"));
        if (uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)) throw new ArgumentException("MCP URL must be HTTP(S), without embedded credentials.");
        var server = new McpAppServer
        {
            Url = uri, ServerId = A2UIValidation.Text(value["serverId"]), AgentId = A2UIValidation.Text(value["agentId"]),
            Headers = value["headers"] is JsonObject headers ? headers.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>(), StringComparer.OrdinalIgnoreCase) : new Dictionary<string, string>(),
            IncludeTools = ToolNames(value, "includeTools"), ExcludeTools = ToolNames(value, "excludeTools")
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
        RejectEmptyNames(IncludeTools, "includeTools");
        RejectEmptyNames(ExcludeTools, "excludeTools");
    }

    private static void RejectEmptyNames(IReadOnlyList<string>? names, string key)
    {
        if (names is null) return;
        foreach (var name in names)
            if (string.IsNullOrEmpty(name)) throw new ArgumentException($"{key} must be an array of non-empty tool names.");
    }
}

/// <summary>Discovers and executes UI-enabled MCP tools, including iframe resource reentry, before persistence.</summary>
public sealed class McpAppsAgent(IRuntimeAgent next, IReadOnlyList<McpAppServer> servers, HttpClient httpClient, Action<string>? report = null) : IRuntimeAgent
{
    public string Description => next.Description;
    private const int UiToolScanLimit = 1000;
    private sealed record UiTool(string ExposedName, string OriginalName, JsonObject Tool, McpAppServer Server, string ResourceUri);
    /// <summary>Tool lists for one run. A later run builds a new catalog so a failed discovery can be retried.</summary>
    private sealed class RunCatalog
    {
        public List<UiTool> Tools { get; } = [];
        public Dictionary<McpAppServer, ServerScan> Servers { get; } = [];
        public HashSet<string> RejectedNames { get; } = new(StringComparer.Ordinal);
        public HashSet<string> UsedNames { get; } = new(StringComparer.Ordinal);
    }
    private sealed class ServerScan
    {
        public bool Failed { get; set; }
        public bool Incomplete { get; set; }
        public HashSet<string> OriginalNames { get; } = new(StringComparer.Ordinal);
        /// <summary>Original and exposed names from pages discarded because a later page failed.</summary>
        public HashSet<string> LostNames { get; } = new(StringComparer.Ordinal);
    }
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
                var matches = servers.Where(server => id is null ? server.Hash == hash : server.ServerId == id).Take(2).ToArray();
                var server = matches.Length == 1 ? matches[0] : throw new RuntimeRequestException(404, "Unknown or ambiguous MCP server");
                if (method == "tools/call" && HasToolFilter(server))
                {
                    var toolName = A2UIValidation.Text((proxy["params"] as JsonObject)?["name"]);
                    var proxyCatalog = new RunCatalog();
                    var scan = await DiscoverServerAsync(server, proxyCatalog, cancellationToken);
                    if (scan.Failed) throw new RuntimeRequestException(502, "MCP tool discovery failed");
                    if (toolName is not null && scan.OriginalNames.Contains(toolName))
                    {
                        await using var session = new McpHttpSession(server, httpClient);
                        await session.InitializeAsync(cancellationToken);
                        result = await session.RequestAsync(method, proxy["params"] as JsonObject, cancellationToken);
                    }
                    else if (scan.Incomplete && (toolName is null || !proxyCatalog.RejectedNames.Contains(toolName)))
                        throw new RuntimeRequestException(502, "MCP tool discovery incomplete");
                    else result = DeniedToolResult(toolName);
                }
                else
                {
                    await using var session = new McpHttpSession(server, httpClient);
                    await session.InitializeAsync(cancellationToken);
                    result = await session.RequestAsync(method, proxy["params"] as JsonObject, cancellationToken, notification: method == "notifications/message");
                    if (method == "notifications/message") result = new JsonObject { ["success"] = true };
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception) { report?.Invoke("mcp.proxy_failed"); result = new JsonObject { ["error"] = "MCP proxy request failed" }; }
            yield return new JsonObject { ["type"] = "RUN_FINISHED", ["threadId"] = input["threadId"]?.DeepClone(), ["runId"] = input["runId"]?.DeepClone(), ["result"] = result };
            yield break;
        }
        var catalog = new RunCatalog();
        var frontendTools = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tool in input["tools"] as JsonArray ?? []) if (A2UIValidation.Text(tool?["name"]) is { } frontendName && frontendTools.Add(frontendName)) catalog.UsedNames.Add(frontendName);
        foreach (var server in servers) await DiscoverServerAsync(server, catalog, cancellationToken);
        var routes = new Dictionary<string, UiTool>(StringComparer.Ordinal);
        foreach (var tool in catalog.Tools) routes[tool.ExposedName] = tool;
        var enhanced = (JsonObject)input.DeepClone();
        enhanced["tools"] = new JsonArray((input["tools"] as JsonArray ?? []).Select(tool => tool?.DeepClone()).Concat(catalog.Tools.Select(tool => (JsonNode?)tool.Tool.DeepClone())).ToArray());
        var emptyAllowlist = servers.Any(server => server.IncludeTools is { Count: 0 });
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
                foreach (var call in calls.Pending.Where(call => routes.ContainsKey(call.Name)))
                {
                    var tool = routes[call.Name]; JsonObject result; JsonObject? activity = null;
                    try
                    {
                        var args = JsonNode.Parse(string.IsNullOrWhiteSpace(call.Arguments) ? "{}" : call.Arguments) as JsonObject ?? throw new RuntimeRequestException(400, "MCP tool arguments must be an object");
                        await using var session = new McpHttpSession(tool.Server, httpClient);
                        await session.InitializeAsync(cancellationToken);
                        var content = await session.RequestAsync("tools/call", new JsonObject { ["name"] = tool.OriginalName, ["arguments"] = args.DeepClone() }, cancellationToken) ?? new JsonObject();
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
            foreach (var call in calls.Pending.Where(call => !routes.ContainsKey(call.Name) && !frontendTools.Contains(call.Name)))
            {
                if (UnseenConfiguredTool(call.Name, catalog) || LostDuringDiscovery(call.Name, catalog))
                    yield return AgentToolCalls.Result(call.Id, "MCP tool discovery failed: " + call.Name);
                else if (catalog.RejectedNames.Contains(call.Name) || ExcludedByConfig(call.Name) || OmittedByAllowlist(call.Name) || emptyAllowlist)
                    yield return AgentToolCalls.Result(call.Id, "MCP tool is not allowed: " + call.Name);
            }
            yield return held;
        }
        if (failure is not null) ExceptionDispatchInfo.Capture(failure).Throw();
    }

    /// <summary>Discover one server for this run. An empty allowlist records no tools and does not connect. A failure stays on this run only.</summary>
    private async Task<ServerScan> DiscoverServerAsync(McpAppServer server, RunCatalog catalog, CancellationToken cancellationToken)
    {
        if (catalog.Servers.TryGetValue(server, out var cached)) return cached;
        var scan = new ServerScan();
        catalog.Servers[server] = scan;
        if (server.IncludeTools is { Count: 0 }) return scan;
        var stagedTools = new List<UiTool>();
        var stagedRejected = new HashSet<string>(StringComparer.Ordinal);
        var stagedOriginal = new HashSet<string>(StringComparer.Ordinal);
        var stagedUsed = new HashSet<string>(catalog.UsedNames, StringComparer.Ordinal);
        try
        {
            await using var session = new McpHttpSession(server, httpClient);
            await session.InitializeAsync(cancellationToken);
            string? cursor = null; var seen = new HashSet<string>(StringComparer.Ordinal); var scannedUiTools = 0; var stop = false; var pageCut = false;
            do
            {
                var response = await session.RequestAsync("tools/list", cursor is null ? new JsonObject() : new JsonObject { ["cursor"] = cursor }, cancellationToken);
                if (response?["tools"] is not JsonArray listed) throw new RuntimeRequestException(502, "MCP server returned an invalid tool list");
                var page = listed.OfType<JsonObject>().ToArray();
                for (var index = 0; index < page.Length; index++)
                {
                    var tool = page[index];
                    var meta = tool["_meta"] as JsonObject;
                    var ui = meta?["ui"] as JsonObject;
                    if (ui?.ContainsKey("visibility") == true &&
                        (ui["visibility"] is not JsonArray visibility || !visibility.Any(value => A2UIValidation.Text(value) == "model"))) continue;
                    var resource = A2UIValidation.Text(ui?["resourceUri"]) ?? A2UIValidation.Text(meta?["ui/resourceUri"]);
                    if (A2UIValidation.Text(tool["name"]) is not { } name) continue;
                    if (resource is null)
                    {
                        if (server.IncludeTools is not null && !server.AllowsTool(name)) stagedRejected.Add(name);
                        continue;
                    }
                    scannedUiTools++;
                    var targeted = scannedUiTools > UiToolScanLimit;
                    if (!server.AllowsTool(name)) stagedRejected.Add(name);
                    else if (!targeted || server.IncludeTools?.Contains(name) == true)
                    {
                        var exposedName = AllocateExposedName(name, server, stagedUsed);
                        stagedTools.Add(new UiTool(exposedName, name, new JsonObject { ["name"] = exposedName, ["description"] = (A2UIValidation.Text(tool["description"]) ?? "") + "\n[UI Resource: " + resource + "]", ["parameters"] = tool["inputSchema"]?.DeepClone() ?? new JsonObject { ["type"] = "object", ["properties"] = new JsonObject() } }, server, resource));
                        stagedOriginal.Add(name);
                    }
                    if (scannedUiTools >= UiToolScanLimit * 2 || (scannedUiTools >= UiToolScanLimit && !MissingConfiguredTool(server, stagedOriginal)))
                    {
                        stop = true;
                        pageCut = index < page.Length - 1;
                        break;
                    }
                }
                var nextCursor = A2UIValidation.Text(response["nextCursor"]);
                if (stop)
                {
                    if (MissingConfiguredTool(server, stagedOriginal) && (nextCursor is not null || pageCut)) scan.Incomplete = true;
                    break;
                }
                cursor = nextCursor;
                if (cursor is not null && (!seen.Add(cursor) || seen.Count > 100)) throw new RuntimeRequestException(502, "MCP pagination limit exceeded");
            } while (cursor is not null);
            catalog.Tools.AddRange(stagedTools);
            foreach (var name in stagedRejected) catalog.RejectedNames.Add(name);
            foreach (var name in stagedOriginal) scan.OriginalNames.Add(name);
            catalog.UsedNames.Clear();
            foreach (var name in stagedUsed) catalog.UsedNames.Add(name);
            if (scan.Incomplete) report?.Invoke("mcp.discovery_incomplete");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            scan.Failed = true;
            scan.Incomplete = false;
            scan.OriginalNames.Clear();
            foreach (var name in stagedRejected) catalog.RejectedNames.Add(name);
            foreach (var tool in stagedTools)
            {
                scan.LostNames.Add(tool.OriginalName);
                scan.LostNames.Add(tool.ExposedName);
            }
            report?.Invoke("mcp.discovery_failed");
        }
        return scan;
    }

    private static bool HasToolFilter(McpAppServer server) => server.IncludeTools is not null || server.ExcludeTools is not null;

    /// <summary>Keep a free provider-safe name. Collisions and unsafe server ids are rewritten without changing the original call name.</summary>
    private static string AllocateExposedName(string original, McpAppServer server, HashSet<string> used)
    {
        if (IsProviderSafeToolName(original) && used.Add(original)) return original;
        var suffix = SanitizeToolToken(string.IsNullOrEmpty(server.ServerId) ? server.Hash[..8] : server.ServerId!);
        var tool = SanitizeToolToken(original);
        var discriminator = 2;
        var candidate = FitToolName(suffix, tool, "");
        while (!used.Add(candidate)) candidate = FitToolName(suffix, tool, "_" + discriminator++);
        return candidate;
    }

    private static bool IsProviderSafeToolName(string name) =>
        name.Length is > 0 and <= 64 && name.All(static c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');

    private static string SanitizeToolToken(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
            builder.Append(char.IsAsciiLetterOrDigit(character) || character is '_' or '-' ? character : '_');
        var text = builder.ToString().Trim('_');
        return text.Length == 0 ? "mcp" : text;
    }

    private static string FitToolName(string suffix, string tool, string tail)
    {
        const int limit = 64;
        var room = Math.Max(2, limit - "__".Length - tail.Length);
        var suffixLength = Math.Min(suffix.Length, Math.Max(1, room / 2));
        var toolLength = Math.Min(tool.Length, room - suffixLength);
        if (toolLength < 1) { toolLength = 1; suffixLength = room - 1; }
        return suffix[..Math.Min(suffix.Length, suffixLength)] + "__" + tool[..Math.Min(tool.Length, toolLength)] + tail;
    }

    private static bool MissingConfiguredTool(McpAppServer server, IReadOnlySet<string> found) =>
        server.IncludeTools is { Count: > 0 } && server.IncludeTools.Any(name => server.AllowsTool(name) && !found.Contains(name));

    /// <summary>A configured name that this run did not reach is not a denial. Discovery failed or stopped early.</summary>
    private bool UnseenConfiguredTool(string name, RunCatalog catalog)
    {
        foreach (var server in servers)
        {
            if (server.IncludeTools?.Contains(name) != true || !server.AllowsTool(name)) continue;
            if (!catalog.Servers.TryGetValue(server, out var scan)) return true;
            if ((scan.Failed || scan.Incomplete) && !scan.OriginalNames.Contains(name)) return true;
        }
        return false;
    }

    /// <summary>A name allocated on a page that was discarded after a later page failed, including a collision alias.</summary>
    private static bool LostDuringDiscovery(string name, RunCatalog catalog) =>
        catalog.Servers.Values.Any(scan => scan.Failed && scan.LostNames.Contains(name));

    /// <summary>An allowlist that omits the name filters it out, including non-UI tools and names the scan never reached. An unfiltered server with no route does not leave that call open.</summary>
    private bool OmittedByAllowlist(string name)
    {
        if (!servers.Any(server => server.IncludeTools is not null)) return false;
        if (servers.Any(server => server.IncludeTools is not null && server.AllowsTool(name))) return false;
        return true;
    }

    private bool ExcludedByConfig(string name) => servers.Any(server => server.ExcludeTools?.Contains(name) == true);

    private static JsonObject DeniedToolResult(string? name) => new()
    {
        ["isError"] = true,
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "MCP tool is not allowed" + (name is null ? "" : ": " + name) })
    };
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
            ["capabilities"] = new JsonObject { ["extensions"] = new JsonObject { ["io.modelcontextprotocol/ui"] = new JsonObject { ["mimeTypes"] = new JsonArray("text/html;profile=mcp-app") } } }
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
