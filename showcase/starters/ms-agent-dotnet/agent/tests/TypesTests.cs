using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace MsAgentDotnet.AgentTests;

/// <summary>
/// Shape and serialization tests for <see cref="SalesTodo"/>, <see cref="SalesState"/>,
/// <see cref="SalesStateSnapshot"/>, and <see cref="FlightInfo"/>. These types replaced
/// a primitive-obsession implementation (free-form string stages, int money values,
/// parallel <c>Status</c> + <c>StatusColor</c> strings) with typed enums, decimals,
/// and derived properties; the tests pin the wire format so downstream clients
/// don't silently break.
/// </summary>
public class SalesTodoShapeTests
{
    private static JsonSerializerOptions NewOptions()
    {
        var opts = new JsonSerializerOptions();
        opts.Converters.Add(new JsonStringEnumConverter());
        return opts;
    }

    [Fact]
    public void SalesTodo_Stage_SerializesAsEnumMemberName()
    {
        // Stage is a typed SalesStage enum; it serializes as the enum member
        // name so both callers and the model see a closed set of legal values.
        var todo = new SalesTodo { Id = "t1", Stage = SalesStage.Qualified, Value = 1000m };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"stage\":\"Qualified\"", json);
    }

    [Fact]
    public void SalesTodo_Value_SerializesAsDecimalNumber()
    {
        // Value is decimal (money). Verify it round-trips as a JSON number
        // (not a quoted string) and preserves fractional precision.
        var todo = new SalesTodo { Id = "t2", Value = 1234.56m };

        var json = JsonSerializer.Serialize(todo, NewOptions());
        var doc = JsonDocument.Parse(json).RootElement;

        Assert.Equal(JsonValueKind.Number, doc.GetProperty("value").ValueKind);
        Assert.Equal(1234.56m, doc.GetProperty("value").GetDecimal());
    }

    [Fact]
    public void SalesTodo_Value_Negative_Throws()
    {
        // Value is money; negative values are not a legal business state.
        // The init accessor rejects them with ArgumentOutOfRangeException.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new SalesTodo { Id = "neg", Value = -1000m });
    }

    [Fact]
    public void SalesTodo_Value_Zero_Allowed()
    {
        // Zero is a legal amount (e.g. an unpriced prospect).
        var todo = new SalesTodo { Id = "zero", Value = 0m };
        Assert.Equal(0m, todo.Value);
    }

    [Fact]
    public void SalesTodo_DueDate_SerializesAsIsoDate()
    {
        // DueDate is a nullable DateOnly; System.Text.Json emits DateOnly as
        // the ISO-8601 YYYY-MM-DD form.
        var todo = new SalesTodo { Id = "t3", DueDate = new DateOnly(2026, 4, 20) };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"dueDate\":\"2026-04-20\"", json);
    }

    [Fact]
    public void SalesTodo_DueDate_NullIsSerializedAsJsonNull()
    {
        var todo = new SalesTodo { Id = "t4", DueDate = null };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"dueDate\":null", json);
    }

    [Fact]
    public void SalesTodo_RequiredId_CompilesAndRoundTrips()
    {
        // The `required` keyword forces callers to explicitly provide an Id.
        // This test is mostly a compile-time anchor; at runtime we just
        // confirm the value we set round-trips unchanged.
        var todo = new SalesTodo { Id = "explicit-id" };
        var json = JsonSerializer.Serialize(todo, NewOptions());
        var round = JsonSerializer.Deserialize<SalesTodo>(json, NewOptions());

        Assert.NotNull(round);
        Assert.Equal("explicit-id", round!.Id);
    }

    [Fact]
    public void SalesTodo_NewPending_AssignsNonEmptyGuidId()
    {
        // NewPending is the explicit factory for "server should assign an
        // id". It generates a 16-hex-char id so callers never have to know
        // about the empty-string sentinel that ReplaceTodos backfills.
        var todo = SalesTodo.NewPending(title: "deal");

        Assert.False(string.IsNullOrEmpty(todo.Id));
        Assert.Equal(16, todo.Id.Length);
        Assert.Equal("deal", todo.Title);
    }

    [Fact]
    public void SalesTodo_Currency_SerializesAsEnumMemberName()
    {
        var todo = new SalesTodo { Id = "t5", Currency = Currency.EUR };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"currency\":\"EUR\"", json);
    }

    [Theory]
    [InlineData(SalesStage.Prospect, false)]
    [InlineData(SalesStage.Qualified, false)]
    [InlineData(SalesStage.Proposal, false)]
    [InlineData(SalesStage.Negotiation, false)]
    [InlineData(SalesStage.ClosedWon, true)]
    [InlineData(SalesStage.ClosedLost, true)]
    public void SalesTodo_Completed_IsDerivedFromStage(SalesStage stage, bool expectedCompleted)
    {
        // Completed used to be an independent bool that could contradict
        // Stage (e.g. ClosedWon + Completed=false). It's now a computed
        // property so the pair cannot disagree.
        var todo = new SalesTodo { Id = "d", Stage = stage };
        Assert.Equal(expectedCompleted, todo.Completed);
    }
}

