// CvdiagSchema.test.cs — xUnit red-green proof for the .NET CVDIAG codegen
// binding (plan unit L0-D, spec §5/§6). Mirrors the TS `schema.test.ts` /
// `emit.ts` contract:
//
//   1. schema round-trip — a fully-populated CvdiagEnvelope serializes to JSON
//      and deserializes back identically (System.Text.Json source-gen).
//   2. forbidden-header rejection — CvdiagEmitter.FilterEdgeHeaders() drops a
//      DENY-list header (cf-ipcountry) and the cf-ip* family even if it is
//      injected alongside an allow-list header; every result carries all 9
//      allow-list keys (absent → null).
//   3. _metadata_dropped stamp — an envelope carrying an unknown metadata key
//      is closed-world filtered and the `_metadata_dropped` flag is set.
//   4. production-env DEBUG refusal — CvdiagEmitter fail-closes (throws) when
//      DEBUG is requested in a production environment, when no env resolves,
//      and when the allow-list is absent.
//
// RED: with no CvdiagSchema.cs / CvdiagEmitter.cs these types do not exist and
// the suite does not compile. GREEN once both are implemented.
//
// Run (from repo root, requires the .NET 9 SDK):
//   dotnet test showcase/integrations/_shared/dotnet/tests/CvdiagSchema.Tests.csproj

using System.Text.Json;
using Copilotkit.Showcase.Cvdiag;
using Xunit;

namespace Copilotkit.Showcase.Cvdiag.Tests;

public class CvdiagSchemaTests
{
    private static EdgeHeaders EmptyEdgeHeaders() => new();

    private static CvdiagEnvelope SampleEnvelope() => new()
    {
        SchemaVersion = CvdiagSchema.SchemaVersion,
        TestId = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
        TraceId = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
        SpanId = "00f067aa0ba902b7",
        ParentSpanId = null,
        Layer = CvdiagLayer.Backend,
        Boundary = CvdiagBoundary.BackendResponseComplete,
        Slug = "gen-ui-chat",
        Demo = "default",
        Ts = "2026-06-18T12:00:00.000Z",
        MonoNs = 123456789,
        DurationMs = 42,
        Outcome = CvdiagOutcome.Ok,
        EdgeHeaders = EmptyEdgeHeaders(),
        Metadata = new Dictionary<string, object?> { ["http_status"] = 200 },
    };

    // (1) Round-trip: serialize → deserialize → equal field-by-field.
    [Fact]
    public void Envelope_RoundTrips_ThroughSystemTextJson()
    {
        var original = SampleEnvelope();
        var json = JsonSerializer.Serialize(original, CvdiagJsonContext.Default.CvdiagEnvelope);
        var back = JsonSerializer.Deserialize(json, CvdiagJsonContext.Default.CvdiagEnvelope)!;

        Assert.Equal(original.SchemaVersion, back.SchemaVersion);
        Assert.Equal(original.TestId, back.TestId);
        Assert.Equal(original.SpanId, back.SpanId);
        Assert.Equal(original.Layer, back.Layer);
        Assert.Equal(original.Boundary, back.Boundary);
        Assert.Equal(original.Slug, back.Slug);
        Assert.Equal(original.Outcome, back.Outcome);
        Assert.Equal(original.MonoNs, back.MonoNs);
        Assert.Equal(original.DurationMs, back.DurationMs);
    }

    // (1b) Wire format: enum + key names match the schema.json contract exactly
    // (snake_case keys, dotted/lowercase enum string values).
    [Fact]
    public void Envelope_SerializesWithSchemaWireNames()
    {
        var json = JsonSerializer.Serialize(SampleEnvelope(), CvdiagJsonContext.Default.CvdiagEnvelope);
        Assert.Contains("\"schema_version\":1", json);
        Assert.Contains("\"test_id\":", json);
        Assert.Contains("\"parent_span_id\":null", json);
        Assert.Contains("\"edge_headers\":", json);
        Assert.Contains("\"layer\":\"backend\"", json);
        Assert.Contains("\"boundary\":\"backend.response.complete\"", json);
        Assert.Contains("\"outcome\":\"ok\"", json);
        // cf-ray etc. serialize with their hyphenated wire names.
        Assert.Contains("\"cf-ray\":null", json);
        Assert.Contains("\"x-railway-request-id\":null", json);
    }

