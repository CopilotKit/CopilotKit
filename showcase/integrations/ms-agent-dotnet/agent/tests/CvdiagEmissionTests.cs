using System.Text.Json;
using Copilotkit.Showcase.Cvdiag;
using Xunit;

namespace MsAgentDotnet.AgentTests;

// Red-green proof for the L1-F backend CVDIAG instrumentation (spec §3).
//
// RED (before CvdiagBackend existed): the type does not compile / the 11
// boundary emit methods do not exist, so this suite fails to build.
// GREEN: CvdiagBackend, armed via CVDIAG_BACKEND_EMITTER=on, emits each of the
// 11 backend boundaries, and the backend.error.caught path scrubs PII from the
// exception message.
//
// We capture stdout (the emitter writes one single-line JSON per event to
// Console.Out) and assert the boundary set + scrub behavior. The PocketBase
// background write is disabled (no PbWriteUrl) so the test never touches the
// network.
//
// These tests redirect Console.Out to capture the emitter's stdout. xUnit does
// not parallelize tests within a single class, but other test classes could run
// concurrently and write to the shared Console — so the suite is pinned to a
// non-parallel collection to keep the capture deterministic.
[CollectionDefinition("CvdiagStdout", DisableParallelization = true)]
public sealed class CvdiagStdoutCollection { }

[Collection("CvdiagStdout")]
public class CvdiagEmissionTests
{
    private static IReadOnlyDictionary<string, string?> ArmedEnv() => new Dictionary<string, string?>
    {
        ["CVDIAG_BACKEND_EMITTER"] = "on",
        // DEBUG tier so EVERY backend boundary is included — backend.sse.event is
        // debug-tier-only in the §6 tier matrix. DEBUG fail-closes unless the env
        // is non-production AND an allow-list is set, so satisfy both here.
        ["CVDIAG_DEBUG"] = "1",
        ["SHOWCASE_ENV"] = "development",
        ["CVDIAG_DEBUG_ALLOW_LIST"] = "gen-ui-chat",
    };

    private static CvdiagBackend.RequestContext Ctx() => new()
    {
        Slug = "gen-ui-chat",
        Demo = "default",
        TestId = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
        IngressMs = 1000,
    };

    private sealed class StdoutCapture : IDisposable
    {
        private readonly System.IO.TextWriter _original;
        private readonly System.IO.StringWriter _buffer = new();
        public StdoutCapture()
        {
            _original = Console.Out;
            Console.SetOut(_buffer);
        }
        public string Text => _buffer.ToString();
        public void Dispose() => Console.SetOut(_original);
    }

    private static List<string> Boundaries(string stdout)
    {
        var found = new List<string>();
        foreach (var line in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("boundary", out var b))
                {
                    found.Add(b.GetString()!);
                }
            }
            catch
            {
                // non-JSON noise — ignore
            }
        }
        return found;
    }

    // (1) All 11 backend boundaries fire for a synthetic agent invocation.
    [Fact]
    public void AllElevenBackendBoundaries_Fire_WhenArmed()
    {
        var backend = new CvdiagBackend(ArmedEnv());
        Assert.True(backend.IsEnabled);
        var ctx = Ctx();

        using var cap = new StdoutCapture();

        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        http.Request.Method = "POST";
        http.Request.Path = "/gen-ui-chat";

        backend.EmitRequestIngress(ctx, http);
        backend.EmitAgentEnter(ctx, "gen-ui-chat", "gpt-4o-mini");
        backend.EmitLlmCallStart(ctx, "openai", "gpt-4o-mini", 128);
        backend.EmitLlmCallHeartbeat(ctx, 10_000);
        backend.EmitLlmCallResponse(ctx, "openai", "gpt-4o-mini", 256, 1500, null);
        backend.EmitSseFirstByte(ctx, 350);
        backend.EmitSseEvent(ctx, "message", 64, 0);
        backend.EmitSseAborted(ctx, "client_disconnect", 1024);
        backend.EmitAgentExit(ctx, "ok", 2000);
        backend.EmitResponseComplete(ctx, 200, 4096, 2000, 5);
        backend.EmitErrorCaught(ctx, new InvalidOperationException("boom"));

        var boundaries = Boundaries(cap.Text);
        var expected = new[]
        {
            "backend.request.ingress", "backend.agent.enter", "backend.llm.call.start",
            "backend.llm.call.heartbeat", "backend.llm.call.response", "backend.sse.first_byte",
            "backend.sse.event", "backend.sse.aborted", "backend.agent.exit",
            "backend.response.complete", "backend.error.caught",
        };
        foreach (var b in expected)
        {
            Assert.Contains(b, boundaries);
        }
        Assert.Equal(11, expected.Length);
    }

    // (2) OFF by default: with no CVDIAG_BACKEND_EMITTER, the layer is a no-op.
    [Fact]
    public void Disabled_ByDefault_EmitsNothing()
    {
        var backend = new CvdiagBackend(new Dictionary<string, string?>());
        Assert.False(backend.IsEnabled);

        using var cap = new StdoutCapture();
        var ctx = Ctx();
        backend.EmitAgentEnter(ctx, "x", "y");
        backend.EmitErrorCaught(ctx, new Exception("nope"));

        Assert.Empty(Boundaries(cap.Text));
    }

    // (3) PII scrub: a secret-shaped token in the exception message is redacted.
    [Fact]
    public void ErrorCaught_ScrubsPii_FromMessage()
    {
        var backend = new CvdiagBackend(ArmedEnv());
        var ctx = Ctx();

        using var cap = new StdoutCapture();
        backend.EmitErrorCaught(ctx,
            new InvalidOperationException("upstream rejected key sk-test-1234567890 with Bearer abc123def456"));

        var line = cap.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .First(l => l.Contains("backend.error.caught"));
        Assert.DoesNotContain("sk-test-1234567890", line);
        Assert.DoesNotContain("abc123def456", line);
        Assert.Contains("[REDACTED]", line);
    }

    // (3b) Scrub helper directly (unit-level): bearer + sk- keys redacted, cap at 512B.
    [Fact]
    public void Scrub_RedactsSecrets_AndCaps()
    {
        Assert.Equal("[REDACTED]", CvdiagBackend.Scrub("sk-abcdefgh12345"));
        Assert.DoesNotContain("topsecret", CvdiagBackend.Scrub("Bearer topsecret-token"));
        var big = new string('x', 2000);
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(CvdiagBackend.Scrub(big)) <= 512);
    }

    // (3c) URL userinfo: a `scheme://user:pass@host` authority and the colon-less
    // `scheme://token@host` form both leak credentials in connection-error text.
    // Mirrors scrubSecrets' URL_USERINFO_REGEX (harness/src/cvdiag/scrub.ts).
    [Fact]
    public void Scrub_RedactsUrlUserinfo_AndBareToken()
    {
        var withPass = CvdiagBackend.Scrub("connect failed: https://user:pass@example.com/x");
        Assert.DoesNotContain("user:pass", withPass);
        Assert.DoesNotContain("pass@", withPass);
        Assert.Contains("[REDACTED]@", withPass);
        Assert.Contains("example.com", withPass); // host preserved

        var bareToken = CvdiagBackend.Scrub("connect failed: https://ghp_token@example.com/x");
        Assert.DoesNotContain("ghp_token", bareToken);
        Assert.Contains("[REDACTED]@", bareToken);
        Assert.Contains("example.com", bareToken); // host preserved
    }
}
