# frozen_string_literal: true

# bin/railway promote — single-service positional + --digest support.
#
# Context: showcase_promote.yml loops services and invokes
#   bin/railway promote "$svc" [--digest "$DIGEST"]
# but the original PromoteCommand parser accepts NEITHER. The positional
# was silently discarded (promoting the ENTIRE fleet per iteration) and
# --digest raised OptionParser::InvalidOption (the workflow aborts under
# set -euo pipefail). These tests pin the fix contract.

require_relative "spec_helper"
require "stringio"

class PromoteSingleServiceTest < Minitest::Test
    # Minimal benign GQL fake (P2 deployments query, etc.). The promotion
    # tests below stub fetch_latest_staging_deployments and run_staging_probe
    # so this is only used as a fallback.
    class FakeGQLBenign
        attr_reader :calls
        def initialize
            @calls = []
            @pinned_by_service = {}  # serviceId => image; tracks per-service pin
            @ts_counter = 0
        end
        def query(q, vars = {})
            @calls << [q, vars]
            sid = vars[:serviceId]
            if q.include?("serviceInstanceUpdate")
                @pinned_by_service[sid] = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                { "serviceInstanceDeployV2" => "dep-#{sid}" }
            elsif q.include?("ServiceInstanceRecheck")
                pinned = @pinned_by_service[sid]
                if pinned.nil?
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => "ghcr.io/copilotkit/old@sha256:OLD" },
                            "updatedAt" => "2026-05-28T00:00:00Z",
                        },
                    }
                else
                    @ts_counter += 1
                    pinned_digest = pinned.include?("@") ? pinned.split("@", 2).last : nil
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => pinned },
                            "updatedAt" => "2026-05-29T00:00:#{format('%02d', @ts_counter)}Z",
                            "latestDeployment" => {
                                "id" => "dep-#{sid}", "status" => "SUCCESS",
                                "meta" => { "imageDigest" => pinned_digest },
                            },
                        },
                    }
                end
            else
                { "deployments" => { "edges" => [] } }
            end
        end

        def pinned_services
            @calls.select { |q, _| q.include?("serviceInstanceUpdate") }
                  .map { |_, vars| [vars[:serviceId], vars.dig(:input, :source, :image)] }
        end

        def pinned_image_for(service_id)
            row = @calls.find { |q, vars| q.include?("serviceInstanceUpdate") && vars[:serviceId] == service_id }
            row && row[1].dig(:input, :source, :image)
        end
    end

    class FakeGHCR
        def initialize(resolve_map: {})
            @resolve_map = resolve_map
        end
        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @resolve_map[ref] || "sha256:default_digest_for_#{ref.sub(/[^a-z0-9]/i, '_')[0, 16]}"
        end
        def manifest_exists(_ref); :exists; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def make_service(name, prod_image: "ghcr.io/copilotkit/#{name}@sha256:OLD#{name.gsub('-', '')}")
        {
            "name" => name, "service_id" => "svc-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}:latest",
            # All CRITICAL_ENV_KEYS present so the (now unconditional) critical
            # env-key presence assertion does not fire — this spec isolates the
            # single-service narrowing behavior, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def make_prod(name)
        {
            "name" => name, "service_id" => "prod-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}@sha256:OLD#{name.gsub('-', '')}",
            # All CRITICAL_ENV_KEYS present so the (now unconditional) critical
            # env-key presence assertion does not fire — this spec isolates the
            # single-service narrowing behavior, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def build_cmd(argv)
        cmd = Railway::PromoteCommand.new(argv + ["--non-interactive", "--yes", "--confirm-divergence"])
        # IMPORTANT: do NOT call parser.parse! here — tests must exercise the
        # full `run` path so argv parsing (positional + --digest) is covered.
        cmd
    end

    def install_two_service_fixture(cmd, gql, ghcr)
        # Two staging services — "aimock" and "harness" — both also in prod.
        staging_svcs = [make_service("aimock"), make_service("harness")]
        prod_svcs    = [make_prod("aimock"),    make_prod("harness")]
        cmd.instance_variable_set(:@staging_snapshot, { "services" => staging_svcs })
        cmd.instance_variable_set(:@prod_snapshot,    { "services" => prod_svcs })
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, ghcr)
        # Skip P2 race-check: stub deployments to SUCCESS with the digest the
        # promote will actually pin (which, when --digest is set, is the
        # override — NOT the GHCR-resolved one). Read options[:digest] off the
        # command at call-time so this works for both default and override
        # paths without test-side branching.
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |service_id|
            name = service_id.sub(/^svc-/, "")
            override = options[:digest]
            if override && options[:service] == name && override.include?("@")
                ref = override
            else
                ghcr_obj = instance_variable_get(:@ghcr)
                digest = ghcr_obj.resolve_digest("ghcr.io/copilotkit/#{name}:latest")
                ref = "ghcr.io/copilotkit/#{name}@#{digest}"
            end
            [{ "id" => "d", "status" => "SUCCESS", "meta" => { "image" => ref } }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
    end

    def with_fast_sleeper
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0)
        yield
    ensure
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original)
    end

    # ── (a) Positional service: only that service is promoted. ────────────

    def test_positional_service_promotes_only_that_service
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest"  => "sha256:NEW_AIMOCK",
            "ghcr.io/copilotkit/harness:latest" => "sha256:NEW_HARNESS",
        })
        cmd = build_cmd(["aimock"])
        install_two_service_fixture(cmd, gql, ghcr)
        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }
        assert_equal 0, rc, "single-service promote should succeed; got out=#{out}"

        pinned = gql.pinned_services
        assert_equal 1, pinned.size, "must pin exactly ONE service when positional is given (got #{pinned.inspect})"
        sid, image = pinned.first
        assert_equal "prod-aimock", sid, "must target prod-aimock, not the whole fleet"
        assert_equal "ghcr.io/copilotkit/aimock@sha256:NEW_AIMOCK", image
        # Loud regression guard against silent fleet-wide pin.
        refute gql.pinned_image_for("prod-harness"), "harness must NOT be touched when only aimock was requested"
    end

    # ── (b) Positional + --digest: digest overrides resolved ref. ─────────

    def test_positional_service_with_digest_pins_that_digest
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest"  => "sha256:NEW_AIMOCK",
            "ghcr.io/copilotkit/harness:latest" => "sha256:NEW_HARNESS",
        })
        override = "ghcr.io/copilotkit/aimock@sha256:OVERRIDE_DIGEST"
        cmd = build_cmd(["aimock", "--digest", override])
        install_two_service_fixture(cmd, gql, ghcr)
        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }
        assert_equal 0, rc, "promote with --digest should succeed; got out=#{out}"

        pinned = gql.pinned_services
        assert_equal 1, pinned.size, "--digest must still pin only the named service"
        sid, image = pinned.first
        assert_equal "prod-aimock", sid
        assert_equal override, image,
            "must pin the EXPLICIT --digest ref, not the GHCR-resolved one"
    end

    # ── (c) --digest without positional → fail fast. ──────────────────────

    def test_digest_without_service_fails_fast
        cmd = build_cmd(["--digest", "ghcr.io/copilotkit/x@sha256:abc"])
        ghcr = FakeGHCR.new
        gql  = FakeGQLBenign.new
        install_two_service_fixture(cmd, gql, ghcr)
        ex = nil
        # die! calls Kernel#exit which raises SystemExit; capture it so the
        # test can assert the exit code AND the error message together.
        out, err = capture_io { ex = assert_raises(SystemExit) { cmd.run } }
        refute_equal 0, ex.status, "--digest without a service must NOT promote the fleet"
        combined = out + err
        assert_match(/--digest.*requires.*service|--digest.*without.*service|service.*required.*--digest/i,
            combined, "must surface a clear error explaining --digest needs a positional service")
        # And it must NOT have issued any pin mutations.
        assert_empty gql.pinned_services, "no pin mutations should run on the fail-fast path"
    end

    # ── (d) Unknown positional service → fail fast with valid names. ──────

    def test_unknown_positional_service_fails_with_valid_names_listed
        cmd = build_cmd(["this-service-does-not-exist"])
        ghcr = FakeGHCR.new
        gql  = FakeGQLBenign.new
        install_two_service_fixture(cmd, gql, ghcr)
        ex = nil
        out, err = capture_io { ex = assert_raises(SystemExit) { cmd.run } }
        refute_equal 0, ex.status, "unknown service must fail, not silently no-op or fall through to fleet"
        combined = out + err
        assert_match(/unknown.*service|not.*known|invalid.*service/i, combined)
        # The error must list at least one canonical staging name (e.g. aimock)
        # so the operator can self-correct.
        assert_match(/aimock/, combined,
            "valid-names enumeration must include canonical staging services")
        assert_empty gql.pinned_services, "no pin mutations on unknown-service error path"
    end

    # ── (e) No positional → preserve full-fleet behavior (regression). ────

    def test_no_positional_preserves_full_fleet_promote
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest"  => "sha256:NEW_AIMOCK",
            "ghcr.io/copilotkit/harness:latest" => "sha256:NEW_HARNESS",
        })
        cmd = build_cmd([])
        install_two_service_fixture(cmd, gql, ghcr)
        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }
        assert_equal 0, rc, "no-arg promote must keep working for operators; got out=#{out}"

        pinned_ids = gql.pinned_services.map(&:first).sort
        assert_equal ["prod-aimock", "prod-harness"], pinned_ids,
            "no-arg promote must continue to pin the whole fleet"
    end

    # ── Parser-level coverage for --digest flag and positional acceptance. ─

    def test_parser_accepts_digest_flag
        c = Railway::PromoteCommand.new(["--digest", "ghcr.io/copilotkit/x@sha256:abc"])
        # Must NOT raise InvalidOption.
        c.parser.parse!(c.argv)
        assert_equal "ghcr.io/copilotkit/x@sha256:abc", c.options[:digest]
    end

    def test_parser_leaves_positional_in_argv
        c = Railway::PromoteCommand.new(["aimock", "--yes"])
        c.parser.parse!(c.argv)
        # OptionParser#parse! consumes known flags; the positional must remain.
        assert_includes c.argv, "aimock"
        assert c.options[:yes]
    end
end
