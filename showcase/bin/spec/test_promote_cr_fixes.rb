# frozen_string_literal: true

require_relative "spec_helper"

# Covers nine CR fixes against PromoteCommand:
#   FIX-1: @promote_refs is RESET per check_p1_ghcr_digests run (not memoized
#          across A→B preflight invocations), and execute_promotion HARD-GUARDS
#          against a nil @promote_refs.
#   FIX-2: P2 in-flight race compares deployed_digest vs the digest portion of
#          @promote_refs[name] (not the snapshot's tag-form nil `digest`).
#          Also: JSON-string `meta` is parsed (not WARN-skipped); and
#          fetch_latest_staging_deployments sorts createdAt-desc so `.first`
#          is genuinely latest.
#   FIX-3: execute_promotion pre-validates ALL prod-matched services have a
#          digest-shaped @promote_refs entry BEFORE pinning anything.
#   FIX-4: execute_promotion rescue broadens to MutationError + GraphQL::Error
#          + StandardError, retains PARTIAL-PROMOTION report, and drops the
#          duplicate `warn e.message`.
#   FIX-5: check_p1_ghcr_digests emits REFUSE: P1 ... "no image" when staging
#          service has nil/empty image (instead of silent skip).
#   FIX-6: P1 per-service rescue broadens to StandardError so non-GHCR errors
#          don't bypass the loop.
#   FIX-7: pin_and_verify raises ArgumentError immediately when called with a
#          tag-form (non-digest) image.
#   FIX-8: pin_and_verify timestamp gate is non-vacuous: a nil observed
#          updatedAt does NOT declare success, even when pre_update_ts is nil.
#   FIX-9: run_staging_probe rescues launch failures (Errno::ENOENT, etc.)
#          and returns ok:false with a descriptive summary.
class PromoteCRFixesTest < Minitest::Test
    # ----- shared fakes -----

    class NullGQL
        def query(*); {}; end
    end

    # GQL that records calls and returns canned responses for P2/preflight only
    # (no mutations).
    class P2GQL
        attr_reader :calls
        def initialize(deployments_by_svc)
            @deployments_by_svc = deployments_by_svc
            @calls = []
        end
        def query(q, vars = {})
            @calls << [q, vars]
            if q.include?("query Deployments")
                edges = (@deployments_by_svc[vars[:serviceId]] || []).map { |n| { "node" => n } }
                return { "deployments" => { "edges" => edges } }
            end
            {}
        end
    end

    # GHCR fake that always reports :exists and resolves any :latest -> a digest.
    class PassGHCR
        def initialize(resolve_map: {}); @resolve_map = resolve_map; end
        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @resolve_map[ref] || "sha256:resolved_for_#{ref}"
        end
        def manifest_exists(_); :exists; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def make_svc(name, image:)
        {
            "name" => name, "service_id" => "svc-stg-#{name}",
            "image" => image,
            "env_keys" => [],
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    # =================== FIX-1: @promote_refs is reset, not memoized ===================

    def test_fix1_promote_refs_resets_between_p1_runs
        # Reuse a single PromoteCommand instance across two distinct snapshots
        # (snapshot A and snapshot B). After the second P1 run, @promote_refs
        # must reflect ONLY snapshot B's services — no stale A entries.
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, PassGHCR.new)
        # resolved_prod_image now pins staging's RUNNING digest (meta.imageDigest
        # from the latest SUCCESS deployment), not resolve_digest(:latest). Stub
        # the deployment lookup so a digest is resolvable for each tag-form svc.
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |svc_id|
            name = svc_id.sub("svc-stg-", "")
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/#{name}:latest",
                           "imageDigest" => "sha256:running_#{name}" } }]
        end

        snapshot_a = { "services" => [make_svc("alpha", image: "ghcr.io/copilotkit/alpha:latest")] }
        snapshot_b = { "services" => [make_svc("beta",  image: "ghcr.io/copilotkit/beta:latest")] }

        cmd.send(:check_p1_ghcr_digests, snapshot_a)
        refs_after_a = cmd.instance_variable_get(:@promote_refs).keys.sort
        assert_equal ["alpha"], refs_after_a

        cmd.send(:check_p1_ghcr_digests, snapshot_b)
        refs_after_b = cmd.instance_variable_get(:@promote_refs).keys.sort
        assert_equal ["beta"], refs_after_b,
            "stale entries from snapshot A must be cleared; got #{refs_after_b.inspect}"
    end

    def test_fix1_execute_promotion_raises_when_promote_refs_nil
        # execute_promotion called WITHOUT a prior preflight must raise an
        # internal-error exception (not silently treat refs as empty).
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, PassGHCR.new)
        # Deliberately do NOT call check_p1_ghcr_digests; @promote_refs stays nil.
        staging = { "services" => [make_svc("x", image: "ghcr.io/copilotkit/x:latest")] }
        prod    = { "services" => [{ "name" => "x", "service_id" => "svc-prod-x",
                                     "image" => "ghcr.io/copilotkit/x@sha256:OLD" }] }
        err = assert_raises(RuntimeError) do
            cmd.send(:execute_promotion, staging, prod)
        end
        assert_match(/internal error.*execute_promotion.*preflight/i, err.message)
    end

    # =================== FIX-2: P2 race-check is alive ===================

    def test_fix2_p2_race_check_uses_promote_refs_not_snapshot_digest
        # Staging service is tag-form (so svc["digest"] is nil — pre-fix the
        # race-check was DEAD CODE). After fix: P2 compares against the digest
        # captured in @promote_refs[name].
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@promote_refs, {
            "x" => "ghcr.io/copilotkit/x@sha256:YYY",
        })
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            [{ "id" => "d1", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:XXX" },
               "createdAt" => "2026-05-28T01:00:00Z" }]
        end
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x:latest",  # tag-form; no "digest"
            "env_keys" => [],
        }] }
        findings = cmd.send(:check_p2_staging_deployments, staging)
        assert(findings.any? { |f| f =~ /REFUSE: P2 \(x\).*in-flight.*sha256:XXX.*sha256:YYY/ },
            "expected REFUSE: P2 comparing deployed XXX vs P1-resolved YYY; got: #{findings.inspect}")
    end

    def test_fix2_p2_parses_meta_when_it_is_a_json_string
        # Some Railway responses deserialize Deployment.meta as a JSON String
        # (not a Hash). P2 must parse it before falling back to the WARN branch.
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@promote_refs, {
            "x" => "ghcr.io/copilotkit/x@sha256:abc",
        })
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            [{ "id" => "d1", "status" => "SUCCESS",
               "meta" => '{"image":"ghcr.io/copilotkit/x@sha256:abc"}',
               "createdAt" => "2026-05-28T01:00:00Z" }]
        end
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x:latest",
            "env_keys" => [],
        }] }
        findings = cmd.send(:check_p2_staging_deployments, staging)
        refute(findings.any? { |f| f =~ /WARN: P2 \(x\)/ },
            "JSON-string meta must be parsed (not WARN-skipped); got: #{findings.inspect}")
        refute(findings.any? { |f| f =~ /REFUSE: P2/ },
            "matching digest in parsed meta must not REFUSE; got: #{findings.inspect}")
    end

    def test_fix2_fetch_latest_staging_deployments_sorts_newest_first
        # Stub gql.query to return deployments in OLDEST-first order — the
        # helper must sort by createdAt DESC so `.first` is the newest.
        cmd = Railway::PromoteCommand.new([])
        nodes = [
            { "id" => "d-old", "status" => "SUCCESS", "createdAt" => "2026-05-01T00:00:00Z" },
            { "id" => "d-new", "status" => "SUCCESS", "createdAt" => "2026-05-28T00:00:00Z" },
            { "id" => "d-mid", "status" => "FAILED",  "createdAt" => "2026-05-15T00:00:00Z" },
        ]
        edges = nodes.map { |n| { "node" => n } }
        fake_gql = Object.new
        fake_gql.define_singleton_method(:query) do |_q, _vars = {}|
            { "deployments" => { "edges" => edges } }
        end
        cmd.instance_variable_set(:@gql, fake_gql)
        deployments = cmd.send(:fetch_latest_staging_deployments, "svc-1")
        assert_equal "d-new", deployments.first["id"],
            "fetch_latest_staging_deployments must sort newest-first; got: #{deployments.map { |d| d['id'] }.inspect}"
    end

    # =================== FIX-3: execute_promotion pre-validation ===================

    def test_fix3_execute_promotion_pre_validates_all_refs_before_any_pin
        # Two prod-matched services; ONE missing from @promote_refs. The
        # pre-validation must REFUSE+return 1 BEFORE any serviceInstanceUpdate
        # mutation is issued.
        cmd = Railway::PromoteCommand.new([])
        recorded = []
        fake_gql = Object.new
        fake_gql.define_singleton_method(:query) do |q, vars = {}|
            recorded << [q, vars]
            { "serviceInstanceUpdate" => true, "serviceInstanceDeployV2" => "dep-new" }
        end
        cmd.instance_variable_set(:@gql, fake_gql)
        cmd.instance_variable_set(:@promote_refs, {
            "a" => "ghcr.io/copilotkit/a@sha256:aaa",
            # "b" is MISSING
        })
        staging = { "services" => [make_svc("a", image: "ghcr.io/copilotkit/a:latest"),
                                   make_svc("b", image: "ghcr.io/copilotkit/b:latest")] }
        prod = { "services" => [
            { "name" => "a", "service_id" => "svc-prod-a", "image" => "ghcr.io/copilotkit/a@sha256:OLD" },
            { "name" => "b", "service_id" => "svc-prod-b", "image" => "ghcr.io/copilotkit/b@sha256:OLD" },
        ] }
        _out, _err = capture_io { @rc = cmd.send(:execute_promotion, staging, prod) }
        assert_equal 1, @rc, "execute_promotion must return 1 when a ref is missing"
        assert(recorded.none? { |q, _| q.include?("serviceInstanceUpdate") },
            "no serviceInstanceUpdate mutations should be issued; got: #{recorded.map { |q, _| q[0, 30] }.inspect}")
    end

    # =================== FIX-4: broadened rescue + partial-promotion report ===================

    def test_fix4_execute_promotion_rescues_graphql_error_with_partial_report
        # First service pins successfully; second raises Railway::GraphQL::Error
        # on its serviceInstanceUpdate mutation. The broadened rescue must
        # catch it and still emit the PARTIAL-PROMOTION report.
        cmd = Railway::PromoteCommand.new([])
        call_count = 0
        # FakeGQL that records calls and raises GraphQL::Error on the SECOND
        # serviceInstanceUpdate mutation.
        fake_gql = Object.new
        @pinned = nil
        @pre_ts = "2026-05-28T00:00:00Z"
        pinned_ref = nil
        fake_gql.define_singleton_method(:query) do |q, vars = {}|
            if q.include?("serviceInstanceUpdate")
                call_count += 1
                raise Railway::GraphQL::Error, "boom on update #2" if call_count == 2
                pinned_ref = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                { "serviceInstanceDeployV2" => "dep-new" }
            elsif q.include?("ServiceInstanceRecheck")
                if pinned_ref
                    { "serviceInstance" => { "id" => "i",
                                              "source" => { "image" => pinned_ref },
                                              "updatedAt" => "2026-05-29T00:00:01Z",
                                              "latestDeployment" => {
                                                  "id" => "dep-new", "status" => "SUCCESS",
                                                  "meta" => { "imageDigest" => (pinned_ref.include?("@") ? pinned_ref.split("@", 2).last : nil) },
                                              } } }
                else
                    { "serviceInstance" => { "id" => "i",
                                              "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" },
                                              "updatedAt" => "2026-05-28T00:00:00Z" } }
                end
            else
                {}
            end
        end
        cmd.instance_variable_set(:@gql, fake_gql)
        cmd.instance_variable_set(:@promote_refs, {
            "a" => "ghcr.io/copilotkit/a@sha256:aaa",
            "b" => "ghcr.io/copilotkit/b@sha256:bbb",
        })
        # Silence pin_and_verify retries.
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0)
        begin
            staging = { "services" => [make_svc("a", image: "ghcr.io/copilotkit/a:latest"),
                                       make_svc("b", image: "ghcr.io/copilotkit/b:latest")] }
            prod = { "services" => [
                { "name" => "a", "service_id" => "svc-prod-a", "image" => "ghcr.io/copilotkit/a@sha256:OLD" },
                { "name" => "b", "service_id" => "svc-prod-b", "image" => "ghcr.io/copilotkit/b@sha256:OLD" },
            ] }
            out, err = capture_io { @rc = cmd.send(:execute_promotion, staging, prod) }
            combined = out + err
            assert_equal 1, @rc
            assert_match(/PARTIAL PROMOTION/i, combined,
                "must emit partial-promotion report on GraphQL::Error; combined=#{combined}")
            assert_match(/already pinned.*\ba\b/m, combined,
                "report must name 'a' as already-pinned; combined=#{combined}")
            assert_match(/FAILED on b/, combined,
                "report must name 'b' as failed; combined=#{combined}")
            # Dedup check: the inner e.message should appear ONLY inside the
            # composed PARTIAL-PROMOTION line, not on its own line as well.
            assert_equal 1, combined.scan(/boom on update #2/).size,
                "duplicate `warn e.message` line must be removed; combined=#{combined}"
        ensure
            Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
            Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original)
        end
    end

    # =================== FIX-5: P1 REFUSE on imageless service ===================

    def test_fix5_p1_refuses_when_staging_service_has_no_image
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, PassGHCR.new)
        staging = { "services" => [
            { "name" => "x", "service_id" => "svc-1", "image" => nil,
              "env_keys" => [] },
        ] }
        findings = cmd.send(:check_p1_ghcr_digests, staging)
        assert(findings.any? { |f| f =~ /REFUSE: P1 \(x\).*no image/i },
            "expected REFUSE: P1 (x) about missing image; got: #{findings.inspect}")
    end

    # =================== FIX-6: P1 per-service rescue broadens to StandardError ===================

    class ArgumentErrorGHCR
        def resolve_digest(_); "sha256:fake"; end
        def manifest_exists(_); raise ArgumentError, "non-ghcr error"; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def test_fix6_p1_rescue_catches_non_ghcr_errors
        # ArgumentError raised inside manifest_exists must be caught by the
        # per-service rescue (broadened to StandardError) — the loop must
        # continue and the service must get a per-service REFUSE.
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, ArgumentErrorGHCR.new)
        # Stub the running-digest lookup so resolved_prod_image succeeds and the
        # flow reaches manifest_exists (which raises the ArgumentError under test).
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |svc_id|
            name = svc_id.sub("svc-stg-", "")
            [{ "id" => "d", "status" => "SUCCESS",
               "meta" => { "image" => "ghcr.io/copilotkit/#{name}:latest",
                           "imageDigest" => "sha256:running_#{name}" } }]
        end
        staging = { "services" => [
            make_svc("a", image: "ghcr.io/copilotkit/a:latest"),
            make_svc("b", image: "ghcr.io/copilotkit/b:latest"),
        ] }
        findings = cmd.send(:check_p1_ghcr_digests, staging)
        # Two services, each one should fail with ArgumentError-bearing REFUSE.
        assert(findings.any? { |f| f =~ /REFUSE: P1 \(a\).*ArgumentError.*non-ghcr error/ },
            "service 'a' must record a per-service REFUSE for ArgumentError; got: #{findings.inspect}")
        assert(findings.any? { |f| f =~ /REFUSE: P1 \(b\).*ArgumentError.*non-ghcr error/ },
            "service 'b' must record a per-service REFUSE for ArgumentError; got: #{findings.inspect}")
    end

    # =================== FIX-7: pin_and_verify upfront digest guard ===================

    def test_fix7_pin_and_verify_raises_arg_error_on_tag_form_image
        # Pre-fix: pin_and_verify would dutifully attempt N retries before
        # raising a misleading MutationError. After fix: ArgumentError fires
        # immediately, no retries.
        gql = Object.new
        gql.define_singleton_method(:query) { |*| raise "no query should be issued" }
        err = assert_raises(ArgumentError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "svc-x", env_id: "env-prod",
                image: "ghcr.io/copilotkit/x:latest",
                sleeper: ->(_) {})
        end
        assert_match(/pin_and_verify.*@sha256.*pinned/i, err.message,
            "ArgumentError message must explain the digest requirement; got: #{err.message}")
    end

    # =================== FIX-8: pin_and_verify ts gate is non-vacuous ===================

    def test_fix8_pin_and_verify_requires_non_nil_updated_at_even_when_pre_ts_nil
        # pre_update_ts is nil (new prod instance). Recheck returns matching
        # digest but a nil updatedAt. Pre-fix: ts_ok was vacuously true → success.
        # After fix: ts_ok requires actual_ts to be non-nil → kept retrying →
        # MutationError after RETRY_COUNT attempts.
        gql = Object.new
        pinned = nil
        gql.define_singleton_method(:query) do |q, vars = {}|
            if q.include?("serviceInstanceUpdate")
                pinned = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                { "serviceInstanceDeployV2" => "dep-new" }
            elsif q.include?("ServiceInstanceRecheck")
                if pinned.nil?
                    # Pre-update: brand-new instance — both fields are nil.
                    { "serviceInstance" => nil }
                else
                    { "serviceInstance" => { "id" => "i",
                                              "source" => { "image" => pinned },
                                              "updatedAt" => nil } }
                end
            else
                {}
            end
        end
        err = assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "svc-x", env_id: "env-prod",
                image: "ghcr.io/copilotkit/x@sha256:abc",
                sleeper: ->(_) {})
        end
        assert_match(/did not observe image advance/i, err.message,
            "expected timeout-style MutationError; got: #{err.message}")
    end

    # =================== FIX-9: run_staging_probe rescue on launch failure ===================

    def test_fix9_run_staging_probe_returns_clean_failure_on_io_popen_error
        cmd = Railway::PromoteCommand.new([])
        # The probe binary must APPEAR present so we reach the IO.popen call.
        # (Skip the File.exist? early-return.)
        original_exist = File.method(:exist?)
        File.define_singleton_method(:exist?) { |_path| true }
        # Stub IO.popen to raise Errno::ENOENT (npx missing on PATH).
        original_popen = IO.method(:popen)
        IO.define_singleton_method(:popen) do |*_args, **_kw, &_blk|
            raise Errno::ENOENT, "npx"
        end
        begin
            result = cmd.send(:run_staging_probe, services: ["x"])
            assert_equal false, result[:ok], "must return ok:false on launch failure"
            assert_match(/staging probe failed to launch.*ENOENT/i, result[:summary],
                "summary must describe the launch failure; got: #{result[:summary].inspect}")
        ensure
            IO.define_singleton_method(:popen, &original_popen)
            File.define_singleton_method(:exist?, &original_exist)
        end
    end
end
