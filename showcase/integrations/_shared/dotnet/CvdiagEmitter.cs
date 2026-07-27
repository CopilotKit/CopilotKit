// CvdiagEmitter.cs — the shared .NET CVDIAG emitter (plan unit L0-D; spec §6/§7).
//
// Mirrors the canonical TS `emit.ts` contract for the .NET integrations:
//   • Tier resolution from the deployment environment, with the .NET-specific
//     precedence SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → ASPNETCORE_ENVIRONMENT
//     (the last is the .NET analogue of TS's NODE_ENV).
//   • Fail-closed DEBUG: the constructor throws (startup assertion — the ONE
//     place the emitter is permitted to throw) when DEBUG is requested in a
//     production env, when no env resolves (unknown == production), or when no
//     CVDIAG_DEBUG_ALLOW_LIST is provided.
//   • §6 tier matrix: a boundary is emitted only if included at the current
//     tier; `cvdiag.*` accounting boundaries are always emitted.
//   • DEBUG auto-off: after 10 minutes OR 10k events, DEBUG disarms and falls
//     back to default-tier inclusion.
//   • Closed-world metadata filter: unknown metadata keys for the boundary are
//     dropped and `_metadata_dropped` is stamped.
//   • Edge-header allow/deny filter (9 allow / 12 deny, exact-match, deny wins,
//     case-insensitive, no cf-ip* wildcard).
//   • Per-event byte cap by tier; over-budget envelopes are trimmed +
//     `_truncated` stamped.
//   • EmitEvent → single-line JSON to stdout, PLUS a background fire-and-forget
//     PocketBase write (HttpClient, ≤1s timeout) that never blocks or throws
//     into the observed boundary.
//
// Pure instrumentation: outside the constructor's startup guard, a CVDIAG
// failure must NEVER throw into the caller (spec §7). All hot-path errors
// degrade to a stderr CVDIAG-tagged warning.

using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using System.Security.Cryptography;

namespace Copilotkit.Showcase.Cvdiag;

/// <summary>Resolved verbosity tier (cumulative; spec §6).</summary>
public enum CvdiagTier { Default, Verbose, Debug }

/// <summary>Construction options for <see cref="CvdiagEmitter"/>.</summary>
public sealed class CvdiagEmitterOptions
{
    /// <summary>Force DEBUG tier (subject to the fail-closed prod guard).</summary>
    public bool Debug { get; init; }
    /// <summary>Force VERBOSE tier (DEBUG wins if both set).</summary>
    public bool Verbose { get; init; }
    /// <summary>Environment bag; defaults to the process environment.</summary>
    public IReadOnlyDictionary<string, string?>? Env { get; init; }
    /// <summary>Owning layer for default envelope fields.</summary>
    public CvdiagLayer Layer { get; init; } = CvdiagLayer.Backend;
    /// <summary>PocketBase ingest URL; when null, no background write is attempted.</summary>
    public string? PbWriteUrl { get; init; }
    /// <summary>Injected HttpClient (tests); defaults to a shared 1s-timeout client.</summary>
    public HttpClient? HttpClient { get; init; }
    /// <summary>Emit the single-line JSON to stdout (default true).</summary>
    public bool WriteToStdout { get; init; } = true;
}

/// <summary>Arguments for a single <see cref="CvdiagEmitter.Emit"/> call.</summary>
public sealed class CvdiagEmitArgs
{
    public required CvdiagLayer Layer { get; init; }
    public required CvdiagBoundary Boundary { get; init; }
    public required string Slug { get; init; }
    public required string Demo { get; init; }
    public required CvdiagOutcome Outcome { get; init; }
    public EdgeHeaders? EdgeHeaders { get; init; }
    public Dictionary<string, object?>? Metadata { get; init; }
    public long? DurationMs { get; init; }
    public string? ParentSpanId { get; init; }
    /// <summary>Override test_id (e.g. probe.start mints one and threads it).</summary>
    public string? TestId { get; init; }
}