public class SalesStateEncapsulationTests
{
    [Fact]
    public void SalesState_Todos_IsReadOnly_AtCompileTime()
    {
        // The Todos property is IReadOnlyList<SalesTodo> with no public
        // setter. Verified via reflection so a regression (adding a setter
        // or reverting to a mutable List<>) breaks the build-time contract.
        var prop = typeof(SalesState).GetProperty(nameof(SalesState.Todos));
        Assert.NotNull(prop);
        Assert.Equal(typeof(IReadOnlyList<SalesTodo>), prop!.PropertyType);
        Assert.Null(prop.SetMethod);
    }

    [Fact]
    public void SalesState_ReplaceTodos_BackfillsEmptyIds()
    {
        // ReplaceTodos is the single writer for SalesState.Todos. Empty-id
        // todos (the documented sentinel for "server assigns") are backfilled
        // with a freshly generated Guid-derived id; non-empty ids are kept.
        var state = new SalesState();
        state.ReplaceTodos(new[]
        {
            new SalesTodo { Id = "", Title = "A" },
            new SalesTodo { Id = "keep-me", Title = "B" },
        });

        Assert.Equal(2, state.Todos.Count);
        Assert.False(string.IsNullOrEmpty(state.Todos[0].Id));
        Assert.NotEqual("", state.Todos[0].Id);
        // 16 hex chars = 64 bits of entropy — safe for demo scale.
        Assert.Equal(16, state.Todos[0].Id.Length);
        Assert.Equal("keep-me", state.Todos[1].Id);
    }

    [Fact]
    public void SalesState_ReplaceTodos_PublishedListIsReadOnly()
    {
        // The published list must be IReadOnlyList and must NOT alias the
        // caller's input collection, so external mutation after publish
        // cannot leak into the state.
        var state = new SalesState();
        var source = new List<SalesTodo>
        {
            new() { Id = "x", Title = "X" },
        };
        state.ReplaceTodos(source);

        source.Clear();
        Assert.Single(state.Todos);
    }

    [Fact]
    public void SalesStateSnapshot_IsRecordWrappingReadOnlyList()
    {
        // SalesStateSnapshot was previously a near-duplicate mutable class.
        // It is now an immutable record wrapping IReadOnlyList<SalesTodo>.
        var snapshot = new SalesStateSnapshot(new[]
        {
            new SalesTodo { Id = "a", Title = "A" },
        });

        Assert.Single(snapshot.Todos);
        Assert.Equal("a", snapshot.Todos[0].Id);

        // Records provide value-based equality.
        var same = snapshot with { };
        Assert.Equal(snapshot, same);
    }

