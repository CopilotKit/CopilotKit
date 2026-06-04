# frozen_string_literal: true

require_relative "spec_helper"

# EnvDiffCommand compares two env snapshots and reports drift. Historically it
# diffed digest, startCommand, and env-var KEY sets — but the banner also
# advertised "custom domains", which the diff loop never actually compared.
# These tests pin the custom-domain comparison so the banner is honest:
#
#   1. Identical custom_domains across both envs => no drift line.
#   2. Differing custom_domains => a drift line that names the service and the
#      offending domains, in both directions (missing-in-a / missing-in-b).
#
# We exercise the pure diff helper (diff_services) directly so the test does
# not need to stand up Railway GraphQL — the helper takes two already-built
# snapshots and returns the drift array.
class EnvDiffTest < Minitest::Test
    def snapshot_with(domains_a: [], domains_b: [])
        # Two single-service snapshots that agree on everything EXCEPT the
        # custom_domains set, so any drift surfaced is attributable to domains.
        snap_a = {
            "services" => [
                {
                    "name"           => "showcase-shell",
                    "digest"         => "sha256:abc",
                    "start_command"  => nil,
                    "env_keys"       => %w[PORT NODE_ENV],
                    "custom_domains" => domains_a,
                },
            ],
        }
        snap_b = {
            "services" => [
                {
                    "name"           => "showcase-shell",
                    "digest"         => "sha256:abc",
                    "start_command"  => nil,
                    "env_keys"       => %w[PORT NODE_ENV],
                    "custom_domains" => domains_b,
                },
            ],
        }
        [snap_a, snap_b]
    end

    def test_identical_custom_domains_no_drift
        snap_a, snap_b = snapshot_with(
            domains_a: ["shell.copilotkit.ai"],
            domains_b: ["shell.copilotkit.ai"],
        )
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        assert_empty drift
    end

    def test_differing_custom_domains_reported_both_directions
        snap_a, snap_b = snapshot_with(
            domains_a: ["only-in-staging.copilotkit.ai"],
            domains_b: ["only-in-prod.copilotkit.ai"],
        )
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")

        # One finding per direction, each naming the offending domain.
        missing_in_b = drift.find { |l| l.include?("custom domains missing in production") }
        missing_in_a = drift.find { |l| l.include?("custom domains missing in staging") }
        assert missing_in_b, "expected a 'missing in production' finding, got: #{drift.inspect}"
        assert missing_in_a, "expected a 'missing in staging' finding, got: #{drift.inspect}"
        assert_includes missing_in_b, "only-in-staging.copilotkit.ai"
        assert_includes missing_in_a, "only-in-prod.copilotkit.ai"
    end

    # A service that exists in one snapshot but not the other must surface a
    # "missing in <env>" drift line. This also exercises the missing-service
    # branch that was previously untested.
    def test_service_missing_in_one_env_reported
        snap_a = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT], "custom_domains" => [] },
                { "name" => "extra-svc", "digest" => "sha256:def",
                  "start_command" => nil, "env_keys" => %w[PORT], "custom_domains" => [] },
            ],
        }
        snap_b = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT], "custom_domains" => [] },
            ],
        }
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        missing = drift.find { |l| l.include?("extra-svc") && l.include?("missing in production") }
        assert missing, "expected 'extra-svc missing in production', got: #{drift.inspect}"
    end

    # A snapshot lacking a "services" key must not raise NoMethodError. NOTE:
    # because the missing "services" key makes find_service return nil for the
    # one service that exists only in snap_b, this case exercises ONLY the
    # top-level `["services"] || []` guard and the missing-service branch — it
    # `next`s before ever reaching the env_keys / custom_domains comparison.
    # The env_keys/custom_domains accessors are pinned separately below.
    def test_snapshot_without_services_key_does_not_crash
        snap_a = {} # no "services" key at all
        snap_b = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT], "custom_domains" => [] },
            ],
        }
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        missing = drift.find { |l| l.include?("showcase-shell") && l.include?("missing in staging") }
        assert missing, "expected 'showcase-shell missing in staging', got: #{drift.inspect}"
    end

    # A service present in BOTH snapshots where one side OMITS "env_keys"
    # (e.g. a v1/partial/hand-edited snapshot read from a git SHA) must not
    # raise NoMethodError. This genuinely reaches the env_keys comparison
    # branch (find_service returns the service on both sides, so the method
    # does NOT `next`). Without an `|| []` guard, `sa["env_keys"] - sb[...]`
    # raises `undefined method '-' for nil`.
    def test_service_without_env_keys_does_not_crash
        snap_a = {
            "services" => [
                # No "env_keys" key at all on this side.
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "custom_domains" => [] },
            ],
        }
        snap_b = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT NODE_ENV],
                  "custom_domains" => [] },
            ],
        }
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        # snap_a is missing both keys present in snap_b, so they must be
        # reported as "missing in staging" (the a-side env).
        missing_in_a = drift.find { |l| l.include?("env keys missing in staging") }
        assert missing_in_a, "expected an 'env keys missing in staging' finding, got: #{drift.inspect}"
        assert_includes missing_in_a, "PORT"
        assert_includes missing_in_a, "NODE_ENV"
    end

    # Symmetric to the env_keys case: a service present in BOTH snapshots where
    # one side OMITS "custom_domains" must not raise NoMethodError when the
    # other side has domains to diff against. Pins the custom_domains guard at
    # the comparison branch (not just the missing-service branch).
    def test_service_without_custom_domains_does_not_crash
        snap_a = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT] },
            ],
        }
        snap_b = {
            "services" => [
                { "name" => "showcase-shell", "digest" => "sha256:abc",
                  "start_command" => nil, "env_keys" => %w[PORT],
                  "custom_domains" => ["shell.copilotkit.ai"] },
            ],
        }
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        missing_in_a = drift.find { |l| l.include?("custom domains missing in staging") }
        assert missing_in_a, "expected a 'custom domains missing in staging' finding, got: #{drift.inspect}"
        assert_includes missing_in_a, "shell.copilotkit.ai"
    end
end
