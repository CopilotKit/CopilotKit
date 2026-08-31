# frozen_string_literal: true

require_relative "spec_helper"

# execute_promotion must resolve any staging tag (e.g. ":latest") to its
# concrete GHCR digest and pin THAT to prod — never a mutable tag. This is
# the core invariant of the showcase deploy model (P6 enforces shape).
class PromoteExecuteTest < Minitest::Test
    # A FakeGQL that returns the most-recently-pinned image on recheck,
    # so pin_and_verify sees the advance. Records all calls for assertions.
    class RecordingGQL
        def initialize(pre_ts: "2026-05-28T00:00:00Z")
            @calls = []
            @pinned_image = nil
            @pre_ts = pre_ts
        end
        attr_reader :calls

        def query(q, vars = {})
            @calls << [q, vars]
            if q.include?("serviceInstanceUpdate")
                @pinned_image = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                # New deployment spawned; returns the new deployment id.
                { "serviceInstanceDeployV2" => "dep-new" }
            elsif q.include?("ServiceInstanceRecheck")
                if @pinned_image.nil?
                    # Pre-update snapshot.
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" },
                            "updatedAt" => @pre_ts,
                        },
                    }
                else
                    # Post-update: config advanced AND the new deployment
                    # (dep-new) has SUCCEEDED serving the pinned digest, so both
                    # the config recheck and the bug-#2 serving gate pass.
                    pinned_digest = @pinned_image.include?("@") ? @pinned_image.split("@", 2).last : nil
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => @pinned_image },
                            "updatedAt" => "2026-05-29T00:00:01Z",
                            "latestDeployment" => {
                                "id" => "dep-new", "status" => "SUCCESS",
                                "meta" => { "imageDigest" => pinned_digest },
                            },
                        },
                    }
                end
            else
                {}
            end
        end

        # Find the `image:` arg passed to the serviceInstanceUpdate mutation.
        def pinned_image
            row = @calls.find { |q, _| q.include?("serviceInstanceUpdate") }
            row && row[1].dig(:input, :source, :image)
        end
    end

    # FakeGHCR that maps tag-form refs to a digest, and reports :exists for
    # the corresponding digest-pinned ref so P1 passes.
    class FakeGHCR
        # `resolve_map` is { "ghcr.io/org/name:tag" => "sha256:abc..." } or nil for unresolvable.
        # `exists_set` is the set of digest-pinned refs that report :exists.
        def initialize(resolve_map: {}, exists_set: nil)
            @resolve_map = resolve_map
            @exists_set = exists_set
        end

        def resolve_digest(ref)
            # Pass-through for already-pinned refs.
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @resolve_map[ref]
        end

        def manifest_exists(ref)
            return :missing if @exists_set && !@exists_set.include?(ref)
            :exists
        end

        # Delegate to the real GHCR parser — pure function, no I/O.
        def parse_image_ref(ref)
            Railway::GHCR.allocate.parse_image_ref(ref)
        end
    end

    # Build a command with staging-tag service, snapshot the prod target, and
    # inject fakes. Returns [cmd, gql].
    def build_cmd(staging_image:, resolve_map:, exists_set: nil)
        # --confirm-divergence: retained as a harmless no-op (the only finding,
        # missing EXPECTED_DOMAINS, is now ADVISORY and never blocks); we are
        # testing pin behavior. All CRITICAL_ENV_KEYS present so the (now
        # unconditional) critical env-key presence assertion does not fire.
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes", "--confirm-divergence"])
        cmd.parser.parse!(cmd.argv)
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [{
                "name" => "x", "service_id" => "svc-staging",
                "image" => staging_image,
                "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
                "start_command" => "node server.js", "healthcheck_path" => "/health",
                "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            }],
        })
        cmd.instance_variable_set(:@prod_snapshot, {
            "services" => [{
                "name" => "x", "service_id" => "svc-prod",
                "image" => "ghcr.io/copilotkit/x@sha256:OLD",
                "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
                "start_command" => "node server.js", "healthcheck_path" => "/health",
                "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            }],
        })
        gql = RecordingGQL.new
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(resolve_map: resolve_map, exists_set: exists_set))
        # resolved_prod_image pins staging's RUNNING digest, sourced from the
        # latest SUCCESS deployment's meta.imageDigest (image-drift.ts mechanism).
        # Map the staging RUNNING digest from resolve_map (the test's notion of
        # the resolvable digest) or, for an already-digest-pinned staging image,
        # the embedded digest. When resolve_map is EMPTY *and* the image is
        # tag-only, the deployment carries NO imageDigest — modelling the
        # "no running digest resolvable" REFUSE path (replaces the old
        # "GHCR :latest unresolvable" REFUSE).
        running_digest = resolve_map.values.first ||
            (staging_image.include?("@") ? staging_image.split("@", 2).last : nil)
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |_svc_id|
            meta = { "image" => "ghcr.io/copilotkit/x:latest" }
            meta["imageDigest"] = running_digest if running_digest
            [{ "id" => "d", "status" => "SUCCESS", "meta" => meta }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
        [cmd, gql]
    end

    # Silence pin_and_verify's 10s-per-retry waits. RETRY_DELAY_SEC is a
    # constant on PromoteCommand; remap to 0 around the test body and restore.
    def with_fast_sleeper
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0)
        yield
    ensure
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original)
    end

    def test_resolves_staging_tag_to_digest_and_pins_digest_to_prod
        # (a) staging image is `:latest`; resolve_map maps it to a digest.
        cmd, gql = build_cmd(
            staging_image: "ghcr.io/copilotkit/x:latest",
            resolve_map:   { "ghcr.io/copilotkit/x:latest" => "sha256:abc123" },
        )
        out, _ = with_fast_sleeper { capture_io { @rc = cmd.run_with_preflight_only } }
        assert_equal 0, @rc, "promote should succeed when staging tag resolves cleanly; got out=#{out}"
        pinned = gql.pinned_image
        assert_equal "ghcr.io/copilotkit/x@sha256:abc123", pinned,
            "must pin the DIGEST-form ref, not the :latest tag; pinned=#{pinned.inspect}"
        refute_includes pinned.to_s, ":latest", "must not pin a mutable tag"
        assert_match(/promoted x -> ghcr\.io\/copilotkit\/x@sha256:abc123/, out)
    end

    def test_refuses_when_staging_tag_cannot_be_resolved_to_digest
        # (b) staging :latest that GHCR cannot resolve (resolve_digest returns nil)
        # → REFUSE; serviceInstanceUpdate is NEVER called.
        cmd, gql = build_cmd(
            staging_image: "ghcr.io/copilotkit/x:latest",
            resolve_map:   {}, # unresolvable
        )
        out, _ = with_fast_sleeper { capture_io { @rc = cmd.run_with_preflight_only } }
        assert_equal 1, @rc, "must refuse when staging tag is unresolvable"
        assert_match(/cannot resolve .*:latest.* GHCR digest/i, out)
        refuses_update = gql.calls.any? { |q, _| q.include?("serviceInstanceUpdate") }
        refute refuses_update, "must NOT call serviceInstanceUpdate when refusing on unresolvable tag"
    end

    def test_already_digest_pinned_staging_image_is_used_as_is
        # (c) Unit test of the resolved-prod-image helper. A staging service
        # whose image is already digest-pinned must be passed through unchanged
        # (no GHCR tag lookup needed, no rewrite). (This shape is irregular for
        # showcase staging — P6 would normally REFUSE staging != :tag — but the
        # helper itself must be safe and idempotent.)
        cmd = Railway::PromoteCommand.new([])
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(resolve_map: {}))
        svc = { "name" => "x", "image" => "ghcr.io/copilotkit/x@sha256:def456" }
        assert_equal "ghcr.io/copilotkit/x@sha256:def456",
            cmd.send(:resolved_prod_image, svc)
    end
end
