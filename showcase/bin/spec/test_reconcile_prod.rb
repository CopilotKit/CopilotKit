# frozen_string_literal: true

require_relative "spec_helper"

# Covers `bin/railway reconcile-prod` — the prod-vs-staging drift comparator
# (Lever 1 of the promote-reliability hardening plan).
#
# Contract: for every prod-eligible (`probe.prod == true`) service, compare the
# prod SERVING digest (the immutable `@sha256:` prod is pinned to) against the
# staging RUNNING digest (staging's latest SUCCESS deployment's
# meta.imageDigest — the same source PromoteCommand#staging_running_digest
# reads). Classify each service:
#
#   green  — prod digest == staging running digest (in sync).
#   stale  — prod digest != staging running digest AND staging IS resolvable
#            (prod has drifted behind a green staging — the thing we alert on).
#   gray   — staging running digest not resolvable (no SUCCESS deploy / no
#            imageDigest) — informational, NOT stale (we can't prove drift).
#
# Exit code contract (the whole point of the gate):
#   exit 0  — no `stale` services (all green, or only green+gray).
#   exit 1  — at least one `stale` service (prod drifted behind green staging).
#
# Read-only: NO promotes / mutations. --json emits machine output.
#
# The test injects fakes the same way the promote suite does
# (test_promote_staging_running_digest.rb): instance_variable_set the prod +
# staging snapshots and a fake that resolves the staging running digest.
class ReconcileProdTest < Minitest::Test
    # Build a ReconcileProdCommand with injected prod + staging snapshots and a
    # per-service staging-running-digest map (sid => "sha256:..." or nil).
    #
    # `eligible` is the list of SSOT-eligible service descriptors the command
    # iterates: each is { "name" =>, "service_id" => }. We inject it directly so
    # the test does not depend on the real generated SSOT JSON.
    def make_cmd(eligible:, prod_services:, running_by_sid:, argv: [])
        cmd = Railway::ReconcileProdCommand.new(argv)
        cmd.parser.parse!(cmd.argv)
        # Inject the prod snapshot the comparator reads (LintProd path).
        cmd.define_singleton_method(:build_prod_snapshot) do
            { "services" => prod_services }
        end
        # Inject the prod-eligible service set (normally derived from the SSOT
        # generated.json by probe.prod == true).
        cmd.define_singleton_method(:eligible_services) { eligible }
        # Inject the staging running digest lookup (normally
        # PromoteCommand#staging_running_digest reading Railway deployments).
        cmd.define_singleton_method(:staging_running_digest_for) do |svc|
            running_by_sid[svc["service_id"]]
        end
        cmd
    end

    PROD = lambda do |name, sid, digest|
        # A prod snapshot service is pinned to an immutable digest:
        # image = ghcr.io/org/name@sha256:..., digest = sha256:...
        {
            "name"       => name,
            "service_id" => sid,
            "image"      => "ghcr.io/copilotkit/#{name}@#{digest}",
            "digest"     => digest,
        }
    end

    ELIG = lambda do |name, sid|
        { "name" => name, "service_id" => sid }
    end

    # ===================== RED-anchor: STALE => exit 1 ========================
    # Prod is pinned to digest A; staging is RUNNING green digest B. prod !=
    # staging-green => STALE. The comparator MUST classify it stale and exit 1.
    def test_stale_when_prod_differs_from_green_staging
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111")],
            running_by_sid: { "sid-shell" => "sha256:bbbb2222" }, # green staging, DIFFERENT
        )
        rows = cmd.classify_all
        row = rows.find { |r| r["name"] == "shell" }
        assert_equal "stale", row["status"],
            "prod digest != staging green digest must classify STALE"
        assert_equal 1, cmd.run_classification(rows),
            "any stale service must exit non-zero (1)"
    end

    # ===================== GREEN => exit 0 ====================================
    def test_green_when_prod_matches_staging
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell"),
                             ELIG.call("docs", "sid-docs")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111"),
                             PROD.call("docs", "sid-docs", "sha256:cccc3333")],
            running_by_sid: { "sid-shell" => "sha256:aaaa1111",
                              "sid-docs"  => "sha256:cccc3333" },
        )
        rows = cmd.classify_all
        assert(rows.all? { |r| r["status"] == "green" },
            "all matching => all green, got #{rows.map { |r| r['status'] }.inspect}")
        assert_equal 0, cmd.run_classification(rows),
            "no stale service => exit 0"
    end

    # ===================== GRAY (staging not green) => exit 0 =================
    # Staging has no resolvable running digest (nil). That is NOT drift we can
    # prove — classify gray (informational), NOT stale. Must NOT red the run.
    def test_gray_when_staging_not_resolvable
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111")],
            running_by_sid: { "sid-shell" => nil }, # staging not green/resolvable
        )
        rows = cmd.classify_all
        row = rows.find { |r| r["name"] == "shell" }
        assert_equal "gray", row["status"],
            "unresolvable staging digest must be gray, not stale"
        assert_equal 0, cmd.run_classification(rows),
            "gray (not stale) must NOT red the run"
    end

    # ===================== mixed: one stale among green/gray => exit 1 ========
    def test_mixed_with_one_stale_exits_nonzero
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell"),
                             ELIG.call("docs", "sid-docs"),
                             ELIG.call("dojo", "sid-dojo")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111"),
                             PROD.call("docs", "sid-docs", "sha256:cccc3333"),
                             PROD.call("dojo", "sid-dojo", "sha256:dddd4444")],
            running_by_sid: { "sid-shell" => "sha256:aaaa1111",   # green
                              "sid-docs"  => "sha256:9999ffff",   # STALE
                              "sid-dojo"  => nil },                # gray
        )
        rows = cmd.classify_all
        by_name = rows.each_with_object({}) { |r, h| h[r["name"]] = r["status"] }
        assert_equal "green", by_name["shell"]
        assert_equal "stale", by_name["docs"]
        assert_equal "gray",  by_name["dojo"]
        assert_equal 1, cmd.run_classification(rows),
            "one stale among green/gray => exit 1"
    end

    # ===================== --json machine output =============================
    def test_json_output_shape
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111")],
            running_by_sid: { "sid-shell" => "sha256:bbbb2222" },
            argv:           ["--json"],
        )
        out, = capture_io { cmd.run }
        payload = JSON.parse(out)
        assert_equal 1, payload["stale"], "stale count surfaced in JSON"
        svc = payload["services"].find { |s| s["name"] == "shell" }
        assert_equal "stale", svc["status"]
        assert_equal "sha256:aaaa1111", svc["prod"]
        assert_equal "sha256:bbbb2222", svc["staging"]
    end

    # ===================== run() end-to-end exit code =========================
    def test_run_exits_nonzero_on_stale
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111")],
            running_by_sid: { "sid-shell" => "sha256:bbbb2222" },
        )
        rc = nil
        capture_io { rc = cmd.run }
        assert_equal 1, rc, "run() must exit 1 when a service is stale"
    end

    def test_run_exits_zero_when_all_green
        cmd = make_cmd(
            eligible:       [ELIG.call("shell", "sid-shell")],
            prod_services:  [PROD.call("shell", "sid-shell", "sha256:aaaa1111")],
            running_by_sid: { "sid-shell" => "sha256:aaaa1111" },
        )
        rc = nil
        capture_io { rc = cmd.run }
        assert_equal 0, rc, "run() must exit 0 when all services green"
    end

    # ===================== prod service missing from snapshot =================
    # A prod-eligible service that has NO prod snapshot entry (never deployed to
    # prod) has no prod digest to compare. It must NOT be classified stale
    # (we can't prove drift) — classify gray (informational).
    def test_missing_prod_service_is_gray_not_stale
        cmd = make_cmd(
            eligible:       [ELIG.call("newsvc", "sid-new")],
            prod_services:  [], # newsvc not in prod yet
            running_by_sid: { "sid-new" => "sha256:bbbb2222" },
        )
        rows = cmd.classify_all
        row = rows.find { |r| r["name"] == "newsvc" }
        assert_equal "gray", row["status"],
            "prod-eligible service absent from prod snapshot must be gray, not stale"
        assert_equal 0, cmd.run_classification(rows)
    end

    # The dispatcher must register the subcommand.
    def test_subcommand_registered
        assert Railway::SUBCOMMANDS.key?("reconcile-prod"),
            "reconcile-prod must be registered in the dispatcher"
        assert_equal Railway::ReconcileProdCommand,
            Railway::SUBCOMMANDS["reconcile-prod"]
    end
end
