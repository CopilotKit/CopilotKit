using System.Net;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class ResourceTests
{
    private sealed record Case(string Name, string Method, string Path, string? Body, string Response,
        Func<IntelligenceClient, Task> Invoke, bool Memory = false, bool Grant = false);

    internal static async Task RunAsync()
    {
        var grant = new MemoryGrant(MemoryAccess.ReadWrite, MemoryAccess.Read);
        var cases = new Case[]
        {
            new("list threads", "GET", "/api/threads?userId=user&agentId=agent&includeArchived=true&limit=2&cursor=next%2Fpage", null,
                "{\"threads\":[],\"joinCode\":\"join\",\"nextCursor\":\"next\"}", async client =>
                {
                    var result = await client.ListThreadsAsync("user", "agent", true, 2, "next/page");
                    Check(result.JoinCode == "join" && result.NextCursor == "next", "list retains metadata and pagination");
                }),
            new("create thread with Learning assignment", "POST", "/api/threads",
                "{\"threadId\":\"thread\",\"userId\":\"user\",\"agentId\":\"agent\",\"name\":\"Title\",\"learningContainerId\":\"existing-container\"}",
                "{\"thread\":{\"id\":\"canonical\"}}", async client =>
                {
                    var thread = await client.CreateThreadAsync("thread", "user", "agent", "Title", "existing-container");
                    Check(thread.Id == "canonical", "create unwraps canonical thread");
                }),
            new("update identity", "PATCH", "/api/threads/thread%2Fid", "{\"name\":\"New\",\"userId\":\"user\",\"agentId\":\"agent\"}",
                "{\"thread\":{\"id\":\"canonical\"}}", async client =>
                {
                    var updates = JsonNode.Parse("{\"name\":\"New\",\"userId\":\"spoof\",\"agentId\":\"spoof\"}")!.AsObject();
                    await client.UpdateThreadAsync("thread/id", "user", "agent", updates);
                    Check(updates["userId"]!.GetValue<string>() == "spoof", "update leaves caller data unchanged");
                }),
            new("archive", "PATCH", "/api/threads/thread", "{\"archived\":true,\"userId\":\"user\",\"agentId\":\"agent\"}",
                "{\"thread\":{\"id\":\"thread\"}}", client => client.ArchiveThreadAsync("thread", "user", "agent")),
            new("delete", "DELETE", "/api/threads/thread", "{\"userId\":\"user\",\"agentId\":\"agent\",\"reason\":\"Deleted via CopilotKit SDK (userId=user, agentId=agent)\"}",
                "", client => client.DeleteThreadAsync("thread", "user", "agent")),
            new("messages", "GET", "/api/threads/thread/messages?userId=user", null, "{\"messages\":[]}", client => client.GetThreadMessagesAsync("thread", "user")),
            new("events", "GET", "/api/_inspect/threads/thread/events", null, "{\"events\":[],\"decodeErrorRowIds\":[],\"truncated\":false}", client => client.GetThreadEventsAsync("thread")),
            new("state", "GET", "/api/_inspect/threads/thread/state", null, "{\"kind\":\"no-snapshot\"}", client => client.GetThreadStateAsync("thread")),
            new("list memories", "GET", "/api/memories?includeInvalidated=true", null, "{\"memories\":[]}", client => client.ListMemoriesAsync("user", grant, true), true, true),
            new("create memory", "POST", "/api/memories", "{\"content\":\"Fact\",\"kind\":\"topical\",\"scope\":\"project\",\"sourceThreadIds\":[\"thread\"]}",
                "{\"id\":\"memory\",\"kind\":\"topical\",\"scope\":\"project\",\"content\":\"Fact\",\"sourceThreadIds\":[\"thread\"],\"invalidatedAt\":null,\"absorbed\":true}", async client =>
                {
                    var result = await client.CreateMemoryAsync("user", "Fact", "topical", "project", ["thread"], grant);
                    Check(result.Absorbed == true, "create retains absorbed marker");
                }, true, true),
            new("update memory", "PATCH", "/api/memories/memory%2Fid", "{\"content\":\"New fact\",\"kind\":\"topical\",\"sourceThreadIds\":[]}",
                "{\"id\":\"replacement\",\"kind\":\"topical\",\"scope\":\"user\",\"content\":\"New fact\",\"sourceThreadIds\":[],\"invalidatedAt\":null,\"retiredId\":\"memory/id\"}", async client =>
                {
                    var result = await client.UpdateMemoryAsync("memory/id", "user", "New fact", "topical");
                    Check(result.RetiredId == "memory/id", "update retains retired ID");
                }, true),
            new("remove memory", "DELETE", "/api/memories/memory", null, "", client => client.RemoveMemoryAsync("memory", "user", grant), true, true),
            new("recall memory", "POST", "/api/memories/recall", "{\"query\":\"question\",\"limit\":3,\"scope\":\"user\"}",
                "{\"memories\":[{\"id\":\"memory\",\"kind\":\"topical\",\"scope\":\"user\",\"content\":\"Fact\",\"sourceThreadIds\":[],\"invalidatedAt\":null,\"score\":0.75}]}", async client =>
                {
                    var result = await client.RecallMemoriesAsync("user", "question", 3, "user", grant);
                    Check(result.Memories[0].Score == .75, "recall retains score");
                }, true, true),
            new("annotation", "PUT", "/connector/annotate/event%2Fid", "{\"type\":\"feedback\",\"userId\":\"user\",\"threadId\":\"thread\",\"payload\":{\"rating\":1},\"occurredAt\":\"2026-09-09T00:00:00Z\"}",
                "{\"id\":\"event/id\",\"duplicate\":true}", async client =>
                {
                    var result = await client.AnnotateAsync("user", "thread", "feedback", "event/id", new JsonObject { ["rating"] = 1 }, "2026-09-09T00:00:00Z");
                    Check(result.Duplicate, "annotation retains duplicate marker");
                })
        };
        var failures = new List<string>();
        foreach (var test in cases)
        {
            using var handler = new CaptureHandler { ResponseBody = test.Response };
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key", ApiUrl = new Uri("https://platform.test") }, http);
            try
            {
                await test.Invoke(client);
                Check(handler.Calls == 1 && handler.Method == test.Method && handler.Url == "https://platform.test" + test.Path, test.Name + " method and URL");
                Check(test.Body is null ? handler.Body is null : JsonNode.DeepEquals(JsonNode.Parse(test.Body), JsonNode.Parse(handler.Body!)), test.Name + " payload");
                Check(handler.Authorization == "Bearer key", test.Name + " authentication");
                if (test.Memory) Check(handler.Headers["x-cpki-user-id"] == "user", test.Name + " application user");
                if (test.Grant) Check(JsonNode.DeepEquals(JsonNode.Parse(handler.Headers["x-cpki-memory-grant"]), JsonNode.Parse("{\"user\":\"read-write\",\"project\":\"read\"}")), test.Name + " grant");
                else Check(!handler.Headers.ContainsKey("x-cpki-memory-grant"), test.Name + " does not invent a grant");
            }
            catch (Exception error) { failures.Add(test.Name + ": " + error.Message); }
        }
        try { await ResolvesCreationRace(); }
        catch (Exception error) { failures.Add("creation race: " + error.Message); }
        try { await PreservesCreationFailures(); }
        catch (Exception error) { failures.Add("creation failures: " + error.Message); }
        try { await RejectsInvalidGrant(); }
        catch (Exception error) { failures.Add("invalid grant: " + error.Message); }
        if (failures.Count > 0) throw new Exception(string.Join("\n", failures));
    }

    private static async Task ResolvesCreationRace()
    {
        using var handler = new CaptureHandler();
        handler.Responses.Enqueue((HttpStatusCode.NotFound, ""));
        handler.Responses.Enqueue((HttpStatusCode.Conflict, ""));
        handler.Responses.Enqueue((HttpStatusCode.OK, "{\"thread\":{\"id\":\"canonical\"}}"));
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

        var result = await client.GetOrCreateThreadAsync("thread", "user", "agent", learningContainerId: "existing-container");

        Check(!result.Created && result.Thread.Id == "canonical", "concurrent creation returns the scoped existing thread");
        Check(handler.Requests.Select(request => request.Method).SequenceEqual(new[] { "GET", "POST", "GET" }), "creation conflict uses one scoped reread");
        Check(handler.Requests[0].Url == handler.Requests[2].Url && handler.Requests[2].Url.EndsWith("?userId=user"), "conflict reread preserves user scope");
        Check(JsonNode.Parse(handler.Requests[1].Body!)!["learningContainerId"]!.GetValue<string>() == "existing-container", "concurrent creation retains Learning assignment");
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }

    private static async Task PreservesCreationFailures()
    {
        foreach (var status in new[] { HttpStatusCode.Forbidden, HttpStatusCode.ServiceUnavailable })
        {
            using var handler = new CaptureHandler { StatusCode = status };
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            try { await client.GetOrCreateThreadAsync("thread", "user", "agent"); throw new Exception("lookup failure was accepted"); }
            catch (IntelligenceException error)
            {
                Check(error.StatusCode == (int)status && handler.Calls == 1, "failed lookup does not trigger creation");
            }
        }
        foreach (var exists in new[] { true, false })
        {
            using var handler = new CaptureHandler();
            if (!exists) handler.Responses.Enqueue((HttpStatusCode.NotFound, ""));
            handler.Responses.Enqueue((HttpStatusCode.OK, "{\"thread\":{\"id\":\"thread\"}}"));
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            var result = await client.GetOrCreateThreadAsync("thread", "user", "agent");

            Check(result.Created == !exists && handler.Calls == (exists ? 1 : 2), "created flag distinguishes a lookup from a new thread");
        }
    }

    private static async Task RejectsInvalidGrant()
    {
        using var handler = new CaptureHandler();
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

        try
        {
            await client.ListMemoriesAsync("user", new MemoryGrant((MemoryAccess)999, MemoryAccess.Read));
            throw new Exception("invalid grant was accepted");
        }
        catch (ArgumentOutOfRangeException)
        {
            Check(handler.Calls == 0, "invalid grant fails before platform I/O");
        }
    }
}
