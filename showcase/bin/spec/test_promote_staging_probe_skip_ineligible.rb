# frozen_string_literal: true

require_relative "spec_helper"

# Defect 2: the LOCAL bin/railway P3 staging-green precondition must pass
# --skip-ineligible to verify-deploy.ts so probe-ineligible services (e.g.
# harness-workers, probe.staging=false, domainless) are SKIPPED instead of
# hard-REFUSEd. This mirrors the already-merged CI fix (commit 160ba5a4aa:
# showcase_promote.yml passes --skip-ineligible). The local CLI path was missed.
#
# run_staging_probe shells out to verify-deploy.ts via IO.popen. This test
# drives the REAL method and intercepts the spawn to assert the constructed argv
# carries --skip-ineligible (the flag verify-deploy.ts keys on to skip, rather
# than crash on, probe:false services). Pre-fix: argv lacks the flag → RED.
# Post-fix: argv includes it → GREEN.
class PromoteStagingProbeSkipIneligibleTest < Minitest::Test
    def make_cmd
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        c.parser.parse!(c.argv)
        c
    end

    # Returns the argv array that run_staging_probe passes to IO.popen, captured
    # without launching a real subprocess.
    def captured_probe_argv(cmd, services:)
        captured = nil
        fake_io = Class.new { def read = "" }.new
        orig = IO.method(:popen)
        IO.define_singleton_method(:popen) do |_env, argv, *_rest, &blk|
            captured = argv
            result = blk ? blk.call(fake_io) : fake_io
            # run_staging_probe reads $?.exitstatus after the block; set it via a
            # trivial real subprocess so the method returns cleanly and the test
            # exercises the argv-construction path (not an incidental $? nil).
            system("true")
            result
        end
        begin
            cmd.send(:run_staging_probe, services: services)
        ensure
            IO.define_singleton_method(:popen, orig)
        end
        captured
    end

    def test_run_staging_probe_passes_skip_ineligible
        cmd = make_cmd
        argv = captured_probe_argv(cmd, services: ["harness-workers"])

        refute_nil argv, "expected run_staging_probe to spawn the verify-deploy probe"
        assert argv.any? { |a| a.to_s.end_with?("verify-deploy.ts") },
            "expected the verify-deploy.ts probe entrypoint in argv"
        assert_includes argv, "--skip-ineligible",
            "run_staging_probe must pass --skip-ineligible to verify-deploy.ts " \
            "(symmetric with the merged CI fix) so probe:false services like " \
            "harness-workers are SKIPPED, not REFUSEd"
        # Sanity: the env + services are still forwarded as before.
        assert_includes argv, "--env"
        assert_includes argv, "staging"
        assert_includes argv, "--services"
        assert_includes argv, "harness-workers"
    end
end
