using System.Text;
using System.Text.Json;
using CopilotKit.Intelligence;

internal static class LicenseTelemetryTests
{
    internal static async Task RunAsync()
    {
        var names = new[] { "COPILOTKIT_LICENSE_TOKEN", "CPK_TELEMETRY_ID", "COPILOTKIT_TELEMETRY_SAMPLE_RATE", "DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED" };
        var saved = names.ToDictionary(name => name, Environment.GetEnvironmentVariable);
        try
        {
            foreach (var name in names) Environment.SetEnvironmentVariable(name, null);
            var token = Token("{\"telemetry_id\":\" \tlicense-id_1 \t\",\"secret\":\"NEVER_SEND_LICENSE_CLAIMS\"}".Replace("\t", "\\t", StringComparison.Ordinal));
            Environment.SetEnvironmentVariable("COPILOTKIT_LICENSE_TOKEN", token);
            var exporter = new CaptureExporter();
            await using (var telemetry = new RuntimeTelemetry(Options(exporter, 0))) { }
            Check(exporter.Events.Count == 1, "license claim bypasses zero anonymous sampling");
            var item = exporter.Events.Single();
            Check(item.Identity == "license-id_1" && (bool)item.GlobalProperties["telemetry_identified"]! && (double)item.GlobalProperties["sampleRate"]! == 1 && (double)item.GlobalProperties["sampleRateAdjustmentFactor"]! == 0 && (double)item.GlobalProperties["sampleWeight"]! == 1, "license claim selects exact identified sampling metadata");
            Check(!JsonSerializer.Serialize(item).Contains(token, StringComparison.Ordinal) && !JsonSerializer.Serialize(item).Contains("NEVER_SEND_LICENSE_CLAIMS", StringComparison.Ordinal), "license token and unrelated claims never enter telemetry events");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: Token("{\"telemetry_id\":\"option-license\"}"))).Identity == "option-license", "license option wins over license environment fallback");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: " \t ")).Identity == "license-id_1", "blank license option falls back to environment");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: "\uFEFF")).Identity == "license-id_1", "license fallback matches JavaScript BOM whitespace");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: "\u0085")).Identity is null, "license fallback does not treat NEL as JavaScript whitespace");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: "malformed-configured-token")).Identity is null, "configured malformed license does not fall through to ambient license");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 0, licenseToken: Token("{\"telemetry_id\":\"expired-claim\",\"exp\":1}"))).Identified, "analytics claims do not verify JWT signatures or expiry");

            Environment.SetEnvironmentVariable("CPK_TELEMETRY_ID", "standalone-env");
            exporter = new CaptureExporter();
            await using (var telemetry = new RuntimeTelemetry(Options(exporter, 0, licenseToken: token))) { }
            Check(exporter.Events.Count == 0, "standalone environment identity suppresses license sampling bypass");
            exporter = new CaptureExporter();
            await using (var telemetry = new RuntimeTelemetry(Options(exporter, 1, "standalone-option"))) { }
            Check(exporter.Events.Single().Identity == "standalone-option" && !(bool)exporter.Events.Single().GlobalProperties["telemetry_identified"]!, "standalone option wins without license sampling authority");
            Environment.SetEnvironmentVariable("CPK_TELEMETRY_ID", null);

            foreach (var mode in new[] { "explicit", "DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED" })
            {
                if (mode != "explicit") Environment.SetEnvironmentVariable(mode, "1");
                exporter = new CaptureExporter();
                await using (var telemetry = new RuntimeTelemetry(Options(exporter, 0, disabled: mode == "explicit"))) { }
                Check(exporter.Events.Count == 0, "global opt-out defeats license bypass: " + mode);
                if (mode != "explicit") Environment.SetEnvironmentVariable(mode, null);
            }

            var caseNumber = 0;
            foreach (var invalid in new[] { "", "not-a-jwt", "a.b.c.d", "a..c", "a.A.c", "a.e30=.c", "a.e30$.c", Token("null"), Token("[]"), Token("{}"), Token("{\"telemetry_id\":42}"), Token("{\"telemetry_id\":\"bad\\nid\"}"), Token("{\"telemetry_id\":\"tenant-é\"}"), Token("{\"telemetry_id\":\"" + new string('a', 129) + "\"}"), Token("{\"telemetry_id\":\"\\ud800\"}") })
            {
                Environment.SetEnvironmentVariable("COPILOTKIT_LICENSE_TOKEN", invalid);
                var settings = TelemetrySettings.Resolve(Options(new CaptureExporter(), 0));
                Check(settings.Identity is null && settings.SampleRate == 0, "malformed license remains anonymous: " + caseNumber++);
            }
        }
        finally { foreach (var pair in saved) Environment.SetEnvironmentVariable(pair.Key, pair.Value); }
    }

    private static string Token(string payload) => "unverified-header." + Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_') + ".unverified-signature";
    private static void Check(bool condition, string name) { Console.WriteLine((condition ? "PASS " : "FAIL ") + name); if (!condition) throw new Exception(name); }
    private static RuntimeOptions Options(IRuntimeTelemetryExporter exporter, double rate, string? identity = null, bool disabled = false, string? licenseToken = null) => new()
    {
        ApiUrl = new Uri("http://unused.invalid"), RunnerUrl = new Uri("ws://unused.invalid/runner"), ClientUrl = new Uri("ws://unused.invalid/client"), ApiKey = "never-export",
        Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new SequenceAgent([]) }, IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(null),
        TelemetryExporter = exporter, TelemetrySampleRate = rate, TelemetryId = identity, TelemetryDisabled = disabled, LicenseToken = licenseToken
    };
}
