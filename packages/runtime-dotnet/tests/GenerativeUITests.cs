using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

/// <summary>Generative UI (A2UI 1.0), the A2UI v0.9 bridge, and their wiring, as the TypeScript and Python runtimes do them.</summary>
internal static class GenerativeUITests
{
    private const string Basic = "https://a2ui.org/specification/v0_9/basic_catalog.json";
    private const string Standard = "copilotkit/standard@1";
    private const string Guide = "Generative UI guide: available components, functions, targets, and how to call render_ui.";
    private const string Schema = "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";
    private const string ProductCard = """{"description":"A product","props":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}},"required":["name"]},"events":{"onBuy":{"description":"Buys it","parameters":{}}},"slots":{"footer":"single","children":"multiple"}}""";
    private const string Text = """{"props":{"type":"object","properties":{"text":{"type":"string"}}}}""";
    private const string Click = """{"version":"1.0","action":{"name":"confirm","surfaceId":"card","sourceComponentId":"button","timestamp":"2026-10-20T10:00:00.000Z","context":{"selected":2}}}""";
    private const string UserAction = """{"name":"confirm","surfaceId":"card","sourceComponentId":"button","context":{"selected":2},"timestamp":"2026-10-20T10:00:00.000Z"}""";

    internal static async Task RunAsync()
    {
        Check(!typeof(GenerativeUIAgent).IsVisible && !typeof(A2UIV09BridgeAgent).IsVisible && !typeof(A2UIAgent).IsVisible && !typeof(A2UIOptions).IsVisible, "generative UI middleware remains an internal implementation detail");
        Options();
        Envelope();
        Guide_();
        Validation();
        await RenderUIAsync();
        Upgrade();
        Upgrader();
        NativeV10();
        Patch();
        Clicks();
        Catalog();
        await WiringAsync();
        await InfoAsync();
    }

    private static void Options()
    {
        var parsed = GenerativeUIOptions.FromJson(JsonNode.Parse("""{"agents":["default"],"a2uiVersion":{"legacy":"0.9"},"injectA2UITool":"custom_render","a2uiToolNames":["x"],"recovery":{"maxAttempts":2,"debugExposure":"verbose"}}"""))!;
        Check(parsed.Enabled && parsed.Agents!.SequenceEqual(["default"]) && parsed.InjectA2UITool == true && parsed.A2UIToolName == "custom_render"
            && parsed.A2UIToolNames!.SequenceEqual(["x"]) && parsed.MaxAttempts == 2 && parsed.DebugExposure == "verbose", "generativeUI JSON maps to the options");
        Check(parsed.VersionOf("legacy") == "0.9" && parsed.VersionOf("current") == "1.0", "an agent missing from the version map speaks 1.0");
        Check(GenerativeUIOptions.FromJson(JsonValue.Create(false))!.Enabled == false && GenerativeUIOptions.FromJson(JsonValue.Create(true))!.Enabled && GenerativeUIOptions.FromJson(null) is null, "generativeUI accepts true, false, and omission");
        Check(GenerativeUI.ResolveVersion(null, "legacy") == "1.0" && GenerativeUI.ResolveVersion(new GenerativeUIOptions { A2UIVersion = "0.9" }, "any") == "0.9", "a2uiVersion resolves per agent");
        Check(GenerativeUI.Info(null).ToJsonString() == """{"enabled":true}""" && GenerativeUI.Info(new GenerativeUIOptions { Enabled = false }).ToJsonString() == """{"enabled":false}"""
            && GenerativeUI.Info(new GenerativeUIOptions { Agents = ["legacy", "current"] }).ToJsonString() == """{"enabled":true,"agents":["legacy","current"]}""", "/info reports generativeUI");
        foreach (var invalid in new[] { new GenerativeUIOptions { A2UIVersion = "2.0" }, new GenerativeUIOptions { A2UIVersions = new Dictionary<string, string> { ["a"] = "0.8" } }, new GenerativeUIOptions { A2UIToolName = "" }, new GenerativeUIOptions { MaxAttempts = 0 } })
        {
            try { invalid.Validate(); throw new Exception("invalid generative UI configuration accepted"); }
            catch (ArgumentException) { }
        }
        Check(true, "invalid generative UI configuration fails at construction");
        Check(GenerativeUI.IsRun(null, "default", Forwarded()) && !GenerativeUI.IsRun(null, "default", new JsonObject())
            && GenerativeUI.IsRun(new GenerativeUIOptions(), "default", new JsonObject()) && !GenerativeUI.IsRun(new GenerativeUIOptions(), "default", Forwarded(transport: "markdown"))
            && !GenerativeUI.IsRun(new GenerativeUIOptions { Enabled = false }, "default", Forwarded()) && !GenerativeUI.IsRun(new GenerativeUIOptions { Agents = ["other"] }, "default", Forwarded()),
            "generative UI runs follow the option, the transport, and the agent scope");
        var tool = GenerativeUI.A2UIOptionsFor(new GenerativeUIOptions { A2UIVersion = "0.9" }, "0.9", Forwarded());
        var none = GenerativeUI.A2UIOptionsFor(new GenerativeUIOptions { A2UIVersion = "0.9" }, "0.9", new JsonObject());
        var explicitOff = GenerativeUI.A2UIOptionsFor(new GenerativeUIOptions { InjectA2UITool = false }, "0.9", Forwarded());
        var current = GenerativeUI.A2UIOptionsFor(new GenerativeUIOptions { InjectA2UITool = true, Schema = new JsonObject() }, "1.0", Forwarded());
        Check(tool.InjectTool && !none.InjectTool && !explicitOff.InjectTool && !current.InjectTool && current.Schema is null, "a 0.9 agent gets render_a2ui for a tool catalog; a 1.0 agent gets extraction only");
    }

    private static void Envelope()
    {
        Check(GenerativeUI.ReadToolManifest(Forwarded()) is { CatalogId: "shop", HasComponents: true }, "a tool envelope with components gives the manifest");
        var malformed = Forwarded(); malformed["copilotkit"]!["ui"]!["1.0"] = new JsonObject();
        var badFormat = Forwarded(); badFormat["copilotkit"]!["ui"]!["metadata"]!["extensions"]!["copilotkit_format"] = 2;
        foreach (var (label, forwarded) in new[] { ("markdown", Forwarded(transport: "markdown")), ("no-components", Forwarded(noComponents: true)), ("malformed", malformed), ("format", badFormat), ("missing", new JsonObject()) })
            Check(GenerativeUI.ReadToolManifest(forwarded) is null, "a run without a tool catalog passes: " + label);
    }