    [Fact]
    public void SalesStateSnapshot_SerializesTodosKey()
    {
        // The wire-format key is lowercase "todos" via JsonPropertyName,
        // even without a camelCase naming policy.
        var snapshot = new SalesStateSnapshot(Array.Empty<SalesTodo>());
        var opts = new JsonSerializerOptions();
        opts.Converters.Add(new JsonStringEnumConverter());
        var json = JsonSerializer.Serialize(snapshot, opts);

        Assert.Contains("\"todos\":", json);
    }
}

public class FlightInfoShapeTests
{
    private static JsonSerializerOptions NewOptions()
    {
        var opts = new JsonSerializerOptions();
        opts.Converters.Add(new JsonStringEnumConverter());
        return opts;
    }

    [Fact]
    public void FlightInfo_StatusColor_DerivedFromStatus_OnTimeGreen()
    {
        var flight = new FlightInfo { Status = FlightStatus.OnTime };
        Assert.Equal("green", flight.StatusColor);
    }

    [Theory]
    [InlineData(FlightStatus.OnTime, "green")]
    [InlineData(FlightStatus.Delayed, "yellow")]
    [InlineData(FlightStatus.Cancelled, "red")]
    [InlineData(FlightStatus.Boarding, "blue")]
    public void FlightInfo_StatusColor_MatchesStatus(FlightStatus status, string expectedColor)
    {
        // StatusColor is derived from Status — the pair cannot disagree.
        var flight = new FlightInfo { Status = status };
        Assert.Equal(expectedColor, flight.StatusColor);
    }

    [Fact]
    public void FlightInfo_Price_IsDecimal_Currency_IsEnum()
    {
        // Price is a decimal (money) + Currency is a typed enum, replacing
        // the old "$342" + "USD" pair.
        var flight = new FlightInfo { Price = 342.00m, Currency = Currency.USD };
        var opts = NewOptions();

        var json = JsonSerializer.Serialize(flight, opts);
        var doc = JsonDocument.Parse(json).RootElement;

        Assert.Equal(JsonValueKind.Number, doc.GetProperty("price").ValueKind);
        Assert.Equal("USD", doc.GetProperty("currency").GetString());
    }
}

/// <summary>
/// Exercises the <see cref="SalesAgentFactory.BuildA2uiResponseFromContent"/>
/// helper — the content-processing stage of GenerateA2ui, which is the only
/// part reachable without a live OpenAI client. Each error branch
/// (JsonException, shape mismatch, malformed components, shape deserialize)
/// is covered with a controlled input string so regressions that leak raw
/// ex.Message or swallow errors silently fail loudly.
/// </summary>
public class GenerateA2uiErrorBranchTests
{
    private const string ErrorId = "test1234";

    private static Microsoft.Extensions.Logging.ILogger NewLogger()
        => NullLogger.Instance;

    private static JsonElement ParseToElement(string json)
        => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void MalformedJson_ReturnsStructuredError_Category_MalformedLlmOutput()
    {
        // Input isn't valid JSON at all — JsonDocument.Parse throws
        // JsonException on the very first try. Error category and errorId
        // must be present; no raw exception message.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "This is not JSON at all",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("malformed_llm_output", doc.GetProperty("error").GetString());
        Assert.Equal(ErrorId, doc.GetProperty("errorId").GetString());
        Assert.False(string.IsNullOrEmpty(doc.GetProperty("message").GetString()));
        Assert.False(string.IsNullOrEmpty(doc.GetProperty("remediation").GetString()));
    }

    [Fact]
    public void JsonButNotObject_ReturnsStructuredError()
    {
        // JSON parses, but the root is an array, not the expected object.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "[1, 2, 3]",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("malformed_llm_output", doc.GetProperty("error").GetString());
        Assert.Equal(ErrorId, doc.GetProperty("errorId").GetString());
    }

