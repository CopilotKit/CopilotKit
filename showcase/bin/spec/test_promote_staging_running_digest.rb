# frozen_string_literal: true

require_relative "spec_helper"

# Covers the staging-running-digest pin + drift warning:
#   CASE-A: staging RUNNING digest == current :latest  -> pin it, NO warning.
#   CASE-B: staging RUNNING digest != current :latest  -> pin the RUNNING
#           digest (NOT :latest) + emit the loud STAGING DRIFT warning.
#   CASE-C: resolved_prod_image pins meta.imageDigest, not resolve_digest(tag).
#   CASE-D: no SUCCESS staging deployment -> resolved_prod_image returns nil
#           (caller REFUSEs rather than pin a mutable tag).
class PromoteStagingRunningDigestTest < Minitest::Test
    # GHCR fake: resolve_digest(:latest-tag) returns a configurable "current
    # latest" digest; manifest_exists is always :exists. Counts resolve_digest
    # calls so we can assert the tag is NOT used to pick the prod pin.
    class FakeGHCR
        attr_reader :resolve_calls

        def initialize(current_latest:)
            @current_latest = current_latest
            @resolve_calls  = Hash.new(0)
        end

        def resolve_digest(ref)
            @resolve_calls[ref] += 1
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @current_latest
        end

        def manifest_exists(_ref); :exists; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    # Benign GQL: P2 issues a deployments query; return empty so P2 is a no-op.
    class FakeGQLEmpty
        def query(*); { "deployments" => { "edges" => [] } }; end
    end

    def make_cmd(staging_services:, prod_services: [], current_latest:, running_meta:)
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes", "--confirm-divergence"])
        cmd.parser.parse!(cmd.argv)
        cmd.instance_variable_set(:@staging_snapshot, { "services" => staging_services })
        cmd.instance_variable_set(:@prod_snapshot,    { "services" => prod_services })
        cmd.instance_variable_set(:@gql,  FakeGQLEmpty.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(current_latest: current_latest))
        # The RUNNING digest source: latest SUCCESS staging deployment's
        # meta.imageDigest. Keyed implicitly by the single service under test.
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            [{ "id" => "d", "status" => "SUCCESS", "meta" => running_meta }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
        cmd
    end

    STG = lambda do |name|
        {
            "name" => name, "service_id" => "svc-stg-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}:latest",
            "env_keys" => [],
        }
    end

    # =================== CASE-C: pins meta.imageDigest, not :latest ===========

    def test_resolved_prod_image_pins_running_digest_not_latest
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            current_latest:   "sha256:261ccdef",  # the WRONG (drifted) :latest
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest",
                                "imageDigest" => "sha256:f9454e79" }, # the RUNNING digest
        )
        resolved = cmd.send(:resolved_prod_image, STG.call("x"))
        assert_equal "ghcr.io/copilotkit/x@sha256:f9454e79", resolved,
            "must pin staging RUNNING digest (meta.imageDigest), NOT current :latest"
        # resolve_digest(:latest-tag) must NOT be what picks the prod pin.
        refute_includes resolved, "261ccdef",
            "prod pin must not be the current :latest digest"
    end

    # =================== CASE-D: no SUCCESS deploy -> nil =====================

    def test_resolved_prod_image_nil_when_no_running_digest
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            current_latest:   "sha256:261ccdef",
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest" }, # no imageDigest
        )
        # Drop the SUCCESS deployment entirely.
        cmd.define_singleton_method(:fetch_latest_staging_deployments) { |_| [] }
        assert_nil cmd.send(:resolved_prod_image, STG.call("x")),
            "must return nil (caller REFUSEs) when no running digest is resolvable"
    end

    # =================== CASE-A: running == :latest -> no warning ============

    def test_no_drift_warning_when_running_equals_latest
        same = "sha256:cafebabe"
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            prod_services:    [{ "name" => "x", "service_id" => "svc-prod-x",
                                 "image" => "ghcr.io/copilotkit/x@sha256:OLD", "env_keys" => [] }],
            current_latest:   same,
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest", "imageDigest" => same },
        )
        out, _err = capture_io { cmd.send(:check_p1_ghcr_digests, cmd.instance_variable_get(:@staging_snapshot)) }
        cmd.send(:emit_staging_drift_warnings)
        out2, _ = capture_io { cmd.send(:emit_staging_drift_warnings) }
        refute_match(/STAGING DRIFT/, out + out2,
            "no drift warning when staging RUNNING == current :latest")
        # And the pinned ref is still the running digest.
        assert_equal "ghcr.io/copilotkit/x@sha256:cafebabe",
            cmd.instance_variable_get(:@promote_refs)["x"]
    end

    # =================== CASE-B: running != :latest -> warning ===============

    def test_drift_warning_when_running_differs_from_latest
        cmd = make_cmd(
            staging_services: [STG.call("ms-agent-dotnet")],
            prod_services:    [{ "name" => "ms-agent-dotnet", "service_id" => "svc-prod-d",
                                 "image" => "ghcr.io/copilotkit/ms-agent-dotnet@sha256:OLD", "env_keys" => [] }],
            current_latest:   "sha256:261ccdef3f9a",  # drifted :latest
            running_meta:     { "image" => "ghcr.io/copilotkit/ms-agent-dotnet:latest",
                                "imageDigest" => "sha256:f9454e79fbf5" }, # RUNNING
        )
        # Run P1 (populates @promote_refs + @staging_drift) then emit the warning.
        capture_io { cmd.send(:check_p1_ghcr_digests, cmd.instance_variable_get(:@staging_snapshot)) }
        out, _err = capture_io { cmd.send(:emit_staging_drift_warnings) }

        assert_match(/STAGING DRIFT/, out, "must emit the loud drift block")
        assert_match(/ms-agent-dotnet/, out, "must name the drifted service")
        assert_match(/f9454e79/, out, "must name the staging RUNNING digest")
        assert_match(/261ccdef/, out, "must name the current :latest digest")
        # Promote still pins the RUNNING digest (drift is a warning, not a refuse).
        assert_equal "ghcr.io/copilotkit/ms-agent-dotnet@sha256:f9454e79fbf5",
            cmd.instance_variable_get(:@promote_refs)["ms-agent-dotnet"],
            "promote must STILL pin the staging RUNNING digest despite drift"
    end

    # =================== CASE-F: --digest override -> NO drift signal ========

    # When the operator supplies an explicit --digest for a single service, the
    # pinned ref is the operator's CHOSEN override (not staging's running
    # digest), so "drift from :latest" is meaningless. detect_staging_drift must
    # skip — even when the override digest differs from current :latest — and
    # emit_staging_drift_warnings must say nothing for it.
    def test_no_drift_signal_when_digest_override_active
        override_ref = "ghcr.io/copilotkit/x@sha256:0verr1de00"
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            current_latest:   "sha256:261ccdef",  # differs from the override digest
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest",
                                "imageDigest" => "sha256:f9454e79" },
        )
        # Operator pinned an explicit digest for this single service (mirrors the
        # `run`-time options after `promote x --digest <ref>`).
        cmd.options[:service] = "x"
        cmd.options[:digest]  = override_ref

        capture_io { cmd.send(:check_p1_ghcr_digests, cmd.instance_variable_get(:@staging_snapshot)) }

        # No drift entry recorded — the override is a deliberate choice, not drift.
        assert_empty Array(cmd.instance_variable_get(:@staging_drift)),
            "a --digest override must NOT be recorded as staging drift"

        # And the loud warning emits nothing for it.
        out, _ = capture_io { cmd.send(:emit_staging_drift_warnings) }
        refute_match(/STAGING DRIFT/, out,
            "a --digest override must not produce a (spurious) drift warning")
        refute_match(/STAGING_DRIFT_MARKER/, out,
            "a --digest override must not emit a drift marker")

        # The override digest is what got pinned (verbatim).
        assert_equal override_ref, cmd.instance_variable_get(:@promote_refs)["x"],
            "promote must pin the operator's chosen override digest"
    end

    # =================== CASE-E: GHCR resolve fails -> loud WARN, no abort ====

    # GHCR fake whose tag resolution RAISES (auth/transport failure), but digest
    # refs (@sha256:...) still resolve — so resolved_prod_image's running-digest
    # pin succeeds while detect_staging_drift's :latest comparison blows up.
    class FakeGHCRRaisingTag
        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            raise StandardError, "GHCR auth failed (boom)"
        end

        def manifest_exists(_ref); :exists; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def test_drift_check_failure_warns_loudly_and_does_not_abort
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            current_latest:   "sha256:unused",
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest",
                                "imageDigest" => "sha256:f9454e79" },
        )
        cmd.instance_variable_set(:@ghcr, FakeGHCRRaisingTag.new)

        out, err = capture_io do
            cmd.send(:check_p1_ghcr_digests, cmd.instance_variable_get(:@staging_snapshot))
        end

        # Fail loud: the drift-check failure must surface, with the error message.
        assert_match(/WARN: staging drift check failed for x/, out + err,
            "must emit a loud WARN when the GHCR :latest resolve fails")
        assert_match(/GHCR auth failed \(boom\)/, out + err,
            "WARN must carry the underlying error message")

        # Promote PROCEEDS: the running-digest pin still happened (no abort).
        assert_equal "ghcr.io/copilotkit/x@sha256:f9454e79",
            cmd.instance_variable_get(:@promote_refs)["x"],
            "promote must STILL pin the running digest despite the drift-check failure"

        # No drift entry recorded (the check could not be performed).
        assert_empty Array(cmd.instance_variable_get(:@staging_drift)),
            "a check FAILURE must not be recorded as a drift"
        out2, _ = capture_io { cmd.send(:emit_staging_drift_warnings) }
        refute_match(/STAGING DRIFT/, out2,
            "a check failure must not produce a (false) drift warning")
    end

    # =================== CASE-B (machine marker for Slack payload) ===========

    def test_drift_emits_machine_readable_marker
        # The bordered block is for humans; promote-fleet.sh greps the
        # STAGING_DRIFT_MARKER: line and aggregates it into the Slack payload.
        cmd = make_cmd(
            staging_services: [STG.call("x")],
            current_latest:   "sha256:aaaa1111",
            running_meta:     { "image" => "ghcr.io/copilotkit/x:latest", "imageDigest" => "sha256:bbbb2222" },
        )
        capture_io { cmd.send(:check_p1_ghcr_digests, cmd.instance_variable_get(:@staging_snapshot)) }
        out, _ = capture_io { cmd.send(:emit_staging_drift_warnings) }
        assert_match(/^STAGING_DRIFT_MARKER: /, out, "must emit a machine-readable drift marker line")
        assert_match(/running=bbbb2222/, out, "marker must carry the RUNNING digest")
        assert_match(/latest=aaaa1111/, out, "marker must carry the :latest digest")
    end
end