    private static void Guide_()
    {
        var manifest = GenerativeUI.ReadToolManifest(Forwarded())!;
        var input = JsonNode.Parse($$"""{"tools":[{"name":"render_ui","description":"stale"},{"name":"search"}],"context":[{"description":"{{Guide}}","value":"stale"}]}""")!.AsObject();
        var original = input.ToJsonString();
        var prepared = new GenerativeUIAgent(new Fixed([]), manifest).Prepare(input);
        Check(input.ToJsonString() == original, "render_ui preparation does not mutate the client input");
        Check(Names(prepared["tools"]).SequenceEqual(["search", "render_ui"]), "the agent gets one render_ui tool");
        Check(prepared["tools"]![1]!["parameters"]!["properties"]!["target"]!["enum"]!.ToJsonString() == """["chat","side"]""", "render_ui targets come from the client");
        var guide = prepared["context"]!.AsArray().Single()!;
        var text = guide["value"]!.GetValue<string>();
        Check(guide["description"]!.GetValue<string>() == Guide && text.Contains("- \"side\" (a named area of the app; only Text)") && text.Contains("  props: {\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}")
            && text.Contains("  slot props (component ids): {\"footer\":\"single\",\"children\":\"multiple\"}"), "the guide replaces a stale guide and lists targets and components");
        var plain = GenerativeUI.BuildPrompt(GenerativeUI.ReadToolManifest(Forwarded(components: new JsonObject { ["Text"] = JsonNode.Parse(Text) }))!);
        Check(text.Contains("Event props take an action:") && text.Contains("give a multiple slot a template") && !plain.Contains("Event props take an action") && !plain.Contains("give a multiple slot a template"),
            "the guide includes feature rules only when the catalog uses them");
        var surfaces = GenerativeUI.BuildPrompt(GenerativeUI.ReadToolManifest(Forwarded(surfaces: """{"cart":{"target":"chat","dataModel":{"qty":2},"rejected":["operation 1: bad"]},"old":{"target":"chat","status":"deleted"}}"""))!);
        Check(surfaces.Contains("- \"cart\" (target \"chat\")\n  user values: {\"qty\":2}\n  rejected: operation 1: bad") && surfaces.Contains("- \"old\" (target \"chat\", deleted: never use this id again)")
            && surfaces.Contains("User values are what the user entered"), "the guide lists existing surfaces with user values and rejections");
    }

    private static void Validation()
    {
        var manifest = GenerativeUI.ReadToolManifest(Forwarded())!;
        foreach (var (component, reason) in new[]
        {
            ("""{"id":"a","component":"Text","text":{"path":"/x"}}""", "component \"a\": text: bind data with {\"@path\": \"/x\"}, not {\"path\": \"/x\"}"),
            ("""{"id":"a","component":"Text","size":1}""", "component \"a\": unknown prop \"size\""),
            ("""{"id":"a","component":"ProductCard"}""", "component \"a\": missing required prop \"name\""),
            ("""{"id":"a","component":"ProductCard","name":"x","footer":"a"}""", "component \"a\": footer: a component cannot be its own child"),
            ("""{"id":"a","component":"ProductCard","name":"x","onBuy":{"event":"buy"}}""", "component \"a\": onBuy: event.name is required"),
            ("""{"id":"a","component":"Text","text":{"@call":"openUrl"}}""", "component \"a\": text: \"openUrl\" runs only from an event; a data prop can call only @index and the built-in functions (required, regex, length, numeric, email, formatString, formatNumber, formatCurrency, formatDate, pluralize, and, or, not, calc, series)"),
            ("""{"id":"a","component":"ProductCard","name":"x","children":{"componentId":"b","path":"/__proto__"}}""", "component \"a\": children: path segment \"__proto__\" is not allowed in template path"),
        })
        {
            var op = JsonNode.Parse($$$"""{"version":"1.0","updateComponents":{"surfaceId":"s","components":[{{{component}}}]}}""");
            Check(GenerativeUI.ValidateOperation(op, manifest, ["s"], functions: []) == reason, "validation rejects with the TypeScript reason: " + reason);
        }
        Check(GenerativeUI.ValidateOperation(JsonNode.Parse("""{"version":"1.0","deleteSurface":{"surfaceId":"s"}}"""), manifest, []) == "surface \"s\" does not exist; send createSurface first"
            && GenerativeUI.ValidateOperation(JsonNode.Parse("""{"version":"1.0","updateDataModel":{"surfaceId":"s"}}"""), manifest, ["s"]) == "updateDataModel.value is required; use \"value\":null to delete"
            && GenerativeUI.ValidateOperation(JsonNode.Parse("""{"deleteSurface":{"surfaceId":"s"}}"""), manifest, ["s"]) == "operation needs \"version\":\"1.0\"",
            "validation requires a version, an existing surface, and a value");
    }

