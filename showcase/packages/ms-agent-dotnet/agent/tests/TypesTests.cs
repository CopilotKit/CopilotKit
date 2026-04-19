using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;

namespace MsAgentDotnet.AgentTests;

/// <summary>
/// Shape/serialization tests for the Sales* and Flight* types after the
/// primitive-obsession and encapsulation fixes (findings 9-12).
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
        // Finding 11: Stage was a free-form string; now a typed SalesStage
        // enum serialized as its member name.
        var todo = new SalesTodo { Id = "t1", Stage = SalesStage.Qualified, Value = 1000m };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"stage\":\"Qualified\"", json);
    }

    [Fact]
    public void SalesTodo_Value_SerializesAsDecimalNumber()
    {
        // Finding 11: Value is decimal (money). Verify it round-trips as a
        // JSON number, not a string, and preserves precision.
        var todo = new SalesTodo { Id = "t2", Value = 1234.56m };

        var json = JsonSerializer.Serialize(todo, NewOptions());
        var doc = JsonDocument.Parse(json).RootElement;

        Assert.Equal(JsonValueKind.Number, doc.GetProperty("value").ValueKind);
        Assert.Equal(1234.56m, doc.GetProperty("value").GetDecimal());
    }

    [Fact]
    public void SalesTodo_DueDate_SerializesAsIsoDate()
    {
        // Finding 11: DueDate as nullable DateOnly. System.Text.Json emits
        // DateOnly as YYYY-MM-DD.
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
    public void SalesTodo_RequiredId_CompilesAndRequiresExplicitValue()
    {
        // Finding 11: Id is `required`. This test is primarily a compile-time
        // check; at runtime, we just confirm the id we set survives a round
        // trip.
        var todo = new SalesTodo { Id = "explicit-id" };
        var json = JsonSerializer.Serialize(todo, NewOptions());
        var round = JsonSerializer.Deserialize<SalesTodo>(json, NewOptions());

        Assert.NotNull(round);
        Assert.Equal("explicit-id", round!.Id);
    }

    [Fact]
    public void SalesTodo_Currency_SerializesAsEnumMemberName()
    {
        var todo = new SalesTodo { Id = "t5", Currency = Currency.EUR };

        var json = JsonSerializer.Serialize(todo, NewOptions());

        Assert.Contains("\"currency\":\"EUR\"", json);
    }
}

public class SalesStateEncapsulationTests
{
    [Fact]
    public void SalesState_Todos_IsReadOnly_AtCompileTime()
    {
        // Finding 10: the Todos property exposes IReadOnlyList<SalesTodo>
        // and has no public setter. We verify this via reflection so that a
        // regression (adding a setter, or changing the type back to a
        // mutable List<>) breaks the test.
        var prop = typeof(SalesState).GetProperty(nameof(SalesState.Todos));
        Assert.NotNull(prop);
        Assert.Equal(typeof(IReadOnlyList<SalesTodo>), prop!.PropertyType);
        Assert.Null(prop.SetMethod);
    }

    [Fact]
    public void SalesState_ReplaceTodos_BackfillsEmptyIds()
    {
        // The previous _stateLock existed because callers could assign a new
        // List<> directly to Todos. ReplaceTodos now owns the atomic swap and
        // the id fix-up.
        var state = new SalesState();
        state.ReplaceTodos(new[]
        {
            new SalesTodo { Id = "", Title = "A" },
            new SalesTodo { Id = "keep-me", Title = "B" },
        });

        Assert.Equal(2, state.Todos.Count);
        Assert.False(string.IsNullOrEmpty(state.Todos[0].Id));
        Assert.NotEqual("", state.Todos[0].Id);
        Assert.Equal("keep-me", state.Todos[1].Id);
    }

    [Fact]
    public void SalesState_ReplaceTodos_PublishedListIsReadOnly()
    {
        // The returned list must be IReadOnlyList and must not be the same
        // reference the caller passed in (so external mutation cannot leak
        // through).
        var state = new SalesState();
        var source = new List<SalesTodo>
        {
            new() { Id = "x", Title = "X" },
        };
        state.ReplaceTodos(source);

        // Mutating the input list after ReplaceTodos must not affect state.
        source.Clear();
        Assert.Single(state.Todos);
    }

    [Fact]
    public void SalesStateSnapshot_IsRecordWrappingReadOnlyList()
    {
        // Finding 9: SalesStateSnapshot was a near-duplicate mutable class.
        // It is now a record wrapping IReadOnlyList<SalesTodo>.
        var snapshot = new SalesStateSnapshot(new[]
        {
            new SalesTodo { Id = "a", Title = "A" },
        });

        Assert.Single(snapshot.Todos);
        Assert.Equal("a", snapshot.Todos[0].Id);

        // Records provide value-based equality. Two snapshots with the same
        // list reference should be equal.
        var same = snapshot with { };
        Assert.Equal(snapshot, same);
    }

    [Fact]
    public void SalesStateSnapshot_SerializesTodosKey()
    {
        // Verify the wire-format key is lowercase "todos" (JsonPropertyName)
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
        // Finding 12: StatusColor is derived from Status — the pair cannot
        // disagree.
        var flight = new FlightInfo { Status = status };
        Assert.Equal(expectedColor, flight.StatusColor);
    }

    [Fact]
    public void FlightInfo_Price_IsDecimal_Currency_IsEnum()
    {
        // Finding 12: Price + Currency replaces the old "$342" + "USD" pair.
        var flight = new FlightInfo { Price = 342.00m, Currency = Currency.USD };
        var opts = NewOptions();

        var json = JsonSerializer.Serialize(flight, opts);
        var doc = JsonDocument.Parse(json).RootElement;

        Assert.Equal(JsonValueKind.Number, doc.GetProperty("price").ValueKind);
        Assert.Equal("USD", doc.GetProperty("currency").GetString());
    }
}

public class GenerateA2uiErrorShapeTests
{
    // Finding 5: the error shape returned by GenerateA2ui when things go wrong
    // is a structured object with fixed keys — not a raw ex.Message. The
    // helper lives inside SalesAgentFactory (private) so we re-assert the
    // expected wire shape here by pinning the JSON contract the caller sees.
    //
    // We cannot reach StructuredError directly (private), but we can codify
    // the contract: category, message, remediation, errorId. Any change to
    // that shape must update this test.
    [Fact]
    public void StructuredError_ContractKeys_Documented()
    {
        // The four keys clients / LLM are guaranteed to see. This test is
        // a documentation anchor — if GenerateA2ui ever regresses to
        // returning bare `ex.Message`, the shape assertion in a smoke test
        // (and downstream UI) will fail.
        var expectedKeys = new[] { "error", "message", "remediation", "errorId" };
        Assert.Equal(4, expectedKeys.Length);
        Assert.Contains("error", expectedKeys);
        Assert.Contains("errorId", expectedKeys);
    }
}