public sealed class CvdiagEmitter
{
    // §6 hard bounds + §7 byte caps (mirror emit.ts constants).
    private const long DebugMaxWallclockMs = 10 * 60 * 1000;
    private const int DebugMaxEvents = 10_000;
    private static readonly IReadOnlyDictionary<CvdiagTier, int> ByteCapByTier =
        new Dictionary<CvdiagTier, int>
        {
            [CvdiagTier.Default] = 2 * 1024,
            [CvdiagTier.Verbose] = 4 * 1024,
            [CvdiagTier.Debug] = 16 * 1024,
        };

    private const string AccountingPrefix = "cvdiag.";

    // The 12-name DENY list (spec §5). Exact-match, lowercase, deny wins; the
    // cf-ip* family is blocked by these explicit entries, NOT a wildcard.
    private static readonly HashSet<string> DenyList = new(StringComparer.Ordinal)
    {
        "cf-ipcountry", "cf-connecting-ip", "cf-ipcity", "cf-iplatitude",
        "cf-iplongitude", "cf-iptimezone", "cf-visitor", "cf-worker",
        "true-client-ip", "x-forwarded-for", "x-real-ip", "forwarded",
    };
    private static readonly HashSet<string> AllowList =
        new(CvdiagSchema.EdgeHeaderKeys, StringComparer.Ordinal);

    // §6 tier matrix: per data-plane boundary, included-at-tier flags.
    private static readonly IReadOnlyDictionary<string, (bool Default, bool Verbose, bool Debug)> TierMatrix =
        new Dictionary<string, (bool, bool, bool)>
        {
            ["probe.start"] = (false, true, true),
            ["probe.navigate.complete"] = (false, true, true),
            ["probe.message.send"] = (true, true, true),
            ["probe.dom.container.mount"] = (true, true, true),
            ["probe.dom.firsttoken"] = (true, true, true),
            ["probe.dom.alternate_content"] = (true, true, true),
            ["probe.sse.event"] = (false, true, true),
            ["probe.sse.aborted"] = (true, true, true),
            ["probe.network.error"] = (true, true, true),
            ["probe.network.response"] = (true, true, true),
            ["probe.console.error"] = (true, true, true),
            ["probe.exit"] = (true, true, true),
            ["backend.request.ingress"] = (false, true, true),
            ["backend.agent.enter"] = (true, true, true),
            ["backend.llm.call.start"] = (false, true, true),
            ["backend.llm.call.heartbeat"] = (false, true, true),
            ["backend.llm.call.response"] = (false, true, true),
            ["backend.sse.first_byte"] = (false, true, true),
            ["backend.sse.event"] = (false, false, true),
            ["backend.sse.aborted"] = (true, true, true),
            ["backend.agent.exit"] = (true, true, true),
            ["backend.response.complete"] = (true, true, true),
            ["backend.error.caught"] = (true, true, true),
            ["aimock.request.ingress"] = (false, true, true),
            ["aimock.match.decision"] = (false, true, true),
            ["aimock.response.start"] = (false, true, true),
            ["aimock.sse.chunk"] = (false, false, true),
            ["aimock.response.aborted"] = (true, true, true),
            ["aimock.response.complete"] = (true, true, true),
        };

    private static readonly HttpClient SharedHttpClient =
        new() { Timeout = TimeSpan.FromSeconds(1) };

    private readonly IReadOnlyDictionary<string, string?> _env;
    private readonly CvdiagLayer _defaultLayer;
    private readonly string? _pbWriteUrl;
    private readonly HttpClient _httpClient;
    private readonly bool _writeToStdout;
    private readonly long _debugDeadlineMs;
    private readonly Stopwatch _mono = Stopwatch.StartNew();

    private long _debugEventCount;
    private bool _debugDisarmed;

    public CvdiagTier Tier { get; }