    private static async Task RenderUIAsync()
    {
        var create = """{"version":"1.0","createSurface":{"surfaceId":"card","catalogId":"unknown","components":[{"id":"root","component":"ProductCard","name":"A","footer":"t"}]}}""";
        var update = """{"version":"1.0","updateComponents":{"surfaceId":"card","components":[{"id":"t","component":"Text"}]}}""";
        var invalid = """{"version":"1.0","updateComponents":{"surfaceId":"card","components":[{"id":"x","component":"Nope"}]}}""";
        var args = $$"""{"target":"chat","operations":[{{create}},{{update}},{{invalid}}]}""";
        var events = await RenderAsync([.. Call("call", args[..60], args[60..]), Event("RUN_FINISHED")]);
        var snapshot = events.Single(item => Type(item) == "ACTIVITY_SNAPSHOT");
        Check(snapshot["messageId"]!.GetValue<string>() == "genui:card" && snapshot["content"]!["catalogId"]!.GetValue<string>() == "shop"
            && snapshot["content"]!["operations"]![0]!["createSurface"]!["catalogId"]!.GetValue<string>() == "shop", "a streamed createSurface paints one surface in the run's catalog");
        var deltas = events.Where(item => Type(item) == "ACTIVITY_DELTA").Select(item => JsonText.Compact(item["patch"])).ToList();
        var rejection = """{"index":2,"reason":"component \"x\": unknown component \"Nope\""}""";
        Check(deltas.SequenceEqual([$$"""[{"op":"add","path":"/operations/-","value":{{update}}}]""", $$"""[{"op":"add","path":"/rejected/-","value":{{rejection}}}]""", """[{"op":"replace","path":"/status","value":"ready"}]"""]),
            "further operations patch the surface and a rejected one is reported on it");
        Check(Type(events[^1]) == "RUN_FINISHED" && Type(events[^2]) == "TOOL_CALL_RESULT" && events[^2]["content"]!.GetValue<string>() == $$"""{"status":"rendered","applied":2,"calls":0,"rejected":[{{rejection}}]}""",
            "render_ui is answered before RUN_FINISHED with compact JSON");

        var late = await RenderAsync([.. Call("call", """{"operations":[{"version":"1.0","createSurface":{"surfaceId":"panel"}},{"version":"1.0","updateComponents":{"surfaceId":"panel","components":[{"id":"root","component":"ProductCard","name":"A"}]}}],"target":"side"}"""), Event("RUN_FINISHED")]);
        Check(late.Single(item => Type(item) == "ACTIVITY_SNAPSHOT")["content"]!["target"]!.GetValue<string>() == "side"
            && JsonNode.Parse(late[^2]["content"]!.GetValue<string>())!["rejected"]!.ToJsonString() == JsonNode.Parse("""[{"index":1,"reason":"component \"root\": \"ProductCard\" is not allowed in target \"side\"; use one of: Text"}]""")!.ToJsonString(),
            "operations wait for a late target and respect its components");

        var encoded = JsonValue.Create("""[{"version":"1.0","createSurface":{"surfaceId":"late"}}]""").ToJsonString();
        var recovered = await RenderAsync([.. Call("call", $$"""{"target":"chat","operations":{{encoded}}}"""), Event("RUN_FINISHED")]);
        Check(recovered.Where(item => Type(item) == "ACTIVITY_SNAPSHOT").Select(item => item["messageId"]!.GetValue<string>()).SequenceEqual(["genui:late"]), "operations sent as a string are recovered");

        var answered = await RenderAsync([.. Call("empty", """{"target":"chat"}"""), .. Call("answered", """{"target":"chat","operations":[]}"""),
            new JsonObject { ["type"] = "TOOL_CALL_RESULT", ["toolCallId"] = "answered", ["content"] = "ok" }, Event("RUN_FINISHED")]);
        var results = answered.Where(item => Type(item) == "TOOL_CALL_RESULT").ToList();
        Check(results.Select(item => item["toolCallId"]!.GetValue<string>()).SequenceEqual(["answered", "empty"]) && JsonNode.Parse(results[1]["content"]!.GetValue<string>())!["status"]!.GetValue<string>() == "error"
            && Type(answered[^1]) == "RUN_FINISHED", "answered calls get no result and an empty call reports an error");

        var existing = await RenderAsync([.. Call("call", """{"target":"chat","operations":[{"version":"1.0","updateDataModel":{"surfaceId":"live","path":"/x","value":1}},{"version":"1.0","createSurface":{"surfaceId":"gone"}},{"version":"1.0","createSurface":{"surfaceId":"live"}}]}"""), Event("RUN_FINISHED")],
            Forwarded(surfaces: """{"live":{"target":"chat"},"gone":{"target":"chat","status":"deleted"}}"""));
        var reasons = JsonNode.Parse(existing[^2]["content"]!.GetValue<string>())!["rejected"]!.AsArray().Select(entry => entry!["reason"]!.GetValue<string>());
        var firstPatch = existing.First(item => Type(item) == "ACTIVITY_DELTA")["patch"]!.AsArray();
        Check(reasons.SequenceEqual(["surface id \"gone\" was used before; use a new surfaceId", "surface \"live\" already exists"])
            && JsonText.Compact(firstPatch[0]) == """{"op":"replace","path":"/status","value":"streaming"}""" && JsonText.Compact(firstPatch[1]) == """{"op":"replace","path":"/rejected","value":[]}""",
            "existing and deleted surfaces follow the client summary");
    }

    private const string PlanV09 = """
        [{"version":"v0.9","createSurface":{"surfaceId":"plans","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}},
         {"version":"v0.9","updateComponents":{"surfaceId":"plans","components":[
           {"id":"root","component":"Column","children":["title","choose"]},
           {"id":"title","component":"Text","text":{"path":"/title"}},
           {"id":"choose","component":"Button","child":"label","action":{"event":{"name":"choose","context":{"plan":{"path":"/plan"}}}}}]}},
         {"version":"v0.9","updateDataModel":{"surfaceId":"plans","path":"/","value":{}}}]
        """;

