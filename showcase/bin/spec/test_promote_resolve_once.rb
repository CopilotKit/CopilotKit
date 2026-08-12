# frozen_string_literal: true

require_relative "spec_helper"

# Covers five CR fixes against PromoteCommand:
#   FIX-1: digest is resolved EXACTLY ONCE per staging service across the
#          whole preflight+execute, and the SAME ref P1 verified is what
#          gets pinned by execute_promotion (no TOCTOU).
#   FIX-2: a Railway::GHCR::Error raised mid-loop in P1 produces a per-
#          service REFUSE finding and the loop continues for remaining
#          services — earlier findings are NOT discarded.
#   FIX-3: pin_and_verify asserts the serviceInstanceDeployV2 result is a
#          non-empty deployment id (symmetric with the serviceInstanceUpdate
#          result check).
#   FIX-4: P2 emits a WARN finding when deployment meta is not a Hash, so
#          the silent skip of the in-flight race-check is visible.
#   FIX-5: when pin_and_verify raises mid-loop in execute_promotion, a
#          loud PARTIAL-PROMOTION report names the already-pinned services.
class PromoteResolveOnceTest < Minitest::Test
    # FakeGHCR that counts resolve_digest calls per ref.
    class CountingGHCR
        attr_reader :resolve_calls

        def initialize(resolve_map:, exists_set: nil)
            @resolve_map   = resolve_map
            @exists_set    = exists_set
            @resolve_calls = Hash.new(0)
        end

        def resolve_digest(ref)
            @resolve_calls[ref] += 1
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @resolve_map[ref]
        end

        def manifest_exists(ref)
            return :missing if @exists_set && !@exists_set.include?(ref)
            :exists
        end

        def parse_image_ref(ref)
            Railway::GHCR.allocate.parse_image_ref(ref)
        end
    end

    # GQL fake reusing the pattern from PromoteExecuteTest::RecordingGQL,
    # but with optional knobs for FIX-3 (redeploy returns false) and FIX-5
    # (per-service update failure).
    class RecordingGQL
        def initialize(redeploy_result: true, update_fail_for: nil)
            @calls            = []
            # Per-service post-update state so multi-service test cases don't
            # leak each other's pinned image into pre-update rechecks. Keyed by
            # serviceId. Value is { image:, post_ts: }. Pre-update returns the
            # "OLD" snapshot (with an early ts) for any service not yet pinned.
            @post            = {}
            @ts_counter      = 0
            @redeploy_result = redeploy_result
            @update_fail_for = update_fail_for  # service_id whose update returns false
        end
        attr_reader :calls

        def query(q, vars = {})
            @calls << [q, vars]
            sid = vars[:serviceId]
            if q.include?("serviceInstanceUpdate")
                if @update_fail_for && sid == @update_fail_for
                    return { "serviceInstanceUpdate" => false }
                end
                @ts_counter += 1
                @post[sid] = { image: vars.dig(:input, :source, :image), ts: "2026-05-29T00:00:%02dZ" % @ts_counter }
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                # @redeploy_result false → return nil id so the DeployV2 guard
                # fails loud (mirrors the prior redeploy-false fail path).
                { "serviceInstanceDeployV2" => (@redeploy_result ? "dep-#{sid}" : nil) }
            elsif q.include?("ServiceInstanceRecheck")
                if (entry = @post[sid])
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => entry[:image] },
                            "updatedAt" => entry[:ts],
                            "latestDeployment" => {
                                "id" => "dep-#{sid}", "status" => "SUCCESS",
                                "meta" => {
                                    "imageDigest" => (entry[:image].include?("@") ? entry[:image].split("@", 2).last : nil),
                                },
                            },
                        },
                    }
                else
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" },
                            "updatedAt" => "2026-05-28T00:00:00Z",
                        },
                    }
                end
            else
                {}
            end
        end

        def pinned_images
            @calls.select { |q, _| q.include?("serviceInstanceUpdate") }.map { |_, v| v.dig(:input, :source, :image) }
        end
    end

    # Silence pin_and_verify's 10s-per-retry waits.
    def with_fast_sleeper
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0)
        yield
    ensure
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original)
    end

    def make_svc(name, image:)
        {
            "name" => name, "service_id" => "svc-stg-#{name}",
            "image" => image,
            # All CRITICAL_ENV_KEYS present so the (now unconditional) critical
            # env-key presence assertion does not fire — these tests isolate
            # the resolve-once / pin behavior, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def make_prod_svc(name)
        {
            "name" => name, "service_id" => "svc-prod-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}@sha256:OLD",
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    # =================== FIX-1 ===================

    def test_fix1_resolve_digest_called_exactly_once_per_service
        # Single :latest staging service. After full preflight + execute, the
        # ghcr.resolve_digest call counter MUST be exactly 1 for that ref —
        # not 2 (which was the pre-fix TOCTOU duplicate-resolve behavior).
        ghcr = CountingGHCR.new(resolve_map: { "ghcr.io/copilotkit/x:latest" => "sha256:abc123" })
        gql  = RecordingGQL.new

        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes", "--confirm-divergence"])
        cmd.parser.parse!(cmd.argv)
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [make_svc("x", image: "ghcr.io/copilotkit/x:latest")],
        })
        cmd.instance_variable_set(:@prod_snapshot, { "services" => [make_prod_svc("x")] })
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, ghcr)
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc123" } }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }

        out, _ = with_fast_sleeper { capture_io { @rc = cmd.run_with_preflight_only } }
        assert_equal 0, @rc, "promote should succeed; got out=#{out}"

        # The exact ref pinned MUST be what P1 verified (resolve-once).
        assert_equal ["ghcr.io/copilotkit/x@sha256:abc123"], gql.pinned_images,
            "must pin the SAME digest-form ref P1 verified"

        # The :latest tag must have been resolved EXACTLY ONCE — not twice.
        assert_equal 1, ghcr.resolve_calls["ghcr.io/copilotkit/x:latest"],
            "resolve_digest must be called exactly once for the staging tag; calls=#{ghcr.resolve_calls.inspect}"
    end

    # =================== FIX-2 ===================

    # GHCR fake whose manifest_exists raises Railway::GHCR::Error on the
    # SECOND service. The first service's findings must survive.
    class RaisingOnSecondGHCR
        def initialize
            @manifest_calls = 0
        end

        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            "sha256:resolved_for_#{ref}"
        end

        def manifest_exists(_ref)
            @manifest_calls += 1
            raise Railway::GHCR::Error, "boom on call ##{@manifest_calls}" if @manifest_calls == 2
            :exists
        end

        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def test_fix2_p1_rescue_is_per_service_not_method_level
        # Two services. The SECOND triggers a GHCR::Error in manifest_exists.
        # Before the fix: method-level rescue replaced ALL findings with a
        # single "REFUSE: P1: GHCR check raised ..." entry, dropping the
        # first service's clean record AND scoping the error to "P1" with no
        # service name. After the fix: the first service has no finding
        # (it passed), the second service has a per-service REFUSE finding
        # that names the service.
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, RaisingOnSecondGHCR.new)
        # resolved_prod_image now pins staging's RUNNING digest (meta.imageDigest);
        # stub the deployment lookup so the flow reaches manifest_exists (which
        # raises on the 2nd service under test).
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |svc_id|
            name = svc_id.sub("svc-stg-", "")
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/#{name}:latest",
                           "imageDigest" => "sha256:running_#{name}" } }]
        end
        staging = {
            "services" => [
                make_svc("a", image: "ghcr.io/copilotkit/a:latest"),
                make_svc("b", image: "ghcr.io/copilotkit/b:latest"),
            ],
        }
        findings = cmd.send(:check_p1_ghcr_digests, staging)

        refute(findings.any? { |f| f =~ /REFUSE: P1 \(a\)/ },
            "service 'a' passed P1 and must have no REFUSE; findings=#{findings.inspect}")
        assert(findings.any? { |f| f =~ /REFUSE: P1 \(b\).*boom on call #2/ },
            "service 'b' must have a per-service P1 REFUSE naming it; findings=#{findings.inspect}")
    end

    # =================== FIX-3 ===================

    def test_fix3_pin_and_verify_raises_when_deploy_returns_no_id
        gql = RecordingGQL.new(redeploy_result: false)
        err = assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "svc-x", env_id: "env-prod",
                image: "ghcr.io/copilotkit/x@sha256:abc",
                sleeper: ->(_) {})
        end
        assert_match(/serviceInstanceDeployV2/i, err.message,
            "MutationError must reference the deploy mutation; got: #{err.message}")
    end

    # =================== FIX-4 ===================

    def test_fix4_p2_warns_when_meta_is_a_string
        # P2 already guards meta.is_a?(Hash) (no crash), but the silent skip
        # of the race-check should produce a WARN finding so it's visible.
        cmd = Railway::PromoteCommand.new([])
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => "raw-string-not-a-hash" }]
        end
        staging = {
            "services" => [{
                "name" => "x", "service_id" => "svc-1",
                "image" => "ghcr.io/copilotkit/x@sha256:abc", "digest" => "sha256:abc",
                "env_keys" => [],
            }],
        }
        findings = cmd.send(:check_p2_staging_deployments, staging)
        assert(findings.any? { |f| f =~ /WARN: P2 \(x\).*meta.*String.*Hash/ },
            "expected WARN finding for non-Hash meta; got: #{findings.inspect}")
    end

    # =================== FIX-5 ===================

    def test_fix5_partial_promotion_report_on_midloop_failure
        # Three staging services [a, b, c]; pin succeeds for a and b, fails
        # for c (serviceInstanceUpdate returns false → MutationError).
        # The output must name a and b as already-pinned and c as failed.
        ghcr = CountingGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/a:latest" => "sha256:aaa",
            "ghcr.io/copilotkit/b:latest" => "sha256:bbb",
            "ghcr.io/copilotkit/c:latest" => "sha256:ccc",
        })
        gql = RecordingGQL.new(update_fail_for: "svc-prod-c")

        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes", "--confirm-divergence"])
        cmd.parser.parse!(cmd.argv)
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [
                make_svc("a", image: "ghcr.io/copilotkit/a:latest"),
                make_svc("b", image: "ghcr.io/copilotkit/b:latest"),
                make_svc("c", image: "ghcr.io/copilotkit/c:latest"),
            ],
        })
        cmd.instance_variable_set(:@prod_snapshot, {
            "services" => [make_prod_svc("a"), make_prod_svc("b"), make_prod_svc("c")],
        })
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, ghcr)
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |svc_id|
            svc = svc_id.sub("svc-stg-", "")
            digest = { "a" => "sha256:aaa", "b" => "sha256:bbb", "c" => "sha256:ccc" }.fetch(svc)
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/#{svc}@#{digest}" } }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }

        out, err = with_fast_sleeper { capture_io { @rc = cmd.run_with_preflight_only } }
        assert_equal 1, @rc, "execute_promotion must return 1 when a mid-loop pin fails"
        combined = out + err
        assert_match(/PARTIAL PROMOTION/i, combined,
            "must emit a loud PARTIAL PROMOTION report; output=#{combined}")
        assert_match(/already pinned.*\ba\b.*\bb\b/m, combined,
            "report must name the already-pinned services a and b; output=#{combined}")
        assert_match(/FAILED on c/, combined,
            "report must name the failing service c; output=#{combined}")
    end
end