    [Fact]
    public void MissingComponentsArray_ReturnsStructuredError()
    {
        // Object is otherwise valid but 'components' is missing entirely.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "{\"surfaceId\":\"s1\"}",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("malformed_llm_output", doc.GetProperty("error").GetString());
    }

    [Fact]
    public void ComponentsNotArray_ReturnsStructuredError()
    {
        // 'components' exists but is a string rather than an array.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "{\"components\":\"not-an-array\"}",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("malformed_llm_output", doc.GetProperty("error").GetString());
    }

    [Fact]
    public void WellFormedInput_ReturnsOperationsPayload()
    {
        // Happy path: valid shape produces the a2ui_operations envelope with
        // create_surface, update_components, and (when data present)
        // update_data_model.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "{\"surfaceId\":\"ds\",\"catalogId\":\"copilotkit://c\",\"components\":[{\"id\":\"root\",\"component\":\"Row\"}],\"data\":{\"k\":1}}",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        var ops = doc.GetProperty("a2ui_operations");
        Assert.Equal(JsonValueKind.Array, ops.ValueKind);
        Assert.Equal(3, ops.GetArrayLength());
        Assert.Equal("create_surface", ops[0].GetProperty("type").GetString());
        Assert.Equal("update_components", ops[1].GetProperty("type").GetString());
        Assert.Equal("update_data_model", ops[2].GetProperty("type").GetString());
    }

    [Fact]
    public void WellFormedInput_NoData_OmitsUpdateDataModel()
    {
        // Data is optional; when absent we emit only create_surface and
        // update_components.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            "{\"components\":[{\"id\":\"root\",\"component\":\"Row\"}]}",
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        var ops = doc.GetProperty("a2ui_operations");
        Assert.Equal(2, ops.GetArrayLength());
    }

    [Fact]
    public void StructuredError_HasExactlyTheContractKeys()
    {
        // Pin the wire contract: clients and the LLM both rely on the four
        // keys (error, message, remediation, errorId). A regression to raw
        // ex.Message would drop remediation/errorId and this test would fail.
        var output = SalesAgentFactory.StructuredError("cat", "msg", "rem", "eid");
        var doc = ParseToElement(output);

        var keys = new HashSet<string>();
        foreach (var prop in doc.EnumerateObject())
        {
            keys.Add(prop.Name);
        }

        Assert.Equal(
            new HashSet<string> { "error", "message", "remediation", "errorId" },
            keys);
    }

    [Fact]
    public void NullContent_ReturnsStructuredError_EmptyLlmOutput()
    {
        // result.Text from the upstream chat client can legitimately be null
        // (content filter tripped, empty completion, model refusal). The old
        // code propagated that straight into BuildA2uiResponseFromContent,
        // which did ArgumentNullException.ThrowIfNull(content) — escaping as
        // an uncaught NRE that broke the structured-error contract. Now the
        // helper returns a structured empty_llm_output error instead.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            null,
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("empty_llm_output", doc.GetProperty("error").GetString());
        Assert.Equal(ErrorId, doc.GetProperty("errorId").GetString());
        Assert.False(string.IsNullOrEmpty(doc.GetProperty("message").GetString()));
        Assert.False(string.IsNullOrEmpty(doc.GetProperty("remediation").GetString()));
    }

    [Fact]
    public void EmptyContent_ReturnsStructuredError_EmptyLlmOutput()
    {
        // Empty string is treated the same as null: the upstream produced no
        // usable text content. JsonDocument.Parse("") would throw JsonException
        // and be reported as malformed_llm_output, which is less accurate — an
        // empty string isn't malformed, it's absent. Guard it up-front.
        var output = SalesAgentFactory.BuildA2uiResponseFromContent(
            string.Empty,
            ErrorId,
            NewLogger());

        var doc = ParseToElement(output);
        Assert.Equal("empty_llm_output", doc.GetProperty("error").GetString());
        Assert.Equal(ErrorId, doc.GetProperty("errorId").GetString());
    }
}