    private static void Upgrade()
    {
        var (operations, dropped) = A2UIUpgrade.UpgradeOperations(JsonNode.Parse(PlanV09));
        Check(dropped.Count == 0 && JsonText.Compact(new JsonArray(operations.ToArray<JsonNode?>())) == """[{"version":"1.0","createSurface":{"surfaceId":"plans","catalogId":"copilotkit/standard@1"}},{"version":"1.0","updateComponents":{"surfaceId":"plans","components":[{"id":"root","component":"Column","children":["title","choose"]},{"id":"title","component":"Text","text":{"@path":"/title"}},{"id":"choose","component":"Button","child":"label","onClick":{"event":{"name":"choose","context":{"plan":{"@path":"/plan"}}}}}]}},{"version":"1.0","updateDataModel":{"surfaceId":"plans","path":"/","value":{}}}]""",
            "v0.9 operations convert to A2UI 1.0");
        var components = """[{"id":"h","component":"Text","variant":"h1","weight":"bold","text":"T"},{"id":"c","component":"Text","variant":"caption","weight":"bold","text":"c"},{"id":"b","component":"Text","variant":"body","text":"b"},{"id":"f","component":"TextField","value":{"path":"/email"},"validationRegexp":"@"},{"id":"n","component":"Text","text":{"call":"formatNumber","args":{"value":1}}}]""";
        var (converted, _) = A2UIUpgrade.UpgradeOperations(JsonNode.Parse($$$"""[{"updateComponents":{"surfaceId":"s","components":{{{components}}}}}]"""));
        Check(JsonText.Compact(converted[0]["updateComponents"]!["components"]) == """[{"id":"h","component":"Title","text":"T","size":"2xl"},{"id":"c","component":"Caption","text":"c"},{"id":"b","component":"Text","text":"b"},{"id":"f","component":"TextField","value":{"@path":"/email"},"checks":[{"condition":{"@call":"regex","args":{"value":{"@path":"/email"},"pattern":"@"}}}]},{"id":"n","component":"Text","text":{"@call":"formatNumber","args":{"value":1}}}]""",
            "basic catalog props take their standard catalog form");
        var (kept, rejected) = A2UIUpgrade.UpgradeOperations(JsonNode.Parse("""[{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"items"}},{"version":"v0.9","updateDataModel":{"surfaceId":"s"}},{"version":"1.0","deleteSurface":{"surfaceId":"s"}},{"version":"v0.8","deleteSurface":{"surfaceId":"s"}},{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/","value":3}},{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"x"}]}}]"""));
        Check(JsonText.Compact(kept[0]["updateDataModel"]) == """{"surfaceId":"s","path":"/items","value":null}""" && JsonText.Compact(kept[1]["updateDataModel"]) == """{"surfaceId":"s","path":"/","value":{}}"""
            && JsonText.Compact(kept[2]) == """{"version":"1.0","deleteSurface":{"surfaceId":"s"}}"""
            && rejected.Select(entry => entry.Reason).SequenceEqual(["unsupported A2UI version \"v0.8\"; only v0.9 and 1.0 operations are supported", "a root updateDataModel value must be a JSON object in A2UI 1.0", "component \"x\": the component type must be a string (the v0.9 flat format)"]),
            "left-out values remove and unconvertible operations are dropped with the reason");
    }

    private static JsonObject Activity(string messageId, JsonNode operations) => new() { ["type"] = "ACTIVITY_SNAPSHOT", ["messageId"] = messageId, ["activityType"] = "a2ui-surface", ["content"] = new JsonObject { ["a2ui_operations"] = operations }, ["replace"] = true };

    private static void FailedLifecycle()
    {
        var upgrader = new A2UIV09ActivityUpgrader();
        List<JsonObject> Lifecycle(string messageId, JsonObject content)
        {
            var activity = Activity(messageId, new JsonArray());
            activity["content"] = content;
            return upgrader.Transform(activity);
        }
        Check(Lifecycle("a2ui-surface-call1", new JsonObject { ["status"] = "retrying", ["attempt"] = 2 }).Count == 0, "a retrying lifecycle snapshot is consumed");
        var failed = Lifecycle("a2ui-surface-call1", new JsonObject { ["status"] = "failed", ["error"] = "root is missing", ["attempts"] = new JsonArray() });
        Check(failed.Count == 1 && JsonText.Compact(failed[0]) == $$$"""{"type":"ACTIVITY_SNAPSHOT","messageId":"genui:a2ui-surface-call1","activityType":"generative-ui-surface","content":{"surfaceId":"a2ui-surface-call1","target":"chat","catalogId":"{{{Standard}}}","operations":[],"status":"error","rejected":[{"index":0,"reason":"root is missing"}],"a2uiSourceVersion":"0.9"},"replace":true}""",
            "a failed lifecycle snapshot becomes an error surface");
        Check(Lifecycle("a2ui-surface-call1", new JsonObject { ["status"] = "failed", ["error"] = "root is missing" }).Count == 0, "the error surface is sent once");
        var longError = Lifecycle("a2ui-surface-call2", new JsonObject { ["status"] = "failed", ["error"] = new string('x', 600) }).Single();
        Check(longError["content"]!["rejected"]![0]!["reason"]!.GetValue<string>().Length == 500, "a long error is cut to the rejection length");
        var generic = Lifecycle("a2ui-surface-call3", new JsonObject { ["status"] = "failed" }).Single();
        Check(JsonText.Compact(generic["content"]!["rejected"]) == """[{"index":0,"reason":"A2UI generation failed"}]""", "a failed snapshot with no error gets a generic reason");
    }

    private static JsonArray ProgressiveRender(string components, string data) => JsonNode.Parse($$$"""[{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}},{"version":"v0.9","updateComponents":{"surfaceId":"s","components":{{{components}}}}},{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/","value":{{{data}}}}}]""")!.AsArray();

    private static void ProgressiveRewrite()
    {
        var upgrader = new A2UIV09ActivityUpgrader();
        const string draft = """[{"id":"root","component":"Text","text":"Loading"}]""";
        const string final = """[{"id":"root","component":"Column","children":["title"]},{"id":"title","component":"Text","text":"Q2"}]""";
        var sent = upgrader.Transform(Activity("m", ProgressiveRender(draft, "{}"))).Single()["content"]!["operations"]!.AsArray();
        var ops = upgrader.Transform(Activity("m", ProgressiveRender(final, "{}"))).Single()["content"]!["operations"]!.AsArray();
        // The operation at the last applied index is unchanged, so the client applies only what comes after it.
        Check(ops.Count == 5 && JsonText.Compact(new JsonArray(ops.Take(3).Select(op => op!.DeepClone()).ToArray())) == JsonText.Compact(sent)
            && ops[3]!["updateComponents"]!["components"]![0]!["component"]!.GetValue<string>() == "Column" && ops[4]!["updateDataModel"] is not null,
            "the components that a progressive render rewrites are appended");
        var rebuild = new A2UIV09ActivityUpgrader();
        rebuild.Transform(Activity("m", ProgressiveRender(final, """{"name":"A"}""")));
        var next = rebuild.Transform(Activity("m", ProgressiveRender(final, """{"name":"Ada"}"""))).Single()["content"]!["operations"]!.AsArray();
        Check(next.Count == 3 && next[2]!["updateDataModel"]!["value"]!["name"]!.GetValue<string>() == "Ada", "new operations go as they are when the client builds the surface again");
    }

