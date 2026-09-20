using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class MemoryResultTests
{
    internal static async Task RunAsync()
    {
        await RejectsMalformedResults();
        await PreservesTypedResults();
        foreach (var name in new[] { "ListMemoriesAsync", "RecallMemoriesAsync", "CreateMemoryAsync", "UpdateMemoryAsync" })
        {
            var result = typeof(IntelligenceClient).GetMethod(name)!.ReturnType.GenericTypeArguments.Single();
            if (result == typeof(JsonObject)) throw new Exception(name + " has no native Memory result properties");
        }
    }

    private static async Task PreservesTypedResults()
    {
        const string memory = """
            {"id":"memory","kind":"topical","scope":"user","content":"Use C#",
             "sourceThreadIds":["thread"],"invalidatedAt":null,"score":0.75,
             "extension":{"number":9223372036854775807,"nested":[null,true]}}
            """;
        var savedJson = JsonNode.Parse(memory)!.AsObject();
        savedJson["absorbed"] = false;
        savedJson["retiredId"] = "retired-memory";
        var listJson = new JsonObject { ["memories"] = new JsonArray(JsonNode.Parse(memory)), ["extension"] = "retained" };
        using var handler = new CaptureHandler();
        handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, listJson.ToJsonString()));
        handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, listJson.ToJsonString()));
        handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, savedJson.ToJsonString()));
        handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, savedJson.ToJsonString()));
        handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, memory));
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

        ListMemoriesResponse listed = await client.ListMemoriesAsync("user");
        RecallMemoriesResponse recalled = await client.RecallMemoriesAsync("user", "language");
        SaveMemoryResponse created = await client.CreateMemoryAsync("user", "Use C#", "topical");
        SaveMemoryResponse updated = await client.UpdateMemoryAsync("memory", "user", "Use C#", "topical");
        SaveMemoryResponse noMarkers = await client.CreateMemoryAsync("user", "Use C#", "topical");
        MemorySummary first = listed.Memories.Single();

        if (first.Id != "memory" || first.Kind != "topical" || first.Scope != "user" || first.Content != "Use C#"
            || !first.SourceThreadIds.SequenceEqual(["thread"]) || first.InvalidatedAt is not null || first.Score != .75
            || first.ExtensionData["extension"].GetProperty("number").GetInt64() != long.MaxValue
            || created.Absorbed != false || updated.RetiredId != "retired-memory"
            || noMarkers.Absorbed is not null || noMarkers.RetiredId is not null)
            throw new Exception("Native Memory properties changed response values");
        if (!JsonNode.DeepEquals(JsonSerializer.SerializeToNode(listed), listJson)
            || !JsonNode.DeepEquals(JsonSerializer.SerializeToNode(recalled), listJson)
            || !JsonNode.DeepEquals(JsonSerializer.SerializeToNode(created), savedJson)
            || !JsonNode.DeepEquals(JsonSerializer.SerializeToNode(updated), savedJson)
            || !JsonNode.DeepEquals(JsonSerializer.SerializeToNode(noMarkers), JsonNode.Parse(memory)))
            throw new Exception("Memory record serialization changed JSON field names or values");
        if (handler.Calls != 5) throw new Exception("Memory reads or writes repeated their requests");
        Console.WriteLine("PASS typed Memory results retain nullable fields, markers, scores, and extension JSON");
    }

    private static async Task RejectsMalformedResults()
    {
        foreach (var json in new[] { "{}", "{\"memories\":null}", "{\"memories\":[{}]}", "{\"memories\":\"PRIVATE_MEMORY\"}",
            "{\"memories\":[null]}",
            """{"memories":[{"id":"m","kind":"topical","scope":"user","content":"PRIVATE_MEMORY","sourceThreadIds":[null],"invalidatedAt":null}]}""" })
        {
            using var handler = new CaptureHandler { ResponseBody = json };
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            try
            {
                await client.ListMemoriesAsync("user");
                throw new Exception("Malformed Memory result was accepted: " + json);
            }
            catch (IntelligenceException error)
            {
                if (error.StatusCode != 502 || error.InnerException is not null || error.ToString().Contains("PRIVATE_MEMORY"))
                    throw new Exception("Malformed Memory result must return a safe 502");
            }
        }
    }
}