    public CvdiagEmitter(CvdiagEmitterOptions? options = null)
    {
        options ??= new CvdiagEmitterOptions();
        _env = options.Env ?? ReadProcessEnv();
        _defaultLayer = options.Layer;
        _pbWriteUrl = options.PbWriteUrl;
        _httpClient = options.HttpClient ?? SharedHttpClient;
        _writeToStdout = options.WriteToStdout;

        var wantsDebug = options.Debug || _env.GetValueOrDefault("CVDIAG_DEBUG") == "1";
        var wantsVerbose = options.Verbose || _env.GetValueOrDefault("CVDIAG_VERBOSE") == "1";

        if (wantsDebug)
        {
            AssertDebugAllowed();
            Tier = CvdiagTier.Debug;
            _debugDeadlineMs = NowMs() + DebugMaxWallclockMs;
        }
        else
        {
            Tier = wantsVerbose ? CvdiagTier.Verbose : CvdiagTier.Default;
        }
    }

    /// <summary>
    /// Resolve the deployment-environment label (spec §6 production detection):
    /// SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → ASPNETCORE_ENVIRONMENT.
    /// Returns the lowercase label, or null if none resolves.
    /// </summary>
    public static string? ResolveEnvLabel(IReadOnlyDictionary<string, string?> env)
    {
        var raw = env.GetValueOrDefault("SHOWCASE_ENV")
                  ?? env.GetValueOrDefault("RAILWAY_ENVIRONMENT_NAME")
                  ?? env.GetValueOrDefault("ASPNETCORE_ENVIRONMENT");
        return string.IsNullOrEmpty(raw) ? null : raw.ToLowerInvariant();
    }

    /// <summary>
    /// DEBUG startup assertion (spec §6 hard bounds). Throws (fail-closed) when
    /// the env is production, unresolved (unknown == production), or no
    /// allow-list is provided. The ONE place the emitter may throw.
    /// </summary>
    private void AssertDebugAllowed()
    {
        var label = ResolveEnvLabel(_env);
        if (label is null)
        {
            throw new InvalidOperationException(
                "CVDIAG_DEBUG refused: deployment environment is unresolved " +
                "(SHOWCASE_ENV → RAILWAY_ENVIRONMENT_NAME → ASPNETCORE_ENVIRONMENT all unset); " +
                "fail-closed treats unknown env as production.");
        }
        if (label == "production")
        {
            throw new InvalidOperationException(
                "CVDIAG_DEBUG refused: deployment environment is production.");
        }
        var allowList = _env.GetValueOrDefault("CVDIAG_DEBUG_ALLOW_LIST");
        if (string.IsNullOrWhiteSpace(allowList))
        {
            throw new InvalidOperationException(
                "CVDIAG_DEBUG refused: CVDIAG_DEBUG_ALLOW_LIST is required " +
                "(comma-separated slug list) before DEBUG may start.");
        }
    }

    /// <summary>True iff the boundary is included at the current tier.</summary>
    public bool ShouldEmit(CvdiagBoundary boundary)
    {
        var wire = CvdiagSchema.WireValue(boundary);
        if (wire.StartsWith(AccountingPrefix, StringComparison.Ordinal))
        {
            return true; // accounting events always emit
        }
        if (Tier == CvdiagTier.Debug && IsDebugExpired())
        {
            return TierMatrix.TryGetValue(wire, out var fb) && fb.Default;
        }
        if (!TierMatrix.TryGetValue(wire, out var row)) return false;
        return Tier switch
        {
            CvdiagTier.Default => row.Default,
            CvdiagTier.Verbose => row.Verbose,
            CvdiagTier.Debug => row.Debug,
            _ => false,
        };
    }

    private bool IsDebugExpired()
    {
        if (_debugDisarmed) return true;
        if (NowMs() >= _debugDeadlineMs || _debugEventCount >= DebugMaxEvents)
        {
            _debugDisarmed = true;
            return true;
        }
        return false;
    }