    private static void Upgrader()
    {
        var plan = JsonNode.Parse(PlanV09)!.AsArray();
        var upgrader = new A2UIV09ActivityUpgrader();
        var building = Activity("m", new JsonArray()); building["content"] = new JsonObject { ["status"] = "building" };
        Check(upgrader.Transform(building).Count == 0, "a lifecycle snapshot names no surface and is consumed");
        FailedLifecycle();
        ProgressiveRewrite();
        var first = upgrader.Transform(Activity("m", new JsonArray(plan[0]!.DeepClone(), plan[1]!.DeepClone()))).Single();
        Check(first["messageId"]!.GetValue<string>() == "genui:plans" && first["content"]!["status"]!.GetValue<string>() == "ready" && first["content"]!["a2uiSourceVersion"]!.GetValue<string>() == "0.9"
            && first["content"]!["target"]!.GetValue<string>() == "chat" && first["content"]!["catalogId"]!.GetValue<string>() == Standard, "a v0.9 surface becomes one ready 1.0 chat surface");
        var delta = new JsonObject { ["type"] = "ACTIVITY_DELTA", ["messageId"] = "m", ["activityType"] = "a2ui-surface", ["patch"] = new JsonArray(new JsonObject { ["op"] = "add", ["path"] = "/a2ui_operations/-", ["value"] = plan[2]!.DeepClone() }) };
        Check(upgrader.Transform(delta).Single()["content"]!["operations"]!.AsArray().Count == 3, "a v0.9 delta sends the cumulative surface");
        Check(upgrader.Transform(Activity("m", plan.DeepClone())).Count == 0, "unchanged content is not sent again");
        var bad = new JsonObject { ["type"] = "ACTIVITY_DELTA", ["messageId"] = "m", ["activityType"] = "a2ui-surface", ["patch"] = JsonNode.Parse("""[{"op":"replace","path":"/missing/x","value":1}]""") };
        Check(upgrader.Transform(bad).Count == 0, "a patch that does not apply is skipped");
        var other = new JsonObject { ["type"] = "ACTIVITY_SNAPSHOT", ["activityType"] = "mcp-apps", ["content"] = new JsonObject() };
        Check(ReferenceEquals(upgrader.Transform(other).Single(), other), "other activities pass through");
        var earlier = new A2UIV09ActivityUpgrader().Transform(Activity("m", JsonNode.Parse("""[{"version":"v0.9","updateDataModel":{"surfaceId":"old","path":"/a","value":1}},{"updateComponents":{"surfaceId":"old"}}]""")!)).Single();
        Check(Type(earlier) == "ACTIVITY_DELTA" && earlier["messageId"]!.GetValue<string>() == "genui:old"
            && JsonText.Compact(earlier["patch"]) == """[{"op":"add","path":"/operations/-","value":{"version":"1.0","updateDataModel":{"surfaceId":"old","path":"/a","value":1}}},{"op":"replace","path":"/rejected","value":[{"index":1,"reason":"updateComponents.components must be a non-empty array"}]}]""",
            "updates of a surface from an earlier run are appended as a delta");
    }

    // The native 1.0 operations of an ADK agent: the fixture of #8353, from ag-ui #3374
    // test_a2ui_protocol_versions.py::_ops at 89a59e1.
    private const string AdkV10 = """[{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}},{"version":"1.0","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Hello"}]}},{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{}}}]""";

    private static void NativeV10()
    {
        var adkOperations = """[{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"copilotkit/standard@1"}},{"version":"1.0","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Hello"}]}},{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{}}}]""";
        var input = JsonNode.Parse(AdkV10)!.AsArray();
        input.Add(JsonNode.Parse("""{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","components":[{"id":"title","component":"Text","variant":"h2","text":"Profile"},{"id":"save","component":"Button","child":"label","action":{"event":{"name":"save"}}}],"dataModel":{"name":"Ada"}}}"""));
        input.Add(JsonNode.Parse("""{"version":"1.0","createSurface":{"surfaceId":"c","catalogId":"https://example.test/catalog"}}"""));
        var (operations, dropped) = A2UIUpgrade.UpgradeOperations(input);
        Check(dropped.Count == 0 && JsonText.Compact(new JsonArray(operations.ToArray<JsonNode?>())) == adkOperations.TrimEnd(']') + ""","""
            + """{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"copilotkit/standard@1","components":[{"id":"title","component":"Title","text":"Profile","size":"xl"},{"id":"save","component":"Button","child":"label","onClick":{"event":{"name":"save"}}}],"dataModel":{"name":"Ada"}}},"""
            + """{"version":"1.0","createSurface":{"surfaceId":"c","catalogId":"https://example.test/catalog"}}]""",
            "native 1.0 operations keep their form; the 1.0 basic catalog becomes the standard catalog");

        var mixed = JsonNode.Parse(AdkV10)!.AsArray();
        mixed.Add(JsonNode.Parse("""{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/x","value":1}}"""));
        var native = new A2UIV09ActivityUpgrader().Transform(Activity("m", mixed)).Single();
        Check(native["messageId"]!.GetValue<string>() == "genui:s" && JsonText.Compact(native["content"]) == $$"""{"surfaceId":"s","target":"chat","catalogId":"copilotkit/standard@1","operations":{{adkOperations}},"status":"ready","rejected":[{"index":3,"reason":"surface \"s\" is A2UI 1.0; an A2UI 0.9 operation cannot change it"}]}""",
            "a native 1.0 surface has no a2uiSourceVersion and rejects a v0.9 operation");
        var converted = new A2UIV09ActivityUpgrader().Transform(Activity("m", JsonNode.Parse("""[{"version":"v0.9","createSurface":{"surfaceId":"plans","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}},{"version":"1.0","deleteSurface":{"surfaceId":"plans"}}]""")!)).Single();
        Check(converted["content"]!["a2uiSourceVersion"]!.GetValue<string>() == "0.9"
            && JsonText.Compact(converted["content"]!["rejected"]) == """[{"index":1,"reason":"surface \"plans\" is A2UI 0.9; an A2UI 1.0 operation cannot change it"}]""",
            "a v0.9 surface keeps its tag and rejects a 1.0 operation");
        var untagged = ClickInput(Forwarded(action: Click, surfaces: """{"card":{"target":"chat"}}"""));
        Check(ReferenceEquals(A2UIUpgrade.DowngradeAction(untagged, "0.9"), untagged), "a click on a native 1.0 surface reaches even a 0.9 agent unchanged");
    }

