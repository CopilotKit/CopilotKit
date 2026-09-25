using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class ThreadResultTests
{
    internal static async Task RunAsync()
    {
        var untyped = new[] { "ListThreadsAsync", "GetThreadAsync", "CreateThreadAsync", "UpdateThreadAsync" }
            .Where(name => typeof(IntelligenceClient).GetMethod(name)!.ReturnType.GenericTypeArguments.Single() == typeof(JsonObject));
        if (untyped.Any() || typeof(ThreadEventArgs).GetProperty("Thread")!.PropertyType == typeof(JsonObject))
            throw new Exception("Thread results and lifecycle events need native metadata properties");
        await ReadsNativeMetadata();
        await RejectsInvalidMetadata();
    }

    private static async Task ReadsNativeMetadata()
    {
        const string json = """
            {"id":"canonical","name":null,"lastRunAt":"2026-09-09T01:00:00Z",
             "lastUpdatedAt":"2026-09-09T02:00:00Z","createdAt":"2026-09-08T00:00:00Z",
             "updatedAt":"2026-09-09T02:00:00Z","archived":false,"agentId":"agent",
             "createdById":"user","organizationId":"org","learningContainerId":"existing",
             "extension":{"value":9223372036854775807}}
            """;
        var page = new JsonObject
        {
            ["threads"] = new JsonArray(JsonNode.Parse(json)), ["joinCode"] = "join",
            ["joinToken"] = "token", ["nextCursor"] = "next", ["extension"] = true
        };
        using var handler = new CaptureHandler { ResponseBody = "{\"thread\":" + json + "}" };
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        ThreadSummary? notification = null;
        sdk.ThreadCreated += (_, args) => notification = args.Thread;

        ThreadSummary read = await sdk.GetThreadAsync("input", "user");
        ThreadSummary created = await sdk.CreateThreadAsync("input", "user", "agent", learningContainerId: "existing");
        ThreadSummary updated = await sdk.UpdateThreadAsync("input", "user", "agent", new JsonObject { ["name"] = "updated" });
        ThreadResolution resolution = await sdk.GetOrCreateThreadAsync("input", "user", "agent");
        handler.Responses.Enqueue((HttpStatusCode.OK, page.ToJsonString()));
        ListThreadsResponse listed = await sdk.ListThreadsAsync("user", "agent");

        Check(read.Id == "canonical" && read.Name is null && read.Archived == false
            && read.LastRunAt == "2026-09-09T01:00:00Z" && read.LastUpdatedAt == "2026-09-09T02:00:00Z"
            && read.CreatedAt == "2026-09-08T00:00:00Z" && read.UpdatedAt == "2026-09-09T02:00:00Z"
            && read.AgentId == "agent" && read.CreatedById == "user" && read.OrganizationId == "org",
            "thread metadata has native typed fields");
        Check(ReferenceEquals(notification, created) && !resolution.Created && resolution.Thread.Id == "canonical",
            "typed mutation returns the same record as its lifecycle event");
        Check(listed.JoinCode == "join" && listed.JoinToken == "token" && listed.NextCursor == "next"
            && listed.Threads.Single().ExtensionData["learningContainerId"].GetString() == "existing",
            "thread lists retain join credentials, pagination, and Learning assignment");
        Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(read), JsonNode.Parse(json))
            && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(updated), JsonNode.Parse(json))
            && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(listed), page),
            "thread records round trip their JSON names and extension values");
        Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(resolution), new JsonObject
        {
            ["thread"] = JsonNode.Parse(json), ["created"] = false
        }), "thread resolution preserves the thread and created JSON envelope");
    }

    private static async Task RejectsInvalidMetadata()
    {
        foreach (var json in new[] { "{\"threads\":[null],\"joinCode\":\"join\"}", "{\"threads\":[{\"id\":\" \"}],\"joinCode\":\"join\"}" })
        {
            using var handler = new CaptureHandler { ResponseBody = json };
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            try { await sdk.ListThreadsAsync("user", "agent"); throw new Exception("Invalid thread page was accepted: " + json); }
            catch (IntelligenceException error) when (error.StatusCode == 502 && error.InnerException is null) { }
        }
        foreach (var json in new[] { "{\"id\":\"thread\",\"name\":[]}", "{\"id\":\"thread\",\"archived\":\"PRIVATE_VALUE\"}" })
        {
            using var handler = new CaptureHandler { ResponseBody = "{\"thread\":" + json + "}" };
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            var notifications = 0;
            sdk.ThreadCreated += (_, _) => notifications++;
            sdk.ThreadUpdated += (_, _) => notifications++;
            foreach (var call in new Func<Task>[] {
                () => sdk.CreateThreadAsync("thread", "user", "agent"),
                () => sdk.UpdateThreadAsync("thread", "user", "agent", new JsonObject { ["name"] = "new" }) })
            {
                try { await call(); throw new Exception("Invalid thread metadata was accepted"); }
                catch (IntelligenceException error) when (error.StatusCode == 502 && error.InnerException is null && !error.ToString().Contains("PRIVATE_VALUE")) { }
            }
            Check(notifications == 0 && handler.Calls == 2, "invalid typed mutations emit no success event and do not retry writes");
        }
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }
}