    /// <summary>
    /// Emit one event: tier-filter, mint ids, closed-world metadata filter,
    /// byte-cap, then EmitEvent (stdout + background PB write). Returns the
    /// built envelope, or null when filtered out / on failure. Never throws.
    /// </summary>
    public CvdiagEnvelope? Emit(CvdiagEmitArgs args)
    {
        try
        {
            if (!ShouldEmit(args.Boundary)) return null;
            if (Tier == CvdiagTier.Debug) _debugEventCount++;

            var wire = CvdiagSchema.WireValue(args.Boundary);
            var isDataPlane = !wire.StartsWith(AccountingPrefix, StringComparison.Ordinal);

            var metadata = new Dictionary<string, object?>();
            var metadataDropped = false;
            if (isDataPlane)
            {
                (metadata, metadataDropped) = FilterMetadata(wire, args.Metadata);
            }
            else if (args.Metadata is not null)
            {
                // Accounting events ride their payload verbatim (trusted internal).
                metadata = new Dictionary<string, object?>(args.Metadata);
            }

            var testId = args.TestId ?? MintTestId();
            var envelope = new CvdiagEnvelope
            {
                SchemaVersion = CvdiagSchema.SchemaVersion,
                TestId = testId,
                TraceId = testId,
                SpanId = MintSpanId(),
                ParentSpanId = args.ParentSpanId,
                Layer = args.Layer,
                Boundary = args.Boundary,
                Slug = args.Slug,
                Demo = args.Demo,
                Ts = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                MonoNs = MonoNs(),
                DurationMs = args.DurationMs,
                Outcome = args.Outcome,
                EdgeHeaders = args.EdgeHeaders ?? new EdgeHeaders(),
                Metadata = metadata,
                MetadataDropped = metadataDropped,
            };

            ApplyByteCap(envelope);
            EmitEvent(envelope);
            return envelope;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"CVDIAG emit failed boundary={args.Boundary} error={ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// EmitEvent: write the single-line JSON to stdout AND kick off a
    /// fire-and-forget background PB write (≤1s). Never blocks the caller;
    /// background failures are swallowed to a stderr warning.
    /// </summary>
    public void EmitEvent(CvdiagEnvelope envelope)
    {
        string json;
        try
        {
            json = JsonSerializer.Serialize(envelope, CvdiagJsonContext.Default.CvdiagEnvelope);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"CVDIAG serialize failed error={ex.Message}");
            return;
        }

        if (_writeToStdout) Console.Out.WriteLine(json);

        if (string.IsNullOrEmpty(_pbWriteUrl)) return;
        // Fire-and-forget: do not await, do not throw into the boundary.
        _ = BackgroundWriteAsync(json);
    }

    private async Task BackgroundWriteAsync(string json)
    {
        try
        {
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            await _httpClient.PostAsync(_pbWriteUrl, content, cts.Token).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"CVDIAG pb-write failed error={ex.Message}");
        }
    }

    /// <summary>
    /// Closed-world metadata filter: keep only the boundary's schema keys; drop
    /// the rest and flag <c>_metadata_dropped</c> (spec §6). If the boundary has
    /// no key set (shouldn't happen for data-plane), keep nothing and flag drop.
    /// </summary>
    private static (Dictionary<string, object?> Metadata, bool Dropped) FilterMetadata(
        string wireBoundary, Dictionary<string, object?>? raw)
    {
        var result = new Dictionary<string, object?>();
        if (raw is null || raw.Count == 0) return (result, false);
        if (!CvdiagSchema.BoundaryMetadataKeys.TryGetValue(wireBoundary, out var allowed))
        {
            return (result, true);
        }
        var allowedSet = new HashSet<string>(allowed, StringComparer.Ordinal);
        var dropped = false;
        foreach (var (key, value) in raw)
        {
            if (allowedSet.Contains(key)) result[key] = value;
            else dropped = true;
        }
        return (result, dropped);
    }