    private static void Patch()
    {
        var result = A2UIUpgrade.ApplyJsonPatch(JsonNode.Parse("""{"a":[1,2],"b":{"c":1}}"""), JsonNode.Parse("""[{"op":"add","path":"/a/1","value":9},{"op":"remove","path":"/a/0"},{"op":"move","from":"/b/c","path":"/d"},{"op":"copy","from":"/d","path":"/a/-"},{"op":"test","path":"/a","value":[9,2,1]}]"""));
        Check(JsonText.Compact(result) == """{"a":[9,2,1],"b":{},"d":1}""", "JSON patch applies RFC 6902 operations");
        foreach (var patch in new[] { """[{"op":"replace","path":"/x","value":1}]""", """[{"op":"add","path":"/__proto__","value":1}]""", """[{"op":"add","path":"/a/9","value":1}]""", """[{"op":"test","path":"/d","value":2}]""" })
        {
            try { A2UIUpgrade.ApplyJsonPatch(result!.DeepClone(), JsonNode.Parse(patch)); throw new Exception("a bad JSON patch applied: " + patch); }
            catch (FormatException) { }
        }
        Check(true, "JSON patch rejects bad paths and failed tests");
    }

    private static JsonObject ClickInput(JsonObject forwarded, params JsonObject[] before)
    {
        var messages = new JsonArray(before.Select(message => (JsonNode?)message).ToArray());
        messages.Add(JsonNode.Parse("""{"id":"1","role":"user","content":"Hi"}""")); messages.Add(JsonNode.Parse("""{"id":"2","role":"user","content":"Ok"}"""));
        return new JsonObject { ["messages"] = messages, ["forwardedProps"] = forwarded };
    }

    private static void Clicks()
    {
        var input = ClickInput(Forwarded(action: Click));
        var original = input.ToJsonString();
        var agentInput = A2UIUpgrade.DowngradeAction(input, "0.9");
        Check(input.ToJsonString() == original && Ids(agentInput).SequenceEqual(["1"]) && JsonText.Compact(agentInput["forwardedProps"]!["a2uiAction"]) == $$"""{"userAction":{{UserAction}}}""",
            "a click reaches a v0.9 agent as its action without the click message");
        Check(ReferenceEquals(A2UIUpgrade.DowngradeAction(input, "1.0"), input), "a click on a 1.0 surface stays a message");
        foreach (var (source, agentVersion, converted) in new[] { ("0.9", "1.0", true), ("1.0", "0.9", false) })
        {
            var activity = JsonNode.Parse($$$"""{"id":"a","role":"activity","activityType":"generative-ui-surface","content":{"surfaceId":"card","a2uiSourceVersion":"{{{source}}}"}}""")!.AsObject();
            var fromMessage = ClickInput(Forwarded(action: Click), activity);
            var fromSummary = ClickInput(Forwarded(action: Click, surfaces: $$$"""{"card":{"target":"chat","a2uiSourceVersion":"{{{source}}}"}}"""));
            foreach (var candidate in new[] { fromMessage, fromSummary })
                Check(A2UIUpgrade.DowngradeAction(candidate, agentVersion)["forwardedProps"]!.AsObject().ContainsKey("a2uiAction") == converted, $"the surface origin ({source}) decides before the agent version ({agentVersion})");
        }
        var existing = ClickInput(Forwarded(action: Click)); existing["forwardedProps"]!["a2uiAction"] = JsonNode.Parse("""{"userAction":{"name":"old"}}""");
        Check(ReferenceEquals(A2UIUpgrade.DowngradeAction(existing, "0.9"), existing), "an existing v0.9 action is kept");
    }