    // (2) Forbidden-header rejection: cf-ipcountry (DENY) is dropped even when
    // injected next to an allow-list header; the cf-ip* family is never
    // captured; all 9 allow-list keys are present (absent → null).
    [Fact]
    public void FilterEdgeHeaders_RejectsDenyListAndCfIpFamily()
    {
        var raw = new Dictionary<string, string?>
        {
            ["cf-ray"] = "8abc-DFW",                 // allow → kept
            ["cf-ipcountry"] = "US",                 // deny → dropped
            ["cf-connecting-ip"] = "1.2.3.4",        // deny → dropped
            ["true-client-ip"] = "1.2.3.4",          // deny → dropped
            ["x-forwarded-for"] = "1.2.3.4",         // deny → dropped
            ["CF-IPCity"] = "Dallas",                // deny (case-insensitive)
            ["server"] = "railway-edge",             // allow → kept
        };

        var filtered = CvdiagEmitter.FilterEdgeHeaders(raw);

        Assert.Equal("8abc-DFW", filtered.CfRay);
        Assert.Equal("railway-edge", filtered.Server);
        // DENY-list values never surface on any of the 9 fields.
        Assert.DoesNotContain("US", filtered.AllValues());
        Assert.DoesNotContain("1.2.3.4", filtered.AllValues());
        Assert.DoesNotContain("Dallas", filtered.AllValues());
        // All 9 allow-list keys present; unset → null.
        Assert.Null(filtered.CfMitigated);
        Assert.Null(filtered.XRailwayRequestId);
        Assert.Null(filtered.RetryAfter);
        Assert.Equal(9, filtered.KeyCount());
    }

    // (2b) Deny wins even if a deny key somehow appears in the allow path.
    [Fact]
    public void FilterEdgeHeaders_DenyWinsOverAllow()
    {
        var raw = new Dictionary<string, string?> { ["forwarded"] = "for=1.2.3.4" };
        var filtered = CvdiagEmitter.FilterEdgeHeaders(raw);
        Assert.DoesNotContain("for=1.2.3.4", filtered.AllValues());
    }

