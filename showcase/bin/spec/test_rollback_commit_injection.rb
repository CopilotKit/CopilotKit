# frozen_string_literal: true

require_relative "spec_helper"

# RollbackCommitCommand takes attacker-influenced operator input (--sha, --env)
# and used to interpolate both into shell strings (`git ls-tree ... #{sha}` and
# `git show #{sha}:#{path}`). A malformed --sha like "abc; touch /tmp/pwn"
# would be parsed by the shell. These tests pin the invariant:
#
#   1. Happy path: a valid hex --sha + known --env locates the snapshot via
#      IO.popen (argv form, no shell) and hands off to RestoreCommand.
#   2. Malformed --sha is rejected BEFORE any subprocess is spawned.
#   3. Unknown --env is rejected BEFORE any subprocess is spawned.
class RollbackCommitInjectionTest < Minitest::Test
    # Capture every IO.popen invocation issued during the test so we can both
    # stub out git AND assert that injection attempts never reach a subprocess.
    #
    # Hardening notes:
    #   * `expected_subcmds` is the set of git subcommands the test
    #     explicitly configured (via PopenSpy.responses or PopenSpy.exits).
    #     Any `git <subcmd>` call NOT in that set raises UnexpectedPopen
    #     instead of silently returning nil — so a future code path that
    #     starts shelling out to e.g. `git rev-parse` is caught loudly
    #     at the boundary rather than producing a confusing downstream
    #     YAML.safe_load failure on an empty string.
    #   * `exits` yields an honest `$?.exitstatus` for the configured code
    #     by shelling to a tiny `ruby -e "exit N"` — `true`/`false` only
    #     produce 0/1 and so failed to surface bugs sensitive to the
    #     specific code (e.g. git's 128 for "bad object").
    class UnexpectedPopen < StandardError; end

    module PopenSpy
        @calls = []
        @responses = {}
        @exits = {}

        class << self
            attr_reader :calls
            attr_accessor :responses, :exits

            def reset!
                @calls = []
                @responses = {}
                @exits = {}
            end

            def record(args)
                @calls << args
            end

            # Subcommands the current test has explicitly accounted for.
            # A response of "" or an exit of 0 counts as an explicit
            # opt-in: the test author has thought about that subcmd.
            def expected_subcmds
                (@responses.keys + @exits.keys).uniq
            end

            # Set $?.exitstatus to `code` by running a real, short-lived
            # subprocess that exits with that code. Using `system("true")`
            # / `system("false")` only ever yields 0 or 1 — too lossy for
            # bug-fidelity assertions (e.g. git's exit 128 on bad object).
            def stamp_exit_status!(code)
                # `ruby -e "exit N"` is portable across CI runners and
                # avoids relying on shell builtins. Suppress stderr just
                # in case (shouldn't print anything, but defensive).
                # Fail loud if the spawn itself fails: `system` returns
                # `nil` on exec failure (command-not-found / interpreter
                # unresolvable), in which case `$?` reflects a
                # ~127 exec failure rather than the configured code and
                # silently corrupts the spy contract. `false` (the
                # child ran and exited non-zero with the configured
                # code) is the happy path here and must NOT raise.
                result = system(RbConfig.ruby, "-e", "exit #{Integer(code)}", out: File::NULL, err: File::NULL)
                raise "stamp_exit_status! failed to spawn #{RbConfig.ruby}" if result.nil?
            end
        end
    end

    # A stand-in for RestoreCommand.run so we can detect successful hand-off
    # without touching Railway's GraphQL API.
    class FakeRestore
        @last_argv = nil
        @ran = false
        class << self
            attr_accessor :last_argv, :ran
            def reset!
                @last_argv = nil
                @ran = false
            end
        end

        def initialize(argv)
            @argv = argv
        end

        def run
            FakeRestore.last_argv = @argv
            FakeRestore.ran = true
        end
    end

    def setup
        PopenSpy.reset!
        FakeRestore.reset!

        # Monkey-patch IO.popen ONLY for the duration of each test.
        # The real RollbackCommitCommand uses the argv-array form:
        #   IO.popen(["git", "ls-tree", ...], err: [:child, :out]) { |io| io.read }
        # We intercept that and return canned output keyed by the first non-git
        # subcommand ("ls-tree" or "show").
        #
        # Hardening: any `git <subcmd>` NOT in PopenSpy.expected_subcmds
        # raises UnexpectedPopen. That makes "a new subprocess shows up
        # in the code path" a loud failure instead of a silent nil read.
        # Non-git popens fall through to the real implementation (we
        # want to keep e.g. minitest's own bookkeeping intact, though
        # nothing currently relies on it).
        @original_popen = IO.method(:popen)
        spy = PopenSpy
        IO.singleton_class.send(:define_method, :popen) do |*args, **kwargs, &block|
            spy.record(args)
            argv = args.first
            if argv.is_a?(Array) && argv.first == "git"
                subcmd = argv[1]
                unless spy.expected_subcmds.include?(subcmd)
                    raise UnexpectedPopen,
                        "PopenSpy received an UNEXPECTED `git #{subcmd}` invocation. " \
                        "The test only configured: #{spy.expected_subcmds.inspect}. " \
                        "If this is a legitimate new subprocess, opt in by setting " \
                        "PopenSpy.responses[#{subcmd.inspect}] (and/or exits) in " \
                        "the test setup. Full argv: #{argv.inspect}"
                end
                response = spy.responses[subcmd] || ""
                # Stamp $?.exitstatus with the configured code (default 0).
                # Critical for tests asserting on the *specific* exit code
                # (e.g. git's 128 for "fatal: bad object") rather than a
                # generic 0/1 success/fail.
                exit_code = spy.exits[subcmd] || 0
                spy.stamp_exit_status!(exit_code)
                # Mimic the block form used by the production code.
                if block
                    require "stringio"
                    block.call(StringIO.new(response))
                else
                    response
                end
            else
                # Defer to the real implementation for anything we don't expect.
                spy.instance_variable_get(:@original_popen)&.call(*args, **kwargs, &block)
            end
        end

        # Stub RestoreCommand so the integration boundary never tries to hit
        # Railway. We swap the constant and restore in teardown.
        @original_restore = Railway::RestoreCommand
        Railway.send(:remove_const, :RestoreCommand)
        Railway.const_set(:RestoreCommand, FakeRestore)
    end

    def teardown
        # Restore IO.popen.
        original = @original_popen
        IO.singleton_class.send(:define_method, :popen) do |*args, **kwargs, &block|
            original.call(*args, **kwargs, &block)
        end
        # Restore RestoreCommand.
        Railway.send(:remove_const, :RestoreCommand)
        Railway.const_set(:RestoreCommand, @original_restore)
    end

    # ── Happy path ─────────────────────────────────────────────────────────

    def test_valid_sha_and_env_invokes_git_via_argv_and_hands_off_to_restore
        PopenSpy.responses["ls-tree"] = "showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        PopenSpy.responses["show"] = "schema_version: 1\nservices: []\n"

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )
        cmd.run

        # 1. RestoreCommand got the expected argv (proves hand-off happened).
        assert FakeRestore.ran, "expected RestoreCommand to be invoked on happy path"
        assert_includes FakeRestore.last_argv, "--env"
        assert_includes FakeRestore.last_argv, "staging"
        assert_includes FakeRestore.last_argv, "--snapshot"
        assert_includes FakeRestore.last_argv, "--dry-run"

        # 2. Every git invocation used the argv-array form (no shell string).
        git_calls = PopenSpy.calls.map(&:first).select { |a| a.is_a?(Array) && a.first == "git" }
        refute_empty git_calls, "expected at least one git subprocess via IO.popen argv-array"
        git_calls.each do |argv|
            assert argv.is_a?(Array), "git call must be an argv array, got #{argv.inspect}"
            assert argv.all? { |a| a.is_a?(String) }, "all argv elements must be strings"
        end

        # 3. The sha appears as a literal argv element somewhere (not glued).
        ls_call = git_calls.find { |a| a[1] == "ls-tree" }
        assert ls_call, "expected a `git ls-tree` invocation"
        assert_includes ls_call, "abc1234"

        show_call = git_calls.find { |a| a[1] == "show" }
        assert show_call, "expected a `git show` invocation"
        # `git show` takes sha:path as a single token by design; ensure it's
        # the FULL token (not concatenated with anything else like `; rm -rf`).
        assert_includes show_call, "abc1234:showcase/.railway-snapshots/20260101T000000Z-staging.yaml"
    end

    # ── Rejection: malformed --sha ─────────────────────────────────────────

    def test_malformed_sha_is_rejected_before_any_subprocess
        malicious = "abc; touch /tmp/pwn"
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", malicious])

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"

        # No subprocess of any kind should have been launched.
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for malformed --sha; got #{PopenSpy.calls.inspect}"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    def test_sha_with_uppercase_is_rejected
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", "ABC1234"])
        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for uppercase --sha"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    def test_sha_too_short_is_rejected
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", "abc12"])
        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for too-short --sha"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    # ── Subprocess-failure gating ──────────────────────────────────────────

    # Regression: a failed `git show` previously slipped past the nil/empty
    # guard because `err: [:child, :out]` merges stderr into stdout, so a
    # non-zero exit produces a non-empty `yaml` containing git's error text
    # which then flowed into YAML.safe_load. The fix gates on $?.exitstatus.
    def test_git_show_nonzero_exit_dies_before_yaml_parse
        PopenSpy.responses["ls-tree"] = "showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        # Simulate a corrupt/missing blob: git prints an error to stderr
        # (merged into stdout via err: [:child, :out]) and exits non-zero.
        PopenSpy.responses["show"] = "fatal: bad object abc1234:showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        PopenSpy.exits["show"] = 128

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "git-show failure must exit nonzero"
        refute FakeRestore.ran, "RestoreCommand must not run when git show fails"
    end

    def test_empty_snapshot_listing_dies_before_git_show
        # ls-tree succeeds but returns no entries → die before any git show.
        PopenSpy.responses["ls-tree"] = ""

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "no-snapshot must exit nonzero"
        refute FakeRestore.ran, "RestoreCommand must not run when no snapshot found"

        # No `git show` should have been spawned.
        show_calls = PopenSpy.calls.select do |c|
            c.first.is_a?(Array) && c.first.first == "git" && c.first[1] == "show"
        end
        assert_empty show_calls, "no git show should run when ls-tree returns empty"
    end

    # ── Rejection: unknown --env ───────────────────────────────────────────

    def test_unknown_env_is_rejected_before_any_subprocess
        cmd = Railway::RollbackCommitCommand.new(["--env", "evil; rm -rf ~", "--sha", "abc1234"])

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"

        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for unknown --env"
        refute FakeRestore.ran
    end

    # ── PopenSpy self-test: hardening guarantees ──────────────────────────
    #
    # These tests pin the spy's own contract so it can't silently rot.
    # The spy is the only thing standing between a future subprocess
    # addition and a test that "passes" with a wrong answer.

    # If the production code adds a NEW git subprocess (e.g. rev-parse)
    # without the test opting in, the spy must raise — not silently
    # return nil/"" which would corrupt downstream assertions.
    def test_popen_spy_raises_on_unexpected_git_subcommand
        # Only "ls-tree" and "show" are configured here.
        PopenSpy.responses["ls-tree"] = ""
        PopenSpy.responses["show"] = ""

        # Direct invocation simulates the "new subprocess slipped in"
        # scenario without needing to add a real call site to railway.
        err = assert_raises(UnexpectedPopen) do
            IO.popen(["git", "rev-parse", "HEAD"], err: [:child, :out]) { |io| io.read }
        end
        assert_match(/UNEXPECTED `git rev-parse`/, err.message,
            "spy must name the offending subcommand in its error")
        assert_match(/ls-tree/, err.message,
            "spy must list the configured subcommands so the operator " \
            "can decide whether to opt the new one in")
    end

    # Exit-code fidelity: configuring `exits["show"] = 128` must yield
    # an honest `$?.exitstatus == 128`, not a generic 1. The git-show
    # failure-gate test depends on this fidelity to be a meaningful
    # regression test of the gate (a gate keyed on `!= 0` would pass
    # against a fake 1, but a gate keyed on `== 128` would not).
    def test_popen_spy_stamps_real_exit_status_for_configured_code
        PopenSpy.responses["show"] = "fatal: whatever\n"
        PopenSpy.exits["show"] = 128

        IO.popen(["git", "show", "abc1234:foo"], err: [:child, :out]) { |io| io.read }
        assert_equal 128, $?.exitstatus,
            "PopenSpy.stamp_exit_status! must reflect the *configured* " \
            "exit code in $?.exitstatus (got #{$?.exitstatus.inspect}). " \
            "Without this, tests asserting on specific git exit codes " \
            "(e.g. 128 for bad object) are vacuous."
    end

    # Default behaviour: when `exits[subcmd]` is unset, the call must
    # behave like a successful git invocation (`$?.exitstatus == 0`).
    def test_popen_spy_defaults_to_exit_zero_when_exits_unset
        PopenSpy.responses["ls-tree"] = "snap.yaml\n"

        IO.popen(["git", "ls-tree", "abc1234"], err: [:child, :out]) { |io| io.read }
        assert_equal 0, $?.exitstatus,
            "default exit status for an un-configured subcmd response " \
            "must be 0 (success), matching how real git behaves on a " \
            "successful call"
    end
end