    private static void Catalog()
    {
        const string functions = """{"pick":{"description":"Pick with {\"@path\": \"/id\"}","parameters":{"type":"object","properties":{"id":{"type":"string"}}}},"secret":{"allowedCallers":"agentOnly","parameters":{"type":"object"}}}""";
        var card = """{"description":"Bind with {\"@path\": \"/x\"}","props":{"type":"object","properties":{"name":{"type":"string","description":"Its name"},"tags":{"type":"array","items":{"type":"string"}},"size":{"type":"string","enum":["sm","lg"]}},"required":["name"]},"slots":{"footer":"single"},"parameterOrder":["footer"]}""";
        var components = JsonNode.Parse("""{"Button":{"props":{"type":"object","properties":{"label":{"type":"string"}}},"events":{"onClick":{"description":"Clicked","parameters":{}}}},"Title":""" + Text + ""","ProductCard":""" + card + "}")!.AsObject();
        var (catalogId, context) = A2UIUpgrade.BuildCatalogContext(new JsonObject { ["forwardedProps"] = Forwarded(components: components, ids: ["app", Standard], functions: functions) })!.Value;
        var schema = SchemaOf(context);
        Check(catalogId == Basic && schema["components"]!.AsObject().Select(pair => pair.Key).SequenceEqual(["Button", "ProductCard"])
            && schema["components"]!["Button"]!["allOf"]![1]!["properties"]!.AsObject().Select(pair => pair.Key).SequenceEqual(["component", "label", "action"]),
            "the standard catalog becomes the basic catalog plus custom components, under v0.9 prop names");
        var productCard = schema["components"]!["ProductCard"]!;
        Check(productCard["description"]!.GetValue<string>() == "Bind with {\"path\": \"/x\"}"
            && JsonText.Compact(productCard["allOf"]![1]!["properties"]) == """{"component":{"const":"ProductCard"},"footer":{"$ref":"common_types.json#/$defs/ComponentId"},"name":{"$ref":"common_types.json#/$defs/DynamicString","description":"Its name"},"tags":{"$ref":"common_types.json#/$defs/DynamicStringList"},"size":{"anyOf":[{"type":"string","enum":["sm","lg"]},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]}}"""
            && JsonText.Compact(productCard["allOf"]![1]!["required"]) == """["component","name"]""", "component props become v0.9 dynamic values");
        var names = schema["functions"]!.AsArray().Select(fn => fn!["name"]!.GetValue<string>()).ToList();
        Check(names[^1] == "pick" && !names.Contains("secret") && !names.Contains("calc") && schema["functions"]!.AsArray().Single(fn => fn!["name"]!.GetValue<string>() == "email")!["returnType"]!.GetValue<string>() == "boolean",
            "the catalog lists basic and renderer functions");
        Check(context[0]["value"]!.GetValue<string>() == $"Available A2UI catalog:\n- {Basic}\n  Custom catalog (does NOT include all basic components).\n  Custom components:\n  - ProductCard", "the capabilities entry names the custom components");
        var custom = A2UIUpgrade.BuildCatalogContext(new JsonObject { ["forwardedProps"] = Forwarded(components: new JsonObject { ["Title"] = JsonNode.Parse(Text) }) })!.Value;
        var bare = A2UIUpgrade.BuildCatalogContext(new JsonObject { ["forwardedProps"] = Forwarded(noComponents: true) })!.Value;
        Check(custom.CatalogId == "shop" && SchemaOf(custom.Entries)["components"]!.AsObject().Select(pair => pair.Key).SequenceEqual(["Title"]) && custom.Entries.Count == 4
            && bare.CatalogId == "shop" && JsonText.Compact(new JsonArray(bare.Entries.ToArray<JsonNode?>())) == """[{"description":"A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.","value":"Available A2UI catalog:\n- shop"}]"""
            && A2UIUpgrade.BuildCatalogContext(new JsonObject { ["forwardedProps"] = new JsonObject() }) is null, "a custom catalog keeps its id and a catalog without schemas only names it");
        var input = new JsonObject { ["messages"] = new JsonArray(), ["context"] = JsonNode.Parse($$"""[{"description":"{{Schema}}","value":"{}"},{"description":"x"}]"""), ["forwardedProps"] = Forwarded(components: new JsonObject { ["ProductCard"] = JsonNode.Parse(card) }) };
        var prepared = A2UIUpgrade.PrepareAgentInput(input, "0.9");
        var descriptions = prepared["context"]!.AsArray().Select(entry => entry!["description"]!.GetValue<string>()).ToList();
        Check(descriptions.Count(description => description == Schema) == 1 && descriptions[0] == "x" && SchemaOf(prepared["context"]!.AsArray().OfType<JsonObject>())["catalogId"]!.GetValue<string>() == "shop"
            && ReferenceEquals(A2UIUpgrade.PrepareAgentInput(input, "1.0"), input), "a v0.9 agent input replaces the client schema entry");
        Check(JsonText.Compact(A2UIUpgrade.ArgsSchemaFromSignature("{ value: string; min?: number; [k: string]: unknown }")) == """{"type":"object","properties":{"value":{"$ref":"common_types.json#/$defs/DynamicString"},"min":{"$ref":"common_types.json#/$defs/DynamicNumber"}},"required":["value"],"additionalProperties":{"$ref":"common_types.json#/$defs/DynamicValue"}}""",
            "built-in function signatures map to dynamic refs");
    }

    private static async Task WiringAsync()
    {
        var input = JsonNode.Parse("""{"threadId":"t","runId":"r","messages":[],"tools":[],"context":[],"state":{}}""")!.AsObject();
        input["forwardedProps"] = Forwarded();
        var current = new Fixed([Event("RUN_FINISHED")]);
        await Drain(IntelligenceRuntime.ConfigureAgent(current, "default", input, null, null), input);
        Check(Names(current.Input!["tools"]).SequenceEqual(["render_ui"]), "a 1.0 agent gets render_ui for a tool catalog");
        var legacy = new Fixed([Event("RUN_FINISHED")]);
        await Drain(IntelligenceRuntime.ConfigureAgent(legacy, "default", input, new GenerativeUIOptions { A2UIVersion = "0.9" }, null), input);
        var context = legacy.Input!["context"]!.AsArray().OfType<JsonObject>().ToList();
        Check(Names(legacy.Input["tools"]).SequenceEqual(["render_a2ui"]) && context.All(entry => entry["description"]!.GetValue<string>() != Guide)
            && SchemaOf(context)["components"]!.AsObject().Select(pair => pair.Key).SequenceEqual(["ProductCard", "Text"]), "a 0.9 agent gets render_a2ui and the v0.9 schema of the client's catalog");
        var off = new Fixed([Event("RUN_FINISHED")]);
        await Drain(IntelligenceRuntime.ConfigureAgent(off, "default", input, new GenerativeUIOptions { Enabled = false }, null), input);
        Check(Names(off.Input!["tools"]).Count == 0, "disabled generative UI wins over the client's catalog");

        var render = new Fixed([
            new JsonObject { ["type"] = "TOOL_CALL_START", ["toolCallId"] = "call", ["toolCallName"] = "render_a2ui" },
            new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = "call", ["delta"] = """{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hi"}]}""" },
            Event("RUN_FINISHED")]);
        var events = await Drain(IntelligenceRuntime.ConfigureAgent(render, "default", input, new GenerativeUIOptions { A2UIVersion = "0.9" }, null), input);
        var snapshot = events.Single(item => Type(item) == "ACTIVITY_SNAPSHOT");
        Check(!events.Any(item => item["activityType"]?.GetValue<string>() == "a2ui-surface") && snapshot["messageId"]!.GetValue<string>() == "genui:card"
            && snapshot["content"]!["a2uiSourceVersion"]!.GetValue<string>() == "0.9" && snapshot["content"]!["catalogId"]!.GetValue<string>() == "shop"
            && events.Skip(events.Count - 2).Select(Type).SequenceEqual(["TOOL_CALL_RESULT", "RUN_FINISHED"]), "a v0.9 render call reaches the browser as a 1.0 surface");

        var click = (JsonObject)input.DeepClone();
        click["messages"] = JsonNode.Parse("""[{"id":"1","role":"user","content":"Hi"},{"id":"2","role":"user","content":"Confirm"}]""");
        click["forwardedProps"] = Forwarded(action: Click);
        var clicked = new Fixed([Event("RUN_FINISHED")]);
        await Drain(IntelligenceRuntime.ConfigureAgent(clicked, "default", click, new GenerativeUIOptions { A2UIVersion = "0.9" }, null), click);
        var messages = clicked.Input!["messages"]!.AsArray();
        var call = messages[^2]!["toolCalls"]![0]!["function"]!;
        Check(Ids(clicked.Input).First() == "1" && !Ids(clicked.Input).Contains("2") && call["name"]!.GetValue<string>() == "log_a2ui_event" && JsonText.Compact(JsonNode.Parse(call["arguments"]!.GetValue<string>())) == UserAction
            && messages[^1]!["content"]!.GetValue<string>() == "User performed action \"confirm\" on surface \"card\" (component: button). Context: {\"selected\":2}"
            && Ids(click).SequenceEqual(["1", "2"]), "a click reaches a 0.9 agent as log_a2ui_event while the client input keeps the message");