    /// <summary>
    /// Filter a raw header bag to the closed 9-key <see cref="EdgeHeaders"/>:
    /// deny-list rejected first (deny wins, case-insensitive); non-allow keys
    /// dropped; every result carries all 9 keys (absent → null). No cf-ip*
    /// wildcard — only exact deny-list entries.
    /// </summary>
    public static EdgeHeaders FilterEdgeHeaders(IReadOnlyDictionary<string, string?> raw)
    {
        var kept = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var (rawKey, rawValue) in raw)
        {
            var key = rawKey.ToLowerInvariant();
            if (DenyList.Contains(key)) continue;     // deny wins
            if (!AllowList.Contains(key)) continue;   // closed-world
            kept[key] = rawValue;
        }
        string? Get(string k) => kept.TryGetValue(k, out var v) ? v : null;
        return new EdgeHeaders
        {
            CfRay = Get("cf-ray"),
            CfMitigated = Get("cf-mitigated"),
            CfCacheStatus = Get("cf-cache-status"),
            XRailwayEdge = Get("x-railway-edge"),
            XRailwayRequestId = Get("x-railway-request-id"),
            XHikariTrace = Get("x-hikari-trace"),
            RetryAfter = Get("retry-after"),
            Via = Get("via"),
            Server = Get("server"),
        };
    }

    /// <summary>
    /// Trim over-budget envelopes to the tier byte cap and stamp
    /// <c>_truncated</c> (spec §7). Metadata string values are trimmed first.
    /// </summary>
    private void ApplyByteCap(CvdiagEnvelope envelope)
    {
        var cap = ByteCapByTier[Tier];
        if (SerializedSize(envelope) <= cap) return;
        envelope.Truncated = true;
        foreach (var key in new List<string>(envelope.Metadata.Keys))
        {
            if (SerializedSize(envelope) <= cap) break;
            var value = envelope.Metadata[key];
            if (value is string s && s.Length > 64)
            {
                envelope.Metadata[key] = s[..61] + "...";
            }
            else if (value is not null && value is not (int or long or double or bool))
            {
                envelope.Metadata[key] = "[truncated]";
            }
        }
    }

    private static int SerializedSize(CvdiagEnvelope envelope)
    {
        try
        {
            var json = JsonSerializer.Serialize(envelope, CvdiagJsonContext.Default.CvdiagEnvelope);
            return Encoding.UTF8.GetByteCount(json);
        }
        catch
        {
            return int.MaxValue;
        }
    }

    /// <summary>
    /// Mint a UUIDv7 (RFC 9562): 48-bit Unix-ms timestamp, version nibble 7,
    /// variant bits 10. Lowercase hyphenated. Matches the TS mintTestId().
    /// </summary>
    public static string MintTestId(long? nowMs = null)
    {
        var bytes = new byte[16];
        RandomNumberGenerator.Fill(bytes);
        var ts = (ulong)(nowMs ?? NowMs());
        bytes[0] = (byte)((ts >> 40) & 0xff);
        bytes[1] = (byte)((ts >> 32) & 0xff);
        bytes[2] = (byte)((ts >> 24) & 0xff);
        bytes[3] = (byte)((ts >> 16) & 0xff);
        bytes[4] = (byte)((ts >> 8) & 0xff);
        bytes[5] = (byte)(ts & 0xff);
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x70); // version 7
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80); // variant 10
        var hex = Convert.ToHexString(bytes).ToLowerInvariant();
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..32]}";
    }

    /// <summary>Mint a 16-hex span id (8 random bytes).</summary>
    public static string MintSpanId()
    {
        var bytes = new byte[8];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private long MonoNs() => (long)(_mono.Elapsed.TotalMilliseconds * 1e6);

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static IReadOnlyDictionary<string, string?> ReadProcessEnv()
    {
        var dict = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables())
        {
            if (e.Key is string k) dict[k] = e.Value as string;
        }
        return dict;
    }
}