    // (3) _metadata_dropped stamp: an unknown metadata key for the boundary is
    // dropped (closed-world) and the flag is stamped.
    [Fact]
    public void Emit_StampsMetadataDropped_OnUnknownKey()
    {
        var emitter = CvdiagEmitterTestFactory.Verbose();
        var env = emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendResponseComplete,
            Slug = "gen-ui-chat",
            Demo = "default",
            Outcome = CvdiagOutcome.Ok,
            Metadata = new Dictionary<string, object?>
            {
                ["http_status"] = 200,        // allowed for this boundary
                ["totally_unknown_key"] = 1,  // not in the closed key set → dropped
            },
        });

        Assert.NotNull(env);
        Assert.True(env!.MetadataDropped);
        Assert.True(env.Metadata.ContainsKey("http_status"));
        Assert.False(env.Metadata.ContainsKey("totally_unknown_key"));
    }

    // (3b) Clean metadata leaves the flag unset.
    [Fact]
    public void Emit_DoesNotStampMetadataDropped_OnCleanMetadata()
    {
        var emitter = CvdiagEmitterTestFactory.Verbose();
        var env = emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendAgentEnter,
            Slug = "gen-ui-chat",
            Demo = "default",
            Outcome = CvdiagOutcome.Ok,
            Metadata = new Dictionary<string, object?>
            {
                ["agent_name"] = "proverbs",
                ["model_id"] = "gpt-4o-mini",
            },
        });

        Assert.NotNull(env);
        Assert.False(env!.MetadataDropped);
    }

    // (4) Production-env DEBUG refusal: SHOWCASE_ENV=production + DEBUG throws.
    [Fact]
    public void DebugInProduction_FailsClosed()
    {
        var env = new Dictionary<string, string?>
        {
            ["SHOWCASE_ENV"] = "production",
            ["CVDIAG_DEBUG_ALLOW_LIST"] = "gen-ui-chat",
        };
        Assert.Throws<InvalidOperationException>(
            () => new CvdiagEmitter(new CvdiagEmitterOptions { Debug = true, Env = env }));
    }

    // (4b) Unresolved env (no SHOWCASE_ENV/RAILWAY/ASPNETCORE) treated as prod.
    [Fact]
    public void DebugWithUnresolvedEnv_FailsClosed()
    {
        var env = new Dictionary<string, string?> { ["CVDIAG_DEBUG_ALLOW_LIST"] = "gen-ui-chat" };
        Assert.Throws<InvalidOperationException>(
            () => new CvdiagEmitter(new CvdiagEmitterOptions { Debug = true, Env = env }));
    }

    // (4c) DEBUG in a non-prod env without an allow-list still refuses.
    [Fact]
    public void DebugWithoutAllowList_FailsClosed()
    {
        var env = new Dictionary<string, string?> { ["SHOWCASE_ENV"] = "staging" };
        Assert.Throws<InvalidOperationException>(
            () => new CvdiagEmitter(new CvdiagEmitterOptions { Debug = true, Env = env }));
    }

    // (4d) DEBUG in a non-prod env WITH an allow-list is permitted (no throw).
    [Fact]
    public void DebugInStagingWithAllowList_IsAllowed()
    {
        var env = new Dictionary<string, string?>
        {
            ["SHOWCASE_ENV"] = "staging",
            ["CVDIAG_DEBUG_ALLOW_LIST"] = "gen-ui-chat",
        };
        var emitter = new CvdiagEmitter(new CvdiagEmitterOptions { Debug = true, Env = env });
        Assert.Equal(CvdiagTier.Debug, emitter.Tier);
    }

    // (4e) Tier env precedence: ASPNETCORE_ENVIRONMENT is the last fallback
    // (the .NET analogue of NODE_ENV).
    [Fact]
    public void ResolveEnvLabel_FallsBackToAspNetCoreEnvironment()
    {
        var env = new Dictionary<string, string?> { ["ASPNETCORE_ENVIRONMENT"] = "Production" };
        Assert.Equal("production", CvdiagEmitter.ResolveEnvLabel(env));
    }

    [Fact]
    public void ResolveEnvLabel_ShowcaseEnvWins()
    {
        var env = new Dictionary<string, string?>
        {
            ["SHOWCASE_ENV"] = "staging",
            ["RAILWAY_ENVIRONMENT_NAME"] = "production",
            ["ASPNETCORE_ENVIRONMENT"] = "Production",
        };
        Assert.Equal("staging", CvdiagEmitter.ResolveEnvLabel(env));
    }

    // Codegen coverage: all 29 metadata-bearing boundaries have a closed key set.
    [Fact]
    public void AllBoundaries_HaveClosedMetadataKeySets()
    {
        Assert.Equal(33, CvdiagSchema.AllBoundaries.Count);
        Assert.Equal(29, CvdiagSchema.BoundaryMetadataKeys.Count);
        Assert.Equal(9, CvdiagSchema.EdgeHeaderKeys.Count);
    }
}

// Small factory: a VERBOSE-tier emitter with no PB writer for metadata tests.
internal static class CvdiagEmitterTestFactory
{
    public static CvdiagEmitter Verbose() => new(new CvdiagEmitterOptions
    {
        Verbose = true,
        Env = new Dictionary<string, string?> { ["SHOWCASE_ENV"] = "staging" },
    });
}