        var unicode = new Fixed([Event("RUN_FINISHED")]);
        var action = (JsonObject)input.DeepClone();
        action["forwardedProps"] = JsonNode.Parse("""{"a2uiAction":{"userAction":{"name":"pick","surfaceId":"s","context":{"name":"Zoë <b>"}}}}""");
        await Drain(new A2UIAgent(unicode, new A2UIOptions()), action);
        Check(unicode.Input!["messages"]![0]!["toolCalls"]![0]!["function"]!["arguments"]!.GetValue<string>() == """{"name":"pick","surfaceId":"s","context":{"name":"Zoë <b>"}}""", "v0.9 action history is serialized like JSON.stringify");
    }

    private static async Task InfoAsync()
    {
        await using var runtime = new IntelligenceRuntime(new RuntimeOptions
        {
            ApiKey = "test", ApiUrl = new Uri("http://invalid.local"), RunnerUrl = new Uri("ws://invalid.local/runner"), ClientUrl = new Uri("ws://invalid.local/client"), TelemetryDisabled = true,
            Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new Fixed([]) }, GenerativeUI = new GenerativeUIOptions { Agents = ["default"] },
            IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("user"))
        }, new HttpClient(new Unavailable()));
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        runtime.Map(app);
        await app.StartAsync();
        try
        {
            using var browser = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
            var info = (await browser.GetFromJsonAsync<JsonObject>("/copilotkit/info"))!;
            Check(info["generativeUI"]!.ToJsonString() == """{"enabled":true,"agents":["default"]}""" && !info.ContainsKey("a2uiEnabled") && !info.ContainsKey("a2ui"), "/info reports generativeUI instead of a2ui");
        }
        finally { await app.StopAsync(); }
    }

    // -----------------------------------------------------------------------

    /// <summary>The <c>forwardedProps</c> of a run from the 1.0 client: an envelope with one inline catalog.</summary>
    private static JsonObject Forwarded(string transport = "tool", JsonObject? components = null, bool noComponents = false, string? surfaces = null, string? action = null, string[]? ids = null, string functions = "{}")
    {
        ids ??= ["shop"];
        var catalog = new JsonObject { ["catalogId"] = ids[0], ["protocolVersion"] = "1.0", ["functions"] = JsonNode.Parse(functions) };
        if (!noComponents) catalog["components"] = components ?? JsonNode.Parse($$"""{"ProductCard":{{ProductCard}},"Text":{{Text}}}""");
        return Wrap(catalog, transport, surfaces, action is null ? null : JsonNode.Parse(action), ids);
    }

    private static JsonObject Wrap(JsonObject catalog, string transport, string? surfaces, JsonNode? action, string[] ids)
    {
        var extensions = new JsonObject
        {
            ["copilotkit_format"] = 3, ["copilotkit_transport"] = transport,
            ["copilotkit_targets"] = JsonNode.Parse("""[{"id":"chat","kind":"chat"},{"id":"side","kind":"inline","components":["Text"]}]"""),
            ["copilotkit_surfaces"] = JsonNode.Parse(surfaces ?? "{}"), ["copilotkit_contextSent"] = false
        };
        if (action is not null) extensions["copilotkit_action"] = action;
        return new JsonObject
        {
            ["copilotkit"] = new JsonObject
            {
                ["ui"] = new JsonObject
                {
                    ["1.0"] = new JsonObject { ["supportedCatalogIds"] = new JsonArray(ids.Select(id => (JsonNode?)id).ToArray()), ["inlineCatalogs"] = new JsonArray(catalog) },
                    ["metadata"] = new JsonObject { ["extensions"] = extensions }
                }
            }
        };
    }

    private static JsonObject SchemaOf(IEnumerable<JsonObject> context) => JsonNode.Parse(context.Single(entry => entry["description"]!.GetValue<string>() == Schema)["value"]!.GetValue<string>())!.AsObject();
    private static List<string> Names(JsonNode? tools) => (tools as JsonArray ?? []).Select(tool => tool!["name"]!.GetValue<string>()).ToList();
    private static List<string> Ids(JsonObject input) => input["messages"]!.AsArray().Select(message => message!["id"]!.GetValue<string>()).ToList();
    private static string? Type(JsonObject value) => value["type"]?.GetValue<string>();
    private static JsonObject Event(string type) => new() { ["type"] = type };

    private static JsonObject[] Call(string id, params string[] chunks) =>
    [
        new JsonObject { ["type"] = "TOOL_CALL_START", ["toolCallId"] = id, ["toolCallName"] = "render_ui" },
        .. chunks.Select(chunk => new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = id, ["delta"] = chunk }),
        new JsonObject { ["type"] = "TOOL_CALL_END", ["toolCallId"] = id },
    ];

    private static async Task<List<JsonObject>> RenderAsync(JsonObject[] events, JsonObject? forwarded = null) =>
        await Drain(new GenerativeUIAgent(new Fixed(events), GenerativeUI.ReadToolManifest(forwarded ?? Forwarded())!), new JsonObject { ["messages"] = new JsonArray() });

    private static async Task<List<JsonObject>> Drain(IRuntimeAgent agent, JsonObject input)
    {
        var events = new List<JsonObject>();
        await foreach (var item in agent.RunAsync(input, CancellationToken.None)) events.Add(item);
        return events;
    }

    private static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }

    private sealed class Fixed(IReadOnlyList<JsonObject> events) : IRuntimeAgent
    {
        public string Description => "fixture";
        public JsonObject? Input { get; private set; }
        public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
        {
            Input = input; await Task.Yield();
            foreach (var item in events) yield return (JsonObject)item.DeepClone();
        }
    }

    private sealed class Unavailable : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
    }
}
